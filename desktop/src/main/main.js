'use strict';
// SmartTV: starts Google TV (the Android emulator) over the whole screen and
// bridges the phone remote to it. The SmartTV window itself is only a panel
// shown while Google TV boots and when a new remote needs to be paired.
const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, clipboard } = require('electron');
const QRCode = require('qrcode');

const config = require('./config');
const inputHelper = require('./input-helper');
const trayIcon = require('./tray-icon');
const { AndroidTv } = require('./android-tv');
const { RemoteServer, getLanAddresses } = require('./remote-server');

const SRC = path.join(__dirname, '..');
const PANEL_SHORTCUT = 'Control+Alt+S';
const PANEL_KEYS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', ok: 'Enter', enter: 'Enter', backspace: 'Backspace' };

let win = null;
let tray = null;
let remote = null;
let panelVisible = true;
let quitting = false;
const tv = new AndroidTv();

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());
  app.whenReady().then(init);
}

app.on('window-all-closed', () => { /* keeps running in the tray */ });

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  // Let Google TV save its state (Quick Boot), then exit.
  if (win && !win.isDestroyed()) win.hide();
  tv.stop().catch(() => {}).finally(() => {
    inputHelper.stop();
    if (remote) remote.stop();
    app.exit(0);
  });
});

async function init() {
  config.load();
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  registerIpc();
  inputHelper.start();
  globalShortcut.register(PANEL_SHORTCUT, () => (panelVisible && tv.ready ? showTv() : showPanel()));

  remote = new RemoteServer({
    staticDir: path.join(SRC, 'remote-web'),
    serverName: 'SmartTV',
    devices: {
      list: () => config.get().devices,
      add: (device) => config.update((c) => { c.devices.push(device); }),
      touch: (id) => config.update((c) => {
        const d = c.devices.find((x) => x.id === id);
        if (d) d.lastSeen = Date.now();
      }),
    },
  });
  remote.on('command', (msg, ws) => handleRemoteCommand(msg, ws).catch((err) => console.warn('remote command:', err)));
  remote.on('pin-changed', () => send('pairing-changed'));
  remote.on('paired', (device) => {
    send('toast', `Пульт «${device.name}» подключён`);
    send('pairing-changed');
    // The new remote is ready; go back to the TV.
    if (tv.ready) setTimeout(showTv, 1500);
  });
  remote.on('clients-changed', () => send('pairing-changed'));
  remote.on('client-authed', (ws) => remote.send(ws, stateMessage()));
  try {
    await remote.start(config.get().port);
  } catch (err) {
    console.error('Remote server failed to start:', err);
  }

  tv.on('status', (status, detail) => {
    send('tv-status', { status, detail });
    broadcastState();
    if (status === 'ready') showTv();
    else if (status !== 'starting' && status !== 'booting') showPanel();
  });
  tv.start();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    show: false,
    fullscreen: true,
    title: 'SmartTV',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(SRC, 'preload', 'launcher-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => { if (panelVisible) win.show(); });
  win.on('close', (e) => {
    // Closing the panel returns to the TV; quitting is in the tray menu.
    if (quitting) return;
    e.preventDefault();
    if (tv.ready) showTv();
    else win.minimize();
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  win.loadFile(path.join(SRC, 'renderer', 'index.html'));
}

function createTray() {
  tray = new Tray(trayIcon.create());
  tray.setToolTip('SmartTV');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Google TV', click: () => showTv() },
    { label: 'Подключить пульт', click: () => showPanel() },
    { label: 'Перезапустить Google TV', click: () => restartTv() },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]));
  tray.on('click', () => showPanel());
}

// ---------------------------------------------------------------- screens

function showPanel() {
  panelVisible = true;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setFullScreen(true);
  win.show();
  win.focus();
  send('pairing-changed');
  broadcastState();
}

