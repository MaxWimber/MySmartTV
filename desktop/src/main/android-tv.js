'use strict';
// Google TV runs in the official Android emulator. This module starts the
// virtual TV, waits for it to boot and passes remote input to it through a
// long-lived `adb shell` (one `input` command takes ~25 ms there).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');

const AVD_NAME = 'SmartTV_GoogleTV';
const SYSTEM_IMAGE = 'system-images;android-34;google-tv;x86';
const CONSOLE_PORT = 5554;
const SERIAL = `emulator-${CONSOLE_PORT}`;
const WINDOW_TITLE = `Android Emulator - ${AVD_NAME}:${CONSOLE_PORT}`;

// Remote keys as Android KeyEvent codes.
const KEY_CODES = {
  up: 19,           // DPAD_UP
  down: 20,         // DPAD_DOWN
  left: 21,         // DPAD_LEFT
  right: 22,        // DPAD_RIGHT
  ok: 23,           // DPAD_CENTER
  enter: 66,        // ENTER
  back: 4,          // BACK
  home: 3,          // HOME
  playpause: 85,    // MEDIA_PLAY_PAUSE
  seekfwd: 90,      // MEDIA_FAST_FORWARD
  seekback: 89,     // MEDIA_REWIND
  backspace: 67,    // DEL
};
const KEYCODE_PASTE = 279;

const SMARTTUBE = 'org.smarttube.stable';
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

function sdkRoot() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'emulator', 'emulator.exe'))) || null;
}

function avdHome() {
  return process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd');
}

