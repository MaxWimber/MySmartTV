package local.smarttv.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object Palette {
    val Background = Color(0xFF0B0D12)
    val Surface = Color(0xFF151A26)
    val Button = Color(0xFF1F2536)
    val ButtonPressed = Color(0xFF39425C)
    val Ring = Color(0xFF1A2030)
    val Ok = Color(0xFF2A3146)
    val Accent = Color(0xFF4DA3FF)
    val Primary = Color(0xFF2F6FD6)
    val Text = Color(0xFFF2F4F8)
    val Muted = Color(0xFF9AA3B5)
    val Online = Color(0xFF40C878)
    val Waiting = Color(0xFFFFB74D)
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