async function showTv() {
  if (!tv.ready) return showPanel();
  panelVisible = false;
  if (win && !win.isDestroyed()) win.hide();
  broadcastState();
  // The emulator window may appear a little after boot completes.
  for (let i = 0; i < 10 && !panelVisible; i++) {
    const res = await inputHelper.fullscreenWindow(tv.windowTitle);
    if (res.startsWith('ok')) return undefined;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return undefined;
}

async function restartTv() {
  showPanel();
  await tv.stop();
  tv.start();
}

// ---------------------------------------------------------------- remote

function parseHttpUrl(raw) {
  try {
    const s = String(raw ?? '').trim();
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function panelKey(name) {
  if (name === 'home' || name === 'back') return showTv();
  const keyCode = PANEL_KEYS[name];
  if (!keyCode) return undefined;
  const wc = win.webContents;
  wc.focus();
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  return undefined;
}

async function handleRemoteCommand(msg, ws) {
  const onTv = tv.ready && !panelVisible;
  switch (msg.type) {
    case 'key':
      if (onTv) tv.key(String(msg.key));
      else panelKey(String(msg.key));
      return;
    case 'text': {
      const text = String(msg.text ?? '').slice(0, 500);
      if (onTv) await tv.text(text, (t) => clipboard.writeText(t));
      else win.webContents.insertText(text);
      return;
    }
    case 'mouse':
      inputHelper.move(msg.dx, msg.dy);
      return;
    case 'click':
      inputHelper.click(msg.button);
      return;
    case 'scroll':
      inputHelper.scroll(msg.dy);
      return;
    case 'volume':
      // Over Google TV its own volume slider shows (Windows hides its volume
      // flyout above fullscreen windows); on the panel the Windows volume changes.
      if (!(onTv && tv.volume(msg.action))) inputHelper.volume(msg.action);
      return;
    case 'open': {
      const url = parseHttpUrl(msg.url);
      if (!url) {
        remote.send(ws, { type: 'error', code: 'bad_url', message: 'Неверная ссылка' });
        return;
      }
      if (!tv.ready) {
        remote.send(ws, { type: 'error', code: 'load_failed', message: 'Google TV ещё запускается' });
        return;
      }
      if (panelVisible) await showTv();
      if (!(await tv.openUrl(url.href))) {
        remote.send(ws, { type: 'error', code: 'load_failed', message: 'На Google TV нет приложения для этой ссылки' });
      }
      return;
    }
    case 'getState':
      remote.send(ws, stateMessage());
      return;
    default:
  }
}

const STATUS_TITLES = {
  stopped: 'Google TV выключен',
  missing: 'Google TV не установлен',
  'no-accel': 'Нужна виртуализация Windows',
  starting: 'Запуск Google TV…',
  booting: 'Запуск Google TV…',
  ready: 'Google TV',
  error: 'Ошибка Google TV',
};

function stateMessage() {
  if (panelVisible || !tv.ready) {
    return { type: 'state', screen: 'home', title: tv.ready ? 'Панель SmartTV' : STATUS_TITLES[tv.status], tvMode: false };
  }
  return { type: 'state', screen: 'service', title: 'Google TV', tvMode: true };
}

function broadcastState() {
  if (remote) remote.broadcast(stateMessage());
}

// ---------------------------------------------------------------- panel IPC

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

async function pairingInfo() {
  const port = remote ? remote.port : null;
  const addresses = getLanAddresses();
  const pin = remote ? remote.pin : null;
  const remoteUrl = addresses.length && port ? `http://${addresses[0]}:${port}` : null;
  // The PIN travels in the URL fragment, which the browser never sends over the network.
  const qr = remoteUrl ? await QRCode.toDataURL(`${remoteUrl}/#pair=${pin}`, { margin: 1, width: 360 }) : null;
  return {
    pin,
    port,
    remoteUrl,
    addresses,
    qr,
    clients: remote ? remote.clientCount() : 0,
    devices: config.get().devices.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen })),
  };
}

function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (e.sender !== win.webContents) throw new Error('forbidden');
      return fn(...args);
    });

  handle('tv:status', () => ({ status: tv.status, detail: tv.detail }));
  handle('tv:show', () => showTv());
  handle('tv:restart', () => { restartTv(); return true; });
  handle('pair:get', pairingInfo);
  handle('device:remove', (id) => {
    config.update((c) => { c.devices = c.devices.filter((d) => d.id !== id); });
    if (remote) remote.disconnectDevice(id);
    return true;
  });
  ipcMain.on('app:quit', (e) => { if (e.sender === win.webContents) app.quit(); });
}
