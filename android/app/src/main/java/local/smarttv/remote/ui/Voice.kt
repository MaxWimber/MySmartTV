package local.smarttv.remote.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * Speech recognition on the phone. While listening, [partial] holds the words
 * heard so far and [level] the loudness (0..1) for the animation; the final
 * phrase goes to the callback given to [rememberVoiceInput].
 */
class VoiceInput internal constructor(
    private val context: Context,
    private val onText: (String) -> Unit,
    private val onError: (String) -> Unit,
) {
    var listening by mutableStateOf(false)
        private set
    var partial by mutableStateOf("")
        private set
    var level by mutableFloatStateOf(0f)
        private set

    internal var askPermission: () -> Unit = {}
    internal var openSystemDialog: (Intent) -> Unit = {}
    private var recognizer: SpeechRecognizer? = null

    private fun recognizeIntent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_PROMPT, "Скажите, что найти")
    }

    fun start() {
        if (listening) return
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            // No recognition service to talk to: fall back to the system voice dialog.
            runCatching { openSystemDialog(recognizeIntent()) }
                .onFailure { onError("На телефоне нет распознавания речи (нужно приложение Google)") }
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            askPermission()
            return
        }
        listen()
    }

    internal fun listen() {
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
        r.setRecognitionListener(listener)
        partial = ""
        level = 0f
        listening = true
        r.startListening(recognizeIntent())
    }

    /** Stop listening now; what was said so far is recognized and sent. */
    fun finish() {
        if (listening) recognizer?.stopListening()
    }

    fun cancel() {
        recognizer?.cancel()
        listening = false
    }

    internal fun deliver(text: String?) {
        val phrase = text?.trim().orEmpty()
        if (phrase.isNotEmpty()) onText(phrase) else onError("Не расслышал, попробуйте ещё раз")
    }

    internal fun destroy() {
        recognizer?.destroy()
        recognizer = null
        listening = false
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) {
            level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
        }
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() {
            level = 0f
        }
        override fun onPartialResults(partialResults: Bundle?) {
            partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                ?.takeIf { it.isNotBlank() }?.let { partial = it }
        }
        override fun onResults(results: Bundle?) {
            listening = false
            deliver(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: partial)
        }
        override fun onError(error: Int) {
            listening = false
            when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                    if (partial.isNotBlank()) deliver(partial) else onError("Не расслышал, попробуйте ещё раз")
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER ->
                    onError("Распознаванию речи нужен интернет на телефоне")
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> onError("Нет доступа к микрофону")
                SpeechRecognizer.ERROR_CLIENT -> Unit // cancelled by us
                else -> onError("Ошибка распознавания речи ($error)")
            }
        }
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }
}

@Composable
fun rememberVoiceInput(onText: (String) -> Unit, onError: (String) -> Unit): VoiceInput {
    val context = LocalContext.current
    val text by rememberUpdatedState(onText)
    val error by rememberUpdatedState(onError)
    val voice = remember { VoiceInput(context, { text(it) }, { error(it) }) }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) voice.listen() else error("Без доступа к микрофону голосовой ввод не работает")
    }
    val systemDialog = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            voice.deliver(result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull())
        }
    }
    voice.askPermission = { permission.launch(Manifest.permission.RECORD_AUDIO) }
    voice.openSystemDialog = { systemDialog.launch(it) }

    DisposableEffect(voice) { onDispose { voice.destroy() } }
    return voice
}
