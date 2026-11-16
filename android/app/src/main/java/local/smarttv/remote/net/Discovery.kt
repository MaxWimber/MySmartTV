package local.smarttv.remote.net

import android.content.Context
import android.net.wifi.WifiManager
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/** A SmartTV PC that answered the network search. */
data class FoundTv(val id: String, val name: String, val host: String, val port: Int)

/**
 * Finds SmartTV PCs in the local network: broadcasts "SMARTTV_DISCOVER" to UDP 8766
 * and collects the JSON replies (see docs/protocol.md).
 */
object Discovery {
    private const val PORT = 8766
    private val REQUEST = "SMARTTV_DISCOVER".toByteArray()

    suspend fun scan(context: Context, timeoutMs: Long = 1500): List<FoundTv> = withContext(Dispatchers.IO) {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = wifi?.createMulticastLock("smarttv-discovery")?.apply {
            setReferenceCounted(false)
            acquire()
        }
        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 250
                val targets = broadcastAddresses() + InetAddress.getByName("255.255.255.255")
                repeat(2) {
                    for (target in targets) {
                        runCatching { socket.send(DatagramPacket(REQUEST, REQUEST.size, target, PORT)) }
                    }
                }
                val found = LinkedHashMap<String, FoundTv>()
                val buffer = ByteArray(2048)
                val deadline = SystemClock.elapsedRealtime() + timeoutMs
                while (SystemClock.elapsedRealtime() < deadline) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    runCatching {
                        val json = JSONObject(String(packet.data, 0, packet.length))
                        if (json.optString("service") == "smarttv") {
                            val id = json.getString("id")
                            found[id] = FoundTv(
                                id = id,
                                name = json.optString("pcName").ifBlank { json.optString("name", "SmartTV") },
                                host = packet.address.hostAddress ?: return@runCatching,
                                port = json.optInt("port", 8765),
                            )
                        }
                    }
                }
                found.values.toList()
            }
        } catch (_: Exception) {
            emptyList()
        } finally {
            lock?.release()
        }
    }

    private fun broadcastAddresses(): List<InetAddress> = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.interfaceAddresses }
            .mapNotNull { it.broadcast }
    }.getOrDefault(emptyList())
}