function run(file, args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Single-quote a string for the Android shell.
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

class AndroidTv extends EventEmitter {
  constructor() {
    super();
    this.status = 'stopped';   // stopped | missing | no-accel | starting | booting | ready | error
    this.detail = '';
    this.proc = null;
    this.shell = null;
    this.stopping = false;
    this.sdk = sdkRoot();
  }

  get emulatorExe() { return this.sdk && path.join(this.sdk, 'emulator', 'emulator.exe'); }
  get adbExe() { return this.sdk && path.join(this.sdk, 'platform-tools', 'adb.exe'); }
  get ready() { return this.status === 'ready'; }
  get windowTitle() { return WINDOW_TITLE; }

  setStatus(status, detail = '') {
    this.status = status;
    this.detail = detail;
    this.emit('status', status, detail);
  }

  /** Checks that the SDK, the Google TV image and the virtual TV exist. */
  checkInstall() {
    if (!this.sdk) return 'Не найден Android SDK с эмулятором.';
    const image = path.join(this.sdk, ...SYSTEM_IMAGE.split(';'));
    if (!fs.existsSync(path.join(image, 'system.img'))) return 'Не установлен образ Google TV.';
    if (!fs.existsSync(path.join(avdHome(), `${AVD_NAME}.ini`))) return `Не создано виртуальное устройство ${AVD_NAME}.`;
    if (!fs.existsSync(this.adbExe)) return 'Не найден adb (platform-tools).';
    return null;
  }

  async start() {
    if (this.proc) return undefined;
    this.stopping = false;
    const problem = this.checkInstall();
    if (problem) return this.setStatus('missing', problem);

    // An emulator left over from a previous run is simply reused.
    if (await this.isBooted()) return this.setStatus('ready');

    const accel = await run(this.emulatorExe, ['-accel-check'], { timeout: 20000 });
    if (!/^0\s*$/m.test(accel.stdout)) {
      return this.setStatus('no-accel', 'Не включена «Платформа гипервизора Windows».');
    }

    this.setStatus('starting');
    const args = ['-avd', AVD_NAME, '-port', String(CONSOLE_PORT), '-no-boot-anim', '-gpu', 'host'];
    this.proc = spawn(this.emulatorExe, args, { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (d) => { tail = (tail + d.toString()).slice(-4000); };
    this.proc.stdout.on('data', keep);
    this.proc.stderr.on('data', keep);
    this.proc.on('exit', (code) => {
      this.proc = null;
      this.closeShell();
      if (this.stopping) return this.setStatus('stopped');
      const lines = tail.trim().split(/\r?\n/).filter(Boolean);
      const last = lines.filter((l) => /error|fatal|failed|unknown/i.test(l)).pop() || lines.pop() || `код ${code}`;
      return this.setStatus('error', `Google TV завершился: ${last}`);
    });

    this.setStatus('booting');
    const deadline = Date.now() + 5 * 60 * 1000;
    while (this.proc && Date.now() < deadline) {
      if (await this.isBooted()) return this.setStatus('ready');
      await sleep(1500);
    }
    if (this.proc) this.setStatus('error', 'Google TV не загрузился за 5 минут.');
    return undefined;
  }

  async isBooted() {
    if (!this.adbExe) return false;
    const r = await run(this.adbExe, ['-s', SERIAL, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 5000 });
    return r.ok && r.stdout.trim() === '1';
  }

  /** Shuts Google TV down; Quick Boot saves its state so the next start takes seconds. */
  async stop() {
    this.stopping = true;
    this.closeShell();
    if (!this.proc && !this.ready) return;
    await run(this.adbExe, ['-s', SERIAL, 'emu', 'kill'], { timeout: 10000 });
    const proc = this.proc;
    if (proc) {
      const exited = new Promise((r) => proc.once('exit', r));
      await Promise.race([exited, sleep(20000)]);
      if (this.proc) this.proc.kill();
    }
    if (this.status === 'ready') this.setStatus('stopped');
  }

  // ------------------------------------------------------------ input

  /** Runs a command in the long-lived adb shell without waiting for it. */
  exec(command) {
    if (!this.ready) return;
    if (!this.shell) {
      const sh = spawn(this.adbExe, ['-s', SERIAL, 'shell'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      sh.on('exit', () => { if (this.shell === sh) this.shell = null; });
      sh.on('error', () => { if (this.shell === sh) this.shell = null; });
      this.shell = sh;
    }
    if (this.shell.stdin.writable) this.shell.stdin.write(`${command}\n`);
  }

  closeShell() {
    if (this.shell) this.shell.kill();
    this.shell = null;
  }

  key(name) {
    const code = KEY_CODES[name];
    if (!code || !this.ready) return false;
    this.exec(`input keyevent ${code}`);
    return true;
  }

  /**
   * Types text into the focused field. ASCII is typed by `input text`; other
   * alphabets (Cyrillic) go through the clipboard the emulator shares with
   * Windows: setHostClipboard puts the text there, then we paste.
   */
  async text(str, setHostClipboard) {
    if (!this.ready || !str) return;
    if (/^[\x20-\x7e]+$/.test(str)) {
      // `input text` reads %s as a space.
      this.exec(`input text ${shQuote(str.replace(/%/g, '').replace(/ /g, '%s'))}`);
      return;
    }
    setHostClipboard(str);
    await sleep(400); // the emulator syncs the clipboard asynchronously
    this.exec(`input keyevent ${KEYCODE_PASTE}`);
  }

  /** Opens a link in the Google TV app that handles it. */
  async openUrl(url) {
    if (!this.ready) return false;
    let cmd = `am start -a android.intent.action.VIEW -d ${shQuote(url)}`;
    // The official YouTube app refuses to run on the emulator (it is not a
    // YouTube-certified device), so YouTube links go to SmartTube if present.
    if (YOUTUBE_HOST.test(new URL(url).hostname) && await this.hasPackage(SMARTTUBE)) {
      cmd += ` -p ${SMARTTUBE}`;
    }
    const r = await run(this.adbExe, ['-s', SERIAL, 'shell', cmd], { timeout: 10000 });
    return r.ok && !/Error/i.test(r.stdout + r.stderr);
  }

  async hasPackage(name) {
    const r = await run(this.adbExe, ['-s', SERIAL, 'shell', 'pm', 'path', name], { timeout: 5000 });
    return r.ok && r.stdout.includes('package:');
  }
}

module.exports = { AndroidTv, AVD_NAME, SYSTEM_IMAGE, KEY_CODES };
