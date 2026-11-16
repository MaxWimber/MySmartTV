package local.smarttv.remote.net

import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import local.smarttv.remote.data.SavedTv
import local.smarttv.remote.data.TvStore
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

private val http: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(4, TimeUnit.SECONDS)
    .pingInterval(15, TimeUnit.SECONDS)
    .build()

private fun json(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { (k, v) -> put(k, v) } }

private fun request(host: String, port: Int) = Request.Builder().url("ws://$host:$port/ws").build()

fun deviceName(): String {
    val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
    val model = Build.MODEL.orEmpty()
    return (if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model").trim().take(40)
}

/**
 * The live connection to one SmartTV PC (protocol: docs/protocol.md).
 * Pairs by PIN, then authenticates with the saved token, and reconnects on its own.
 * If the PC changed its IP address, it is found again by network discovery.
 */
class RemoteClient(
    private val store: TvStore,
    private val scope: CoroutineScope,
    private val discover: suspend () -> List<FoundTv>,
) {
    enum class Status { Idle, Connecting, Connected }

    data class State(
        val status: Status = Status.Idle,
        val tvName: String? = null,
        val screenTitle: String? = null,
    )

    private data class Session(
        val host: String,
        val port: Int,
        val tvId: String?,
        val token: String?,
        val pin: String?,
        val name: String?,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    private var session: Session? = null
    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var failures = 0
    private var serverId: String? = null
    private var serverName: String? = null

    @Volatile
    private var generation = 0

    fun connect(tv: SavedTv) = start(Session(tv.host, tv.port, tv.id, tv.token, null, tv.name))

    fun pair(host: String, port: Int, pin: String) = start(Session(host, port, null, null, pin, null))

    @Synchronized
    fun disconnect() {
        reconnectJob?.cancel()
        session = null
        generation++
        socket?.close(1000, null)
        socket = null
        _state.value = State()
    }

    fun send(vararg pairs: Pair<String, Any?>): Boolean {
        val ws = socket ?: return false
        if (_state.value.status != Status.Connected) return false
        return ws.send(json(*pairs).toString())
    }

    @Synchronized
    private fun start(s: Session) {
        reconnectJob?.cancel()
        generation++
        socket?.close(1000, null)
        session = s
        failures = 0
        serverId = null
        serverName = null
        _state.value = State(Status.Connecting, s.name)
        open()
    }

    @Synchronized
    private fun open() {
        val s = session ?: return
        val gen = ++generation
        socket = http.newWebSocket(request(s.host, s.port), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (gen != generation) return
                when {
                    s.token != null -> webSocket.send(json("type" to "auth", "token" to s.token).toString())
                    s.pin != null -> webSocket.send(json("type" to "pair", "pin" to s.pin, "name" to deviceName()).toString())
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (gen == generation) handle(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (gen == generation) onDropped()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (gen == generation) onDropped()
            }
        })
    }

    @Synchronized
    private fun handle(text: String) {
        val m = runCatching { JSONObject(text) }.getOrNull() ?: return
        val s = session ?: return
        when (m.optString("type")) {
            "hello" -> {
                serverId = m.optString("id").ifBlank { null }
                serverName = m.optString("pcName").ifBlank { m.optString("name", "SmartTV") }
            }
            "paired" -> {
                val id = serverId ?: "${s.host}:${s.port}"
                val tv = SavedTv(id, serverName ?: "SmartTV", s.host, s.port, m.getString("token"))
                store.save(tv)
                session = Session(tv.host, tv.port, tv.id, tv.token, null, tv.name)
            }
            "authed" -> {
                failures = 0
                val cur = session ?: return
                cur.tvId?.let {
                    store.lastId = it
                    store.updateAddress(it, cur.host, cur.port)
                }
                _state.update { it.copy(status = Status.Connected, tvName = cur.name ?: serverName) }
            }
            "state" -> _state.update { it.copy(screenTitle = m.optString("title")) }
            "voice" -> {
                val phrase = m.optString("text")
                emit(if (m.optString("result") == "typed") "Введено: «$phrase»" else "Ищу на ТВ: «$phrase»")
            }
            "error" -> when (m.optString("code")) {
                "bad_token" -> {
                    s.tvId?.let(store::remove)
                    emit(m.optString("message", "Пульт отвязан, подключите заново"))
                    dropSession()
                }
                "bad_pin" -> {
                    emit("Неверный PIN")
                    dropSession()
                }
                else -> emit(m.optString("message").ifBlank { m.optString("code") })
            }
        }
    }

    @Synchronized
    private fun onDropped() {
        val s = session ?: return
        socket = null
        if (s.token == null) {
            // A pairing attempt that never got through.
            emit("Не удалось подключиться к ${s.host}:${s.port}")
            dropSession()
            return
        }
        failures++
        _state.update { it.copy(status = Status.Connecting) }
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(minOf(1000L * failures, 5000L))
            if (failures >= 2 && s.tvId != null) {
                // The PC may have a new IP address: look for it by its id.
                val found = runCatching { discover() }.getOrDefault(emptyList()).find { it.id == s.tvId }
                if (found != null) {
                    synchronized(this@RemoteClient) {
                        if (session === s) session = s.copy(host = found.host, port = found.port)
                    }
                }
            }
            open()
        }
    }

    @Synchronized
    private fun dropSession() {
        reconnectJob?.cancel()
        session = null
        generation++
        socket?.close(1000, null)
        socket = null
        _state.value = State()
    }

    private fun emit(message: String) {
        _messages.tryEmit(message)
    }

    companion object {
        /**
         * Sends a single command to a saved TV without keeping a connection
         * (used by "Share → Открыть на ТВ").
         */
        suspend fun sendOnce(
            store: TvStore,
            tv: SavedTv,
            message: JSONObject,
            discover: suspend () -> List<FoundTv>,
        ): Boolean {
            if (attempt(tv.host, tv.port, tv.token, message)) return true
            val found = runCatching { discover() }.getOrDefault(emptyList()).find { it.id == tv.id } ?: return false
            store.updateAddress(tv.id, found.host, found.port)
            return attempt(found.host, found.port, tv.token, message)
        }

        private suspend fun attempt(host: String, port: Int, token: String, message: JSONObject): Boolean =
            withTimeoutOrNull(5000) {
                suspendCancellableCoroutine { cont ->
                    val ws = http.newWebSocket(request(host, port), object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) {
                            webSocket.send(json("type" to "auth", "token" to token).toString())
                        }

                        override fun onMessage(webSocket: WebSocket, text: String) {
                            when (runCatching { JSONObject(text).optString("type") }.getOrNull()) {
                                "authed" -> {
                                    webSocket.send(message.toString())
                                    webSocket.close(1000, null)
                                    if (cont.isActive) cont.resume(true)
                                }
                                "error" -> {
                                    webSocket.close(1000, null)
                                    if (cont.isActive) cont.resume(false)
                                }
                            }
                        }

                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                            if (cont.isActive) cont.resume(false)
                        }
                    })
                    cont.invokeOnCancellation { ws.cancel() }
                }
            } ?: false
    }
}
