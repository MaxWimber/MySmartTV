'use strict';
// OS-level input for the remote: mouse cursor (touchpad), clicks, wheel,
// system volume, and putting the Google TV window over the whole screen.
// A long-lived PowerShell process calls user32.dll, so no native Node modules
// need to be compiled.
const { spawn } = require('node:child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class StvInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);

  public static void Move(int dx, int dy) { POINT p; GetCursorPos(out p); SetCursorPos(p.X + dx, p.Y + dy); }
  public static void Click(bool right) {
    mouse_event(right ? 0x0008u : 0x0002u, 0, 0, 0, UIntPtr.Zero);
    mouse_event(right ? 0x0010u : 0x0004u, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Scroll(int amount) { mouse_event(0x0800u, 0, 0, amount, UIntPtr.Zero); }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }

  static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }

  static IntPtr FindByTitle(string prefix) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { if (IsWindowVisible(h) && Title(h).StartsWith(prefix)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }

  static void Focus(IntPtr h) {
    // Windows lets only the foreground app move focus; a synthetic Alt press counts as user input.
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }

  // Borderless window over the whole monitor; the emulator's side toolbar is hidden.
  public static string Fullscreen(string prefix) {
    IntPtr main = FindByTitle(prefix);
    if (main == IntPtr.Zero) return "notfound";
    uint pid; GetWindowThreadProcessId(main, out pid);
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && h != main && IsWindowVisible(h)) ShowWindow(h, 0);
      return true;
    }, IntPtr.Zero);
    int style = GetWindowLong(main, -16);
    style &= ~(0x00C00000 | 0x00040000 | 0x00020000 | 0x00010000); // caption, sizing frame, min/max boxes
    SetWindowLong(main, -16, style);
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    GetMonitorInfo(MonitorFromWindow(main, 2), ref mi);
    var r = mi.rcMonitor;
    ShowWindow(main, 9);
    SetWindowPos(main, IntPtr.Zero, r.L, r.T, r.R - r.L, r.B - r.T, 0x0020 | 0x0040); // FRAMECHANGED | SHOWWINDOW
    Focus(main);
    RECT now; GetWindowRect(main, out now);
    return "ok " + (now.R - now.L) + "x" + (now.B - now.T);
  }

  public static string Minimize(string prefix) {
    IntPtr main = FindByTitle(prefix);
    if (main == IntPtr.Zero) return "notfound";
    ShowWindow(main, 6);
    return "ok";
  }
}
"@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'move'       { [StvInput]::Move([int]$p[1], [int]$p[2]) }
      'click'      { [StvInput]::Click($p[1] -eq 'right') }
      'scroll'     { [StvInput]::Scroll([int]$p[1]) }
      'key'        { [StvInput]::Key([byte][int]$p[1]) }
      'fullscreen' { [Console]::Out.WriteLine('fullscreen ' + [StvInput]::Fullscreen($line.Substring(11))) }
      'minimize'   { [Console]::Out.WriteLine('minimize ' + [StvInput]::Minimize($line.Substring(9))) }
    }
  } catch { [Console]::Out.WriteLine($p[0] + ' error ' + $_.Exception.Message) }
}
`;

const VK = { volumeMute: 0xad, volumeDown: 0xae, volumeUp: 0xaf };

let proc = null;
let restarts = 0;
let stopping = false;
let outBuf = '';
const waiting = [];   // pending answers to window commands: [{ verb, resolve, timer }]

function start() {
  if (process.platform !== 'win32' || proc) return;
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => {
    restarts = 0;
    outBuf += d.toString();
    let nl;
    while ((nl = outBuf.indexOf('\n')) >= 0) {
      const line = outBuf.slice(0, nl).trim();
      outBuf = outBuf.slice(nl + 1);
      const i = waiting.findIndex((w) => line.startsWith(`${w.verb} `));
      if (i >= 0) {
        const [w] = waiting.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(line.slice(w.verb.length + 1));
      }
    }
  });
  proc.stderr.on('data', (d) => console.warn('[input-helper]', d.toString().trim()));
  proc.on('exit', () => {
    proc = null;
    if (!stopping && restarts++ < 5) setTimeout(start, 1000);
  });
}

function write(line) {
  if (!proc) start();
  if (proc && proc.stdin.writable) proc.stdin.write(`${line}\n`);
}

function request(verb, arg, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const w = { verb, resolve, timer: null };
    w.timer = setTimeout(() => {
      const i = waiting.indexOf(w);
      if (i >= 0) waiting.splice(i, 1);
      resolve('timeout');
    }, timeoutMs);
    waiting.push(w);
    write(`${verb} ${String(arg).replace(/[\r\n]/g, '')}`);
  });
}

const toInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

module.exports = {
  start,
  stop() {
    stopping = true;
    if (proc) proc.kill();
  },
  move(dx, dy) {
    const x = toInt(dx, -2000, 2000);
    const y = toInt(dy, -2000, 2000);
    if (x || y) write(`move ${x} ${y}`);
  },
  click(button) {
    write(`click ${button === 'right' ? 'right' : 'left'}`);
  },
  scroll(amount) {
    const a = toInt(amount, -2400, 2400);
    if (a) write(`scroll ${a}`);
  },
  volume(action) {
    const vk = { up: VK.volumeUp, down: VK.volumeDown, mute: VK.volumeMute }[action];
    if (vk) write(`key ${vk}`);
  },
  /** Puts the window whose title starts with `titlePrefix` over the whole screen and focuses it. */
  fullscreenWindow: (titlePrefix) => request('fullscreen', titlePrefix),
  minimizeWindow: (titlePrefix) => request('minimize', titlePrefix),
};
