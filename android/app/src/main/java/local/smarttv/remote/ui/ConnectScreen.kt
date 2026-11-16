package local.smarttv.remote.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import local.smarttv.remote.data.TvStore
import local.smarttv.remote.net.FoundTv

@Composable
fun ConnectScreen(vm: RemoteViewModel) {
    val found by vm.found.collectAsStateWithLifecycle()
    val scanning by vm.scanning.collectAsStateWithLifecycle()
    val saved by vm.saved.collectAsStateWithLifecycle()
    var pinFor by remember { mutableStateOf<FoundTv?>(null) }
    var manual by remember { mutableStateOf(false) }

    val qrLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@rememberLauncherForActivityResult
        if (!vm.pairFromQr(text)) vm.toast("Это не QR-код SmartTV")
    }

    LazyColumn(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                buildAnnotatedString {
                    append("Smart")
                    withStyle(SpanStyle(color = Palette.Accent)) { append("TV") }
                    append(" пульт")
                },
                fontSize = 30.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 24.dp, bottom = 8.dp),
            )
        }
        item {
            Button(
                onClick = {
                    qrLauncher.launch(
                        ScanOptions()
                            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                            .setPrompt("Наведите на QR-код на экране ТВ")
                            .setBeepEnabled(false)
                            .setOrientationLocked(false),
                    )
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
            ) { Text("Сканировать QR-код", fontSize = 17.sp) }
            Text(
                "На ТВ: Настройки → Подключить пульт",
                color = Palette.Muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        item {
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("В этой сети", Modifier.weight(1f))
                TextButton(onClick = vm::scan, enabled = !scanning) { Text(if (scanning) "Поиск…" else "Обновить") }
            }
        }
        if (found.isEmpty()) {
            item {
                Text(
                    if (scanning) {
                        "Ищу компьютеры со SmartTV…"
                    } else {
                        "Ничего не найдено. Проверьте, что SmartTV запущен, а телефон и ПК в одной Wi-Fi сети."
                    },
                    color = Palette.Muted,
                )
            }
        }
        items(found, key = { "found-" + it.id }) { tv ->
            val isSaved = saved.any { it.id == tv.id }
            TvRow(
                title = tv.name,
                subtitle = "${tv.host}:${tv.port}" + if (isSaved) " · подключался" else "",
                onClick = { if (!vm.connectFound(tv)) pinFor = tv },
            )
        }

        if (saved.isNotEmpty()) {
            item { SectionTitle("Сохранённые", Modifier.padding(top = 12.dp)) }
            items(saved, key = { "saved-" + it.id }) { tv ->
                TvRow(tv.name, "${tv.host}:${tv.port}", onClick = { vm.connectSaved(tv) }) {
                    TextButton(onClick = { vm.forget(tv) }) { Text("Забыть") }
                }
            }
        }

        item {
            OutlinedButton(
                onClick = { manual = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp, bottom = 24.dp),
            ) { Text("Ввести адрес вручную") }
        }
    }

    pinFor?.let { tv ->
        PinDialog(tv.name, onDismiss = { pinFor = null }) { pin ->
            pinFor = null
            vm.pair(tv.host, tv.port, pin)
        }
    }
    if (manual) {
        ManualDialog(onDismiss = { manual = false }) { host, port, pin ->
            manual = false
            vm.pair(host, port, pin)
        }
    }
}

@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, color = Palette.Muted, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = modifier)
}

@Composable
private fun TvRow(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.Surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Text(subtitle, color = Palette.Muted, fontSize = 13.sp)
        }
        trailing?.invoke()
    }
}

@Composable
private fun PinDialog(tvName: String, onDismiss: () -> Unit, onPin: (String) -> Unit) {
    var pin by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Подключение к «$tvName»") },
        text = {
            Column {
                Text("Введите PIN с экрана ТВ (Настройки → Подключить пульт)", color = Palette.Muted)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = pin,
                    onValueChange = { pin = it.filter(Char::isDigit).take(4) },
                    singleLine = true,
                    label = { Text("PIN") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onPin(pin) }, enabled = pin.length == 4) { Text("Подключить") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}

@Composable
private fun ManualDialog(onDismiss: () -> Unit, onConnect: (String, Int, String) -> Unit) {
    var address by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    val host = address.substringBefore(':').trim()
    val port = address.substringAfter(':', "").toIntOrNull() ?: TvStore.DEFAULT_PORT
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Адрес вручную") },
        text = {
            Column {
                Text("Адрес и PIN видны на ТВ в окне «Подключить пульт».", color = Palette.Muted)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it.trim().removePrefix("http://").substringBefore('/') },
                    singleLine = true,
                    label = { Text("Адрес, например 192.168.1.12:8765") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = pin,
                    onValueChange = { pin = it.filter(Char::isDigit).take(4) },
                    singleLine = true,
                    label = { Text("PIN") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConnect(host, port, pin) }, enabled = host.isNotEmpty() && pin.length == 4) {
                Text("Подключить")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}
