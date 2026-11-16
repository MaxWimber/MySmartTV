package local.smarttv.remote

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import local.smarttv.remote.data.TvStore
import local.smarttv.remote.net.Discovery
import local.smarttv.remote.net.RemoteClient
import org.json.JSONObject

/** "Share → Открыть на ТВ": sends a link from any app to the last connected PC. */
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val shared = intent?.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
        val url = Regex("""https?://\S+""").find(shared)?.value
        val store = TvStore(this)
        val tv = store.last()

        when {
            url == null -> {
                toast("В том, чем поделились, нет ссылки")
                finish()
            }
            tv == null -> {
                toast("Сначала подключите телевизор")
                startActivity(Intent(this, MainActivity::class.java))
                finish()
            }
            else -> lifecycleScope.launch {
                val message = JSONObject().put("type", "open").put("url", url)
                val ok = RemoteClient.sendOnce(store, tv, message) { Discovery.scan(this@ShareActivity) }
                toast(if (ok) "Открываю на «${tv.name}»" else "Не удалось связаться с «${tv.name}»")
                finish()
            }
        }
    }

    private fun toast(text: String) = Toast.makeText(applicationContext, text, Toast.LENGTH_SHORT).show()
}
