package local.smarttv.remote

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import local.smarttv.remote.net.RemoteClient
import local.smarttv.remote.ui.ConnectScreen
import local.smarttv.remote.ui.Palette
import local.smarttv.remote.ui.RemoteScreen
import local.smarttv.remote.ui.RemoteViewModel
import local.smarttv.remote.ui.SmartTvTheme

class MainActivity : ComponentActivity() {
    private val vm: RemoteViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { SmartTvTheme { App(vm) } }
    }

    override fun onStart() {
        super.onStart()
        vm.onAppVisible()
    }

    // The phone's volume buttons control the PC's volume while connected.
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (vm.isConnected) {
            when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> {
                    vm.volume("up")
                    return true
                }
                KeyEvent.KEYCODE_VOLUME_DOWN -> {
                    vm.volume("down")
                    return true
                }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (vm.isConnected && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) return true
        return super.onKeyUp(keyCode, event)
    }
}

@Composable
private fun App(vm: RemoteViewModel) {
    val conn by vm.connection.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { vm.messages.collect { snackbar.showSnackbar(it) } }

    Scaffold(containerColor = Palette.Background, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            if (conn.status == RemoteClient.Status.Idle) ConnectScreen(vm) else RemoteScreen(vm, conn)
        }
    }
}
