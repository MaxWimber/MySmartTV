'use strict';
// OS-level input for the remote: mouse cursor (touchpad), clicks, wheel and
// system volume. A long-lived PowerShell process calls user32.dll, so no native
// Node modules need to be compiled.
const { spawn } = require('node:child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class StvInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Move(int dx, int dy) { POINT p; GetCursorPos(out p); SetCursorPos(p.X + dx, p.Y + dy); }
  public static void Click(bool right) {
    mouse_event(right ? 0x0008u : 0x0002u, 0, 0, 0, UIntPtr.Zero);
    mouse_event(right ? 0x0010u : 0x0004u, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Scroll(int amount) { mouse_event(0x0800u, 0, 0, amount, UIntPtr.Zero); }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'move'   { [StvInput]::Move([int]$p[1], [int]$p[2]) }
      'click'  { [StvInput]::Click($p[1] -eq 'right') }
      'scroll' { [StvInput]::Scroll([int]$p[1]) }
      'key'    { [StvInput]::Key([byte][int]$p[1]) }
    }
  } catch { }
}
`;

const VK = { volumeMute: 0xad, volumeDown: 0xae, volumeUp: 0xaf };

let proc = null;
let restarts = 0;
let stopping = false;

function start() {
  if (process.platform !== 'win32' || proc) return;
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => { restarts = 0; });
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
};
