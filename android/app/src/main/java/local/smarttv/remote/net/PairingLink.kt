package local.smarttv.remote.net

import android.net.Uri

/** Contents of the QR code on the TV: http://192.168.1.12:8765/#pair=1234 */
data class PairingLink(val host: String, val port: Int, val pin: String) {
    companion object {
        fun parse(text: String): PairingLink? = runCatching {
            val uri = Uri.parse(text.trim())
            if (uri.scheme != "http" && uri.scheme != "https") return null
            val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
            val pin = Regex("""pair=(\d{4})""").find(uri.fragment.orEmpty())?.groupValues?.get(1) ?: return null
            val port = if (uri.port > 0) uri.port else 8765
            PairingLink(host, port, pin)
        }.getOrNull()
    }
}
