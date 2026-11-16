package local.smarttv.remote.data

import android.content.Context
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject

/** A PC that this phone has been paired with. */
data class SavedTv(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val token: String,
)

/** Paired TVs and their access tokens, kept in app-private SharedPreferences. */
class TvStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("smarttv", Context.MODE_PRIVATE)

    @Synchronized
    fun all(): List<SavedTv> {
        val arr = runCatching { JSONArray(prefs.getString(KEY_TVS, "[]")) }.getOrDefault(JSONArray())
        return (0 until arr.length()).mapNotNull { i ->
            runCatching {
                val o = arr.getJSONObject(i)
                SavedTv(
                    id = o.getString("id"),
                    name = o.optString("name", "SmartTV"),
                    host = o.getString("host"),
                    port = o.optInt("port", DEFAULT_PORT),
                    token = o.getString("token"),
                )
            }.getOrNull()
        }
    }

    fun find(id: String): SavedTv? = all().find { it.id == id }

    @Synchronized
    fun save(tv: SavedTv) = write(all().filterNot { it.id == tv.id } + tv)

    @Synchronized
    fun remove(id: String) {
        write(all().filterNot { it.id == id })
        if (lastId == id) lastId = null
    }

    @Synchronized
    fun updateAddress(id: String, host: String, port: Int) {
        val tv = find(id) ?: return
        if (tv.host != host || tv.port != port) save(tv.copy(host = host, port = port))
    }

    var lastId: String?
        get() = prefs.getString(KEY_LAST, null)
        set(value) = prefs.edit { putString(KEY_LAST, value) }

    fun last(): SavedTv? = lastId?.let(::find)

    private fun write(list: List<SavedTv>) {
        val arr = JSONArray()
        list.forEach { tv ->
            arr.put(
                JSONObject()
                    .put("id", tv.id)
                    .put("name", tv.name)
                    .put("host", tv.host)
                    .put("port", tv.port)
                    .put("token", tv.token),
            )
        }
        prefs.edit { putString(KEY_TVS, arr.toString()) }
    }

    companion object {
        const val DEFAULT_PORT = 8765
        private const val KEY_TVS = "tvs"
        private const val KEY_LAST = "last"
    }
}
