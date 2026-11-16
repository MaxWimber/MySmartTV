package local.smarttv.remote.ui

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sign

/**
 * A remote-control button: fires on touch-down (not on release, like a real remote),
 * vibrates, and with [repeat] keeps firing while held.
 */
@Composable
fun PressBox(
    modifier: Modifier = Modifier,
    description: String,
    repeat: Boolean = false,
    shape: Shape = RoundedCornerShape(16.dp),
    container: Color = Palette.Button,
    pressedContainer: Color = Palette.ButtonPressed,
    onPress: () -> Unit,
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val action by rememberUpdatedState(onPress)
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (pressed) 0.94f else 1f, tween(90), label = "press")

    Box(
        modifier
            .scale(scale)
            .clip(shape)
            .background(if (pressed) pressedContainer else container)
            .semantics {
                role = Role.Button
                contentDescription = description
            }
            .pointerInput(repeat) {
                detectTapGestures(onPress = {
                    pressed = true
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    action()
                    val repeater = if (repeat) {
                        scope.launch {
                            delay(420)
                            while (isActive) {
                                action()
                                delay(110)
                            }
                        }
                    } else {
                        null
                    }
                    tryAwaitRelease()
                    repeater?.cancel()
                    pressed = false
                })
            },
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** A text button of the remote. */
@Composable
fun RemoteButton(
    label: String,
    modifier: Modifier = Modifier,
    description: String = label,
    repeat: Boolean = false,
    shape: Shape = RoundedCornerShape(16.dp),
    container: Color = Palette.Button,
    fontSize: Int = 16,
    bold: Boolean = false,
    onPress: () -> Unit,
) = PressBox(modifier, description, repeat, shape, container, onPress = onPress) {
    Text(label, fontSize = fontSize.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium, color = Palette.Text)
}

/** An icon button of the remote. */
@Composable
fun RemoteIcon(
    icon: ImageVector,
    description: String,
    modifier: Modifier = Modifier,
    repeat: Boolean = false,
    shape: Shape = CircleShape,
    container: Color = Palette.Button,
    pressedContainer: Color = Palette.ButtonPressed,
    tint: Color = Palette.Text,
    iconSize: Dp = 26.dp,
    onPress: () -> Unit,
) = PressBox(modifier, description, repeat, shape, container, pressedContainer, onPress) {
    Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
}

/** Several icon buttons joined into one pill, like a volume rocker. */
@Composable
fun PillGroup(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier
            .clip(CircleShape)
            .background(Palette.Button),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** One segment of a [PillGroup]. */
@Composable
fun RowScope.PillButton(icon: ImageVector, description: String, repeat: Boolean = false, onPress: () -> Unit) =
    RemoteIcon(
        icon,
        description,
        Modifier.weight(1f).fillMaxHeight(),
        repeat = repeat,
        shape = RoundedCornerShape(0.dp),
        container = Color.Transparent,
        onPress = onPress,
    )

/** Round D-pad with OK in the middle. */
@Composable
fun DPad(maxSize: Dp = 300.dp, onKey: (String) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val size = minOf(maxWidth * 0.8f, maxSize)
        val arrow = size * 0.3f
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(Palette.RingFill)
                .border(1.dp, Palette.RingEdge, CircleShape),
        ) {
            val clear = Color.Transparent
            val pad = size * 0.02f
            RemoteIcon(Icons.Up, "Вверх", Modifier.size(arrow).padding(top = pad).align(Alignment.TopCenter), true, container = clear, iconSize = 34.dp) { onKey("up") }
            RemoteIcon(Icons.Down, "Вниз", Modifier.size(arrow).padding(bottom = pad).align(Alignment.BottomCenter), true, container = clear, iconSize = 34.dp) { onKey("down") }
            RemoteIcon(Icons.Left, "Влево", Modifier.size(arrow).padding(start = pad).align(Alignment.CenterStart), true, container = clear, iconSize = 34.dp) { onKey("left") }
            RemoteIcon(Icons.Right, "Вправо", Modifier.size(arrow).padding(end = pad).align(Alignment.CenterEnd), true, container = clear, iconSize = 34.dp) { onKey("right") }
            PressBox(
                Modifier
                    .size(size * 0.4f)
                    .align(Alignment.Center)
                    .border(1.dp, Palette.RingEdge, CircleShape),
                description = "OK",
                shape = CircleShape,
                container = Palette.Ok,
                onPress = { onKey("ok") },
            ) { Text("OK", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Palette.Text) }
        }
    }
}

/**
 * Touchpad: one finger moves the PC cursor (faster finger = disproportionately
 * faster cursor), a short tap clicks, two fingers scroll the wheel.
 */
fun Modifier.touchpad(
    onMove: (Int, Int) -> Unit,
    onClick: () -> Unit,
    onScroll: (Int) -> Unit,
): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        val startTime = down.uptimeMillis
        var moved = 0f
        var maxPointers = 1
        var accX = 0f
        var accY = 0f
        var scrollAcc = 0f
        var lastTime = startTime

        while (true) {
            val event = awaitPointerEvent()
            val active = event.changes.filter { it.pressed }
            if (active.isEmpty()) {
                lastTime = event.changes.maxOfOrNull { it.uptimeMillis } ?: lastTime
                break
            }
            maxPointers = maxOf(maxPointers, active.size)

            if (active.size >= 2) {
                val dy = active.map { it.position.y - it.previousPosition.y }.average().toFloat() / density
                scrollAcc += dy
                while (abs(scrollAcc) >= 24f) {
                    val dir = sign(scrollAcc)
                    onScroll((dir * 120).toInt())
                    scrollAcc -= dir * 24f
                }
            } else if (maxPointers == 1) {
                val c = active[0]
                val dx = (c.position.x - c.previousPosition.x) / density
                val dy = (c.position.y - c.previousPosition.y) / density
                moved += abs(dx) + abs(dy)
                val gain = 1.6f + minOf(hypot(dx, dy) / 8f, 2.5f)
                accX += dx * gain
                accY += dy * gain
                val sx = accX.roundToInt()
                val sy = accY.roundToInt()
                if (sx != 0 || sy != 0) {
                    onMove(sx, sy)
                    accX -= sx
                    accY -= sy
                }
            }
            event.changes.forEach { it.consume() }
        }

        if (maxPointers == 1 && moved < 10f && lastTime - startTime < 250) onClick()
    }
}
