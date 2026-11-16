package local.smarttv.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.smarttv.remote.net.RemoteClient

private val TABS = listOf("Пульт", "Тачпад", "Текст")

@Composable
fun RemoteScreen(vm: RemoteViewModel, conn: RemoteClient.State) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val connected = conn.status == RemoteClient.Status.Connected

    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(if (connected) Palette.Online else Palette.Waiting),
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(conn.tvName ?: "SmartTV", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (connected) conn.screenTitle.orEmpty() else "Подключение…",
                    color = Palette.Muted,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            TextButton(onClick = vm::disconnect) { Text("Сменить ТВ") }
        }

        TabRow(selectedTabIndex = tab, containerColor = Palette.Background) {
            TABS.forEachIndexed { i, title ->
                Tab(selected = tab == i, onClick = { tab = i }, text = { Text(title) })
            }
        }
        Spacer(Modifier.height(16.dp))

        Box(Modifier.weight(1f)) {
            when (tab) {
                0 -> PadTab(vm)
                1 -> TouchTab(vm)
                else -> TextTab(vm)
            }
        }
    }
}

private val rowSpacing = Arrangement.spacedBy(10.dp)
private val buttonHeight = Modifier.height(58.dp)

@Composable
private fun PadTab(vm: RemoteViewModel) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = rowSpacing,
    ) {
        DPad { vm.key(it) }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), rowSpacing) {
            RemoteButton("↩ Назад", Modifier.weight(1f).then(buttonHeight)) { vm.key("back") }
            RemoteButton("⌂ Домой", Modifier.weight(1f).then(buttonHeight)) { vm.key("home") }
            RemoteButton("⏯", Modifier.weight(1f).then(buttonHeight), "Пауза", fontSize = 22) { vm.key("playpause") }
        }
        Row(Modifier.fillMaxWidth(), rowSpacing) {
            RemoteButton("⏪ 10 с", Modifier.weight(1f).then(buttonHeight), repeat = true) { vm.key("seekback") }
            RemoteButton("🔇", Modifier.weight(1f).then(buttonHeight), "Без звука") { vm.volume("mute") }
            RemoteButton("10 с ⏩", Modifier.weight(1f).then(buttonHeight), repeat = true) { vm.key("seekfwd") }
        }
        Row(Modifier.fillMaxWidth(), rowSpacing) {
            RemoteButton("🔉 Тише", Modifier.weight(1f).then(buttonHeight), repeat = true) { vm.volume("down") }
            RemoteButton("🔊 Громче", Modifier.weight(1f).then(buttonHeight), repeat = true) { vm.volume("up") }
        }
        Text(
            "Кнопки громкости телефона тоже управляют громкостью ПК",
            color = Palette.Muted,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        )
    }
}

@Composable
private fun TouchTab(vm: RemoteViewModel) {
    Column(Modifier.fillMaxSize(), verticalArrangement = rowSpacing) {
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(20.dp))
                .background(Palette.Ring)
                .border(1.dp, Palette.Button, RoundedCornerShape(20.dp))
                .touchpad(
                    onMove = { dx, dy -> vm.mouse(dx, dy) },
                    onClick = { vm.click("left") },
                    onScroll = { vm.scroll(it) },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "Водите пальцем: курсор\nТап: клик\nДвумя пальцами: прокрутка",
                color = Palette.Muted,
                textAlign = TextAlign.Center,
                lineHeight = 24.sp,
            )
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), rowSpacing) {
            RemoteButton("Клик", Modifier.weight(1f).then(buttonHeight)) { vm.click("left") }
            RemoteButton("Правый клик", Modifier.weight(1f).then(buttonHeight)) { vm.click("right") }
            RemoteButton("↩ Назад", Modifier.weight(1f).then(buttonHeight)) { vm.key("back") }
        }
    }
}

@Composable
private fun TextTab(vm: RemoteViewModel) {
    var text by rememberSaveable { mutableStateOf("") }
    var url by rememberSaveable { mutableStateOf("") }
    val sendText = {
        if (text.isNotEmpty() && vm.text(text)) text = ""
    }
    val openUrl = {
        if (url.isNotBlank() && vm.open(url.trim())) url = ""
    }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = rowSpacing,
    ) {
        Text("Ввести текст в поле на ТВ", color = Palette.Muted, fontSize = 14.sp)
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Поисковый запрос…") },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { sendText() }),
            singleLine = true,
        )
        Row(Modifier.fillMaxWidth(), rowSpacing) {
            Button(onClick = sendText, modifier = Modifier.weight(1f).then(buttonHeight), shape = RoundedCornerShape(16.dp)) {
                Text("Отправить")
            }
            RemoteButton("⌫", Modifier.weight(1f).then(buttonHeight), "Стереть", repeat = true, fontSize = 20) { vm.key("backspace") }
            RemoteButton("↵ Enter", Modifier.weight(1f).then(buttonHeight)) { vm.key("enter") }
        }

        Spacer(Modifier.height(16.dp))
        Text("Открыть ссылку на ТВ", color = Palette.Muted, fontSize = 14.sp)
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("https://youtu.be/…") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { openUrl() }),
            singleLine = true,
        )
        Button(onClick = openUrl, modifier = Modifier.fillMaxWidth().then(buttonHeight), shape = RoundedCornerShape(16.dp)) {
            Text("Открыть на ТВ")
        }
        Text(
            "Ещё проще: в YouTube, браузере или VK нажмите «Поделиться» → «Открыть на ТВ».",
            color = Palette.Muted,
            fontSize = 13.sp,
            modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
        )
    }
}
