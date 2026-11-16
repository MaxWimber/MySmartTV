package local.smarttv.remote.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
    var typed by rememberSaveable { mutableStateOf("") }
    val connected = conn.status == RemoteClient.Status.Connected

    // One recognizer for the whole screen: the mic button searches on the TV,
    // the mic in the text field dictates into that field.
    var dictating by remember { mutableStateOf(false) }
    val voice = rememberVoiceInput(
        onText = { phrase ->
            if (dictating) typed = (typed.trimEnd() + " " + phrase).trim() else vm.voice(phrase)
        },
        onError = vm::toast,
    )
    val listen = { intoField: Boolean ->
        dictating = intoField
        voice.start()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Palette.Backdrop),
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
            Header(conn, connected, vm::disconnect)
            Segmented(TABS, tab) { tab = it }
            Spacer(Modifier.height(14.dp))
            Box(Modifier.weight(1f)) {
                when (tab) {
                    0 -> PadTab(vm) { listen(false) }
                    1 -> TouchTab(vm)
                    else -> TextTab(vm, typed, { typed = it }) { listen(true) }
                }
            }
        }

        VoiceSheet(voice, dictating, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun Header(conn: RemoteClient.State, connected: Boolean, onSwitch: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Box(
                Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Palette.Surface),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Tv, null, tint = Palette.Accent, modifier = Modifier.size(24.dp)) }
            val dot by animateColorAsState(if (connected) Palette.Online else Palette.Waiting, label = "status")
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(13.dp)
                    .clip(CircleShape)
                    .background(Palette.Background)
                    .padding(2.dp)
                    .clip(CircleShape)
                    .background(dot),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(conn.tvName ?: "SmartTV", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (connected) listOfNotNull("Подключено", conn.screenTitle?.ifBlank { null }).joinToString(" · ") else "Подключение…",
                color = Palette.Muted,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        TextButton(onClick = onSwitch) { Text("Сменить ТВ", color = Palette.Accent) }
    }
}

