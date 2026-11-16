package local.smarttv.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import local.smarttv.remote.data.SavedTv
import local.smarttv.remote.data.TvStore
import local.smarttv.remote.net.Discovery
import local.smarttv.remote.net.FoundTv
import local.smarttv.remote.net.PairingLink
import local.smarttv.remote.net.RemoteClient

class RemoteViewModel(app: Application) : AndroidViewModel(app) {
    private val store = TvStore(app)
    private val client = RemoteClient(store, viewModelScope) { Discovery.scan(app) }

    val connection: StateFlow<RemoteClient.State> = client.state

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    private val _found = MutableStateFlow<List<FoundTv>>(emptyList())
    val found: StateFlow<List<FoundTv>> = _found

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning

    private val _saved = MutableStateFlow(store.all())
    val saved: StateFlow<List<SavedTv>> = _saved

    /** The user pressed "Сменить ТВ": don't reconnect by ourselves until they pick one. */
    private var userDisconnected = false

    init {
        viewModelScope.launch { client.messages.collect { _messages.emit(it) } }
        viewModelScope.launch { client.state.collect { _saved.value = store.all() } }
        store.last()?.let(client::connect) ?: scan()
    }

    fun onAppVisible() {
        if (!userDisconnected && client.state.value.status == RemoteClient.Status.Idle) {
            store.last()?.let(client::connect)
        }
    }

    fun scan() {
        if (_scanning.value) return
        viewModelScope.launch {
            _scanning.value = true
            _found.value = Discovery.scan(getApplication())
            _scanning.value = false
        }
    }

    fun connectSaved(tv: SavedTv) {
        userDisconnected = false
        client.connect(tv)
    }

    /** Connects right away if this PC is already paired; otherwise the UI must ask for the PIN. */
    fun connectFound(tv: FoundTv): Boolean {
        val saved = store.find(tv.id) ?: return false
        connectSaved(saved.copy(host = tv.host, port = tv.port))
        return true
    }

    fun pair(host: String, port: Int, pin: String) {
        userDisconnected = false
        client.pair(host.trim(), port, pin.trim())
    }

    fun pairFromQr(text: String): Boolean {
        val link = PairingLink.parse(text) ?: return false
        pair(link.host, link.port, link.pin)
        return true
    }

    fun forget(tv: SavedTv) {
        store.remove(tv.id)
        _saved.value = store.all()
    }

    fun disconnect() {
        userDisconnected = true
        client.disconnect()
        scan()
    }

    fun toast(message: String) {
        _messages.tryEmit(message)
    }

    val isConnected: Boolean get() = client.state.value.status == RemoteClient.Status.Connected

    // ---- commands (docs/protocol.md)

    fun key(key: String) = client.send("type" to "key", "key" to key)
    fun volume(action: String) = client.send("type" to "volume", "action" to action)
    fun mouse(dx: Int, dy: Int) = client.send("type" to "mouse", "dx" to dx, "dy" to dy)
    fun click(button: String) = client.send("type" to "click", "button" to button)
    fun scroll(dy: Int) = client.send("type" to "scroll", "dy" to dy)
    fun text(text: String) = client.send("type" to "text", "text" to text)
    fun open(url: String) = client.send("type" to "open", "url" to url)
}
