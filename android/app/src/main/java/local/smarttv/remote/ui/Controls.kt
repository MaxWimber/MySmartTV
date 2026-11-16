package local.smarttv.remote.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
fun RemoteButton(
    label: String,
    modifier: Modifier = Modifier,
    description: String = label,
    repeat: Boolean = false,
    shape: Shape = RoundedCornerShape(16.dp),
    container: Color = Palette.Button,
    fontSize: Int = 17,
    bold: Boolean = false,
    onPress: () -> Unit,
) {
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val action by rememberUpdatedState(onPress)
    var pressed by remember { mutableStateOf(false) }

    Box(
        modifier
            .clip(shape)
            .background(if (pressed) Palette.ButtonPressed else container)
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
    ) {
        Text(label, fontSize = fontSize.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, color = Palette.Text)
    }
}

/** Round D-pad with OK in the middle. */
@Composable
fun DPad(onKey: (String) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val size = minOf(maxWidth * 0.82f, 320.dp)
        val arrow = size * 0.32f
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(Palette.Ring),
        ) {
            val transparent = Color.Transparent
            RemoteButton("▲", Modifier.size(arrow).align(Alignment.TopCenter), "Вверх", true, CircleShape, transparent, 22) { onKey("up") }
            RemoteButton("▼", Modifier.size(arrow).align(Alignment.BottomCenter), "Вниз", true, CircleShape, transparent, 22) { onKey("down") }
            RemoteButton("◀", Modifier.size(arrow).align(Alignment.CenterStart), "Влево", true, CircleShape, transparent, 22) { onKey("left") }
            RemoteButton("▶", Modifier.size(arrow).align(Alignment.CenterEnd), "Вправо", true, CircleShape, transparent, 22) { onKey("right") }
            RemoteButton(
                "OK",
                Modifier.size(size * 0.38f).align(Alignment.Center),
                shape = CircleShape,
                container = Palette.Ok,
                fontSize = 22,
                bold = true,
            ) { onKey("ok") }
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