@Composable
private fun Segmented(tabs: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(46.dp)
            .clip(CircleShape)
            .background(Palette.Surface)
            .padding(4.dp),
    ) {
        tabs.forEachIndexed { i, title ->
            val isSelected = i == selected
            val bg by animateColorAsState(if (isSelected) Palette.Button else Color.Transparent, tween(160), label = "tab")
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(bg)
                    .clickable { onSelect(i) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    title,
                    color = if (isSelected) Palette.Text else Palette.Muted,
                    fontSize = 15.sp,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun PadTab(vm: RemoteViewModel, onMic: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        DPad { vm.key(it) }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.Top,
        ) {
            Labeled("Назад") { RemoteIcon(Icons.Back, "Назад", Modifier.size(62.dp)) { vm.key("back") } }
            Labeled("Голос") {
                RemoteIcon(
                    Icons.Mic,
                    "Голосовой поиск",
                    Modifier.size(76.dp),
                    container = Palette.Mic,
                    pressedContainer = Palette.MicPressed,
                    iconSize = 34.dp,
                    onPress = onMic,
                )
            }
            Labeled("Домой") { RemoteIcon(Icons.Home, "Домой", Modifier.size(62.dp)) { vm.key("home") } }
        }

        PillGroup(Modifier.fillMaxWidth().height(60.dp)) {
            PillButton(Icons.VolumeDown, "Тише", repeat = true) { vm.volume("down") }
            PillButton(Icons.VolumeOff, "Без звука") { vm.volume("mute") }
            PillButton(Icons.VolumeUp, "Громче", repeat = true) { vm.volume("up") }
        }
        PillGroup(Modifier.fillMaxWidth().height(60.dp)) {
            PillButton(Icons.Rewind, "Назад на 10 секунд", repeat = true) { vm.key("seekback") }
            PillButton(Icons.PlayPause, "Пауза") { vm.key("playpause") }
            PillButton(Icons.Forward, "Вперёд на 10 секунд", repeat = true) { vm.key("seekfwd") }
        }
        Text(
            "Громкость можно менять и кнопками телефона",
            color = Palette.Muted,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        )
    }
}

@Composable
private fun Labeled(label: String, button: @Composable () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.height(76.dp), contentAlignment = Alignment.Center) { button() }
        Text(label, color = Palette.Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun TouchTab(vm: RemoteViewModel) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(24.dp))
                .background(Palette.RingFill)
                .border(1.dp, Palette.RingEdge, RoundedCornerShape(24.dp))
                .touchpad(
                    onMove = { dx, dy -> vm.mouse(dx, dy) },
                    onClick = { vm.click("left") },
                    onScroll = { vm.scroll(it) },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "Водите пальцем — курсор\nТап — клик\nДвумя пальцами — прокрутка",
                color = Palette.Muted,
                textAlign = TextAlign.Center,
                lineHeight = 24.sp,
            )
        }
        Row(Modifier.fillMaxWidth().height(58.dp).padding(bottom = 4.dp), Arrangement.spacedBy(10.dp)) {
            RemoteButton("Клик", Modifier.weight(1f).fillMaxHeight(), shape = CircleShape) { vm.click("left") }
            RemoteButton("Правый клик", Modifier.weight(1f).fillMaxHeight(), shape = CircleShape) { vm.click("right") }
            RemoteIcon(Icons.Back, "Назад", Modifier.size(58.dp)) { vm.key("back") }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun TextTab(vm: RemoteViewModel, text: String, onText: (String) -> Unit, onDictate: () -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    val sendText = {
        if (text.isNotEmpty() && vm.text(text)) onText("")
    }
    val openUrl = {
        if (url.isNotBlank() && vm.open(url.trim())) url = ""
    }
    val fieldShape = RoundedCornerShape(18.dp)

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard {
            Text("Текст в поле на ТВ", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text("Откройте поиск в приложении на ТВ и введите запрос здесь", color = Palette.Muted, fontSize = 13.sp)
            OutlinedTextField(
                value = text,
                onValueChange = onText,
                modifier = Modifier.fillMaxWidth(),
                shape = fieldShape,
                placeholder = { Text("Что найти?") },
                trailingIcon = {
                    IconButton(onClick = onDictate) { Icon(Icons.Mic, "Надиктовать", tint = Palette.Accent) }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { sendText() }),
                singleLine = true,
            )
            Row(Modifier.fillMaxWidth().height(54.dp), Arrangement.spacedBy(10.dp)) {
                Button(onClick = sendText, modifier = Modifier.weight(1f).fillMaxHeight(), shape = CircleShape) {
                    Icon(Icons.Send, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Отправить", fontSize = 16.sp)
                }
                RemoteIcon(Icons.Backspace, "Стереть", Modifier.size(54.dp), repeat = true, iconSize = 22.dp) { vm.key("backspace") }
                RemoteIcon(Icons.Enter, "Enter", Modifier.size(54.dp), iconSize = 22.dp) { vm.key("enter") }
            }
        }

        SectionCard {
            Text("Ссылка", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                modifier = Modifier.fillMaxWidth(),
                shape = fieldShape,
                leadingIcon = { Icon(Icons.Link, null, tint = Palette.Muted) },
                placeholder = { Text("https://youtu.be/…") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { openUrl() }),
                singleLine = true,
            )
            Button(onClick = openUrl, modifier = Modifier.fillMaxWidth().height(54.dp), shape = CircleShape) {
                Text("Открыть на ТВ", fontSize = 16.sp)
            }
            Text(
                "Проще всего: в YouTube, браузере или VK нажмите «Поделиться» → «Открыть на ТВ».",
                color = Palette.Muted,
                fontSize = 13.sp,
            )
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun SectionCard(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(Palette.Surface)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

/** The "listening" sheet: a mic that pulses with the voice and the words heard so far. */
@Composable
private fun VoiceSheet(voice: VoiceInput, dictating: Boolean, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        visible = voice.listening,
        modifier = modifier,
        enter = fadeIn() + slideInVertically { it / 2 },
        exit = fadeOut() + slideOutVertically { it / 2 },
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0xAA000000))
                .clickable(remember { MutableInteractionSource() }, null) { voice.cancel() },
            contentAlignment = Alignment.BottomCenter,
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(Palette.Surface)
                    .clickable(remember { MutableInteractionSource() }, null) {}
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                val halo by animateDpAsState(88.dp + 44.dp * voice.level, tween(120), label = "halo")
                Box(Modifier.size(132.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(halo).clip(CircleShape).background(Palette.Mic.copy(alpha = 0.25f)))
                    Box(
                        Modifier.size(76.dp).clip(CircleShape).background(Palette.Mic),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Mic, null, tint = Color.White, modifier = Modifier.size(34.dp)) }
                }
                Text(
                    voice.partial.ifBlank { "Говорите…" },
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                    color = if (voice.partial.isBlank()) Palette.Muted else Palette.Text,
                )
                Text(
                    if (dictating) "Текст попадёт в поле ввода" else "Найду на ТВ, когда вы замолчите",
                    color = Palette.Muted,
                    fontSize = 13.sp,
                )
                Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(12.dp)) {
                    TextButton(onClick = voice::cancel, modifier = Modifier.weight(1f).height(52.dp)) { Text("Отмена") }
                    Button(onClick = voice::finish, modifier = Modifier.weight(1f).height(52.dp), shape = CircleShape) { Text("Готово") }
                }
            }
        }
    }
}
