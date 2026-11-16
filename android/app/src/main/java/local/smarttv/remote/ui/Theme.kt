package local.smarttv.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

object Palette {
    val Background = Color(0xFF0E1015)
    val Surface = Color(0xFF181B22)
    val Button = Color(0xFF242833)
    val ButtonPressed = Color(0xFF363C4B)
    val Ring = Color(0xFF1C2029)
    val RingEdge = Color(0xFF2A2F3B)
    val Ok = Color(0xFF2C3240)
    val Accent = Color(0xFF8AB4F8)
    val Primary = Color(0xFF4D8EF7)
    val Mic = Color(0xFF4D8EF7)
    val MicPressed = Color(0xFF3A74D4)
    val Text = Color(0xFFF1F3F7)
    val Muted = Color(0xFF9AA1B0)
    val Online = Color(0xFF4CD48A)
    val Waiting = Color(0xFFFFB74D)

    val Backdrop = Brush.verticalGradient(listOf(Color(0xFF151A26), Background, Background))
    val RingFill = Brush.radialGradient(listOf(Color(0xFF232836), Ring))
}

private val colors = darkColorScheme(
    primary = Palette.Primary,
    onPrimary = Color.White,
    secondary = Palette.Accent,
    background = Palette.Background,
    onBackground = Palette.Text,
    surface = Palette.Surface,
    onSurface = Palette.Text,
    surfaceVariant = Palette.Button,
    onSurfaceVariant = Palette.Muted,
    error = Color(0xFFFF7B80),
)

@Composable
fun SmartTvTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = colors, content = content)
