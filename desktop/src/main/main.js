'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, Menu } = require('electron');
const QRCode = require('qrcode');

const config = require('./config');
const library = require('./library');
const services = require('./services');
const inputHelper = require('./input-helper');
const { RemoteServer, getLanAddresses } = require('./remote-server');

const SRC = path.join(__dirname, '..');
const WEB_PARTITION = 'persist:web';
const SPATNAV_CODE = fs.readFileSync(path.join(SRC, 'inject', 'spatnav.js'), 'utf8');

// Arrow keys etc. as Electron key codes for sendInputEvent.
const NAV_KEYS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', ok: 'Enter', enter: 'Enter', backspace: 'Backspace' };

let win = null;
let remote = null;
let svc = null;            // currently open website: { view, tile, htmlFullscreen, autoFullscreen }
let rendererScreen = 'home';
let videos = [];

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(init);
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  inputHelper.stop();
  if (remote) remote.stop();
});

async function init() {
  config.load();
  Menu.setApplicationMenu(null);

  const webSession = session.fromPartition(WEB_PARTITION);
  // Some sites (Google sign-in among them) reject browsers that say "Electron".
  webSession.setUserAgent(webSession.getUserAgent().replace(/\s(Electron|smarttv|SmartTV)\/\S+/g, ''));
  webSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));

  createWindow();
  registerIpc();
  inputHelper.start();

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
  remote.on('command', handleRemoteCommand);
  remote.on('pin-changed', () => send('pairing-changed'));
  remote.on('paired', (device) => send('toast', `Пульт «${device.name}» подключён`));
  remote.on('clients-changed', (count) => send('remote-clients', count));
  remote.on('client-authed', (ws) => remote.send(ws, stateMessage()));
  try {
    await remote.start(config.get().port);
  } catch (err) {
    console.error('Remote server failed to start:', err);
  }

  rescanLibrary();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    show: false,
    title: 'SmartTV',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    fullscreen: !!config.get().startFullscreen,
    webPreferences: {
      preload: path.join(SRC, 'preload', 'launcher-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => {
    if (!win.isFullScreen()) win.maximize();
    win.show();
  });
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, layoutView);

  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    }
  });
  win.loadFile(path.join(SRC, 'renderer', 'index.html'));
}

// ---------------------------------------------------------------- web services

function openService(tile) {
  closeService({ notify: false });

  const view = new WebContentsView({
    webPreferences: {
      partition: WEB_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  view.setBackgroundColor('#000000');
  const state = { view, tile, htmlFullscreen: false, autoFullscreen: false };
  svc = state;
  const wc = view.webContents;
  if (tile.userAgent) wc.setUserAgent(tile.userAgent);

  win.contentView.addChildView(view);
  layoutView();

  wc.on('before-input-event', (e, input) => onServiceInput(state, e, input));
  // Pop-ups open in the same view: there is only one "screen" on a TV.
  wc.setWindowOpenHandler(({ url }) => {
    const u = services.parseHttpUrl(url);
    if (u) wc.loadURL(u.href).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('enter-html-full-screen', () => {
    state.htmlFullscreen = true;
    if (svc === state && !win.isFullScreen()) {
      state.autoFullscreen = true;
      win.setFullScreen(true);
    }
  });
  wc.on('leave-html-full-screen', () => {
    state.htmlFullscreen = false;
    if (svc === state && state.autoFullscreen) {
      state.autoFullscreen = false;
      win.setFullScreen(false);
    }
  });
  if (tile.spatnav) wc.on('dom-ready', () => wc.executeJavaScript(SPATNAV_CODE).catch(() => {}));
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 = ERR_ABORTED: a redirect or a new navigation replaced this one.
    if (!isMainFrame || code === -3 || svc !== state) return;
    goHome();
    send('toast', `${tile.title}: не удалось открыть (${description}). Проверьте интернет или VPN.`);
    if (remote) remote.broadcast({ type: 'error', code: 'load_failed', message: `${tile.title} не открылся: ${description}` });
  });
  wc.on('page-title-updated', () => broadcastState());
  wc.on('render-process-gone', () => { if (svc === state) goHome(); });

  wc.loadURL(tile.url).catch((err) => console.warn('loadURL:', err.message));
  wc.focus();
  broadcastState();
}

function closeService({ notify = true } = {}) {
  if (!svc) return;
  const { view, autoFullscreen } = svc;
  svc = null;
  win.contentView.removeChildView(view);
  view.webContents.close();
  if (autoFullscreen && win.isFullScreen()) win.setFullScreen(false);
  win.webContents.focus();
  if (notify) broadcastState();
}

function layoutView() {
  if (!svc || !win) return;
  const [width, height] = win.getContentSize();
  svc.view.setBounds({ x: 0, y: 0, width, height });
}

function onServiceInput(state, e, input) {
  if (input.type !== 'keyDown') return;
  const key = input.key;
  if (key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  } else if (key === 'BrowserHome' || (input.control && key.toLowerCase() === 'h')) {
    e.preventDefault();
    goHome();
  } else if (key === 'BrowserBack') {
    e.preventDefault();
    handleBack();
  } else if (key === 'Escape' && !state.tile.tvMode && !state.htmlFullscreen) {
    // TV sites handle Escape as "back" themselves; for regular sites we do it.
    e.preventDefault();
    handleBack();
  }
}

// ---------------------------------------------------------------- navigation

function activeWebContents() {
  return svc ? svc.view.webContents : win.webContents;
}

function sendKey(wc, keyCode) {
  wc.focus();
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
}

function runInAllFrames(wc, code) {
  for (const frame of wc.mainFrame.framesInSubtree) frame.executeJavaScript(code).catch(() => {});
}

function handleBack() {
  if (!svc) return sendKey(win.webContents, 'Escape'); // launcher closes dialogs / player
  const wc = svc.view.webContents;
  if (svc.tile.tvMode) return sendKey(wc, 'Escape');
  if (svc.htmlFullscreen) return runInAllFrames(wc, 'document.fullscreenElement && document.exitFullscreen()');
  if (wc.navigationHistory.canGoBack()) return wc.navigationHistory.goBack();
  return goHome();
}

function goHome() {
  closeService();
  if (win.isMinimized()) win.restore();
  win.focus();
  send('go-home');
}

function toggleFullscreen() {
  win.setFullScreen(!win.isFullScreen());
  if (svc) svc.autoFullscreen = false;
}

// Play/pause and seeking work on the biggest <video> on the page, in any frame.
function mediaScript(action) {
  return `(() => {
    const v = [...document.querySelectorAll('video')].filter((x) => x.readyState > 0)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!v) return false;
    const a = ${JSON.stringify(action)};
    if (a === 'playpause') { if (v.paused) v.play(); else v.pause(); }
    if (a === 'seekfwd') v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
    if (a === 'seekback') v.currentTime = Math.max(0, v.currentTime - 10);
    return true;
  })()`;
}

function media(action) {
  if (svc) runInAllFrames(svc.view.webContents, mediaScript(action));
  else send('media', action);
}

function typeText(text) {
  if (!text) return;
  const wc = activeWebContents();
  wc.focus();
  if (svc && svc.tile.tvMode) {
    // TV interfaces listen to key presses rather than to text insertion.
    for (const ch of text) {
      if (/^[a-z0-9]$/i.test(ch)) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
        wc.sendInputEvent({ type: 'char', keyCode: ch });
        wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
      } else {
        wc.sendInputEvent({ type: 'char', keyCode: ch });
      }
    }
  } else {
    wc.insertText(text);
  }
}

function openUrl(raw) {
  const target = services.resolveOpenTarget(raw);
  if (!target) return false;
  if (win.isMinimized()) win.restore();
  send('go-home');
  openService(target);
  return true;
}

// ---------------------------------------------------------------- remote

function handleRemoteCommand(msg, ws) {
  switch (msg.type) {
    case 'key': {
      const key = String(msg.key);
      if (key === 'back') return handleBack();
      if (key === 'home') return goHome();
      if (key === 'playpause' || key === 'seekfwd' || key === 'seekback') return media(key);
      if (NAV_KEYS[key]) sendKey(activeWebContents(), NAV_KEYS[key]);
      return undefined;
    }
    case 'text':
      return typeText(String(msg.text ?? '').slice(0, 500));
    case 'mouse':
      return inputHelper.move(msg.dx, msg.dy);
    case 'click':
      return inputHelper.click(msg.button);
    case 'scroll':
      return inputHelper.scroll(msg.dy);
    case 'volume':
      return inputHelper.volume(msg.action);
    case 'open':
      if (!openUrl(msg.url)) remote.send(ws, { type: 'error', code: 'bad_url', message: 'Не удалось открыть ссылку' });
      return undefined;
    case 'getState':
      return remote.send(ws, stateMessage());
    default:
      return undefined;
  }
}

function stateMessage() {
  if (svc) {
    return { type: 'state', screen: 'service', title: svc.view.webContents.getTitle() || svc.tile.title, tvMode: !!svc.tile.tvMode };
  }
  return { type: 'state', screen: rendererScreen, title: rendererScreen === 'player' ? 'Видеоплеер' : 'Главный экран', tvMode: false };
}

function broadcastState() {
  if (remote) remote.broadcast(stateMessage());
}

// ---------------------------------------------------------------- launcher IPC

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function allTiles() {
  const custom = config.get().customTiles.map((t) => ({ ...t, custom: true, spatnav: true }));
  return [...services.BUILTIN_TILES, ...custom].map(({ id, title, url, color, custom: isCustom }) => ({
    id, title, url, color, custom: !!isCustom,
  }));
}

async function rescanLibrary() {
  videos = await library.scan(config.get().folders);
  send('library-changed');
  return videos;
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

  handle('state:get', () => ({
    tiles: allTiles(),
    videos: videos.slice(0, 60),
    videoCount: videos.length,
    folders: config.get().folders,
    fullscreen: win.isFullScreen(),
    remoteClients: remote ? remote.clientCount() : 0,
  }));
  handle('tile:open', (id) => {
    const tile = [...services.BUILTIN_TILES, ...config.get().customTiles.map((t) => ({ ...t, spatnav: true }))]
      .find((t) => t.id === id);
    if (tile) openService(tile);
    return !!tile;
  });
  handle('tile:add', ({ title, url } = {}) => {
    const u = services.parseHttpUrl(url);
    const name = String(title ?? '').trim().slice(0, 40) || (u && u.hostname.replace(/^www\./, ''));
    if (!u) return { ok: false, error: 'Неверный адрес сайта' };
    config.update((c) => {
      c.customTiles.push({ id: `c_${crypto.randomBytes(4).toString('hex')}`, title: name, url: u.href, color: services.pickColor(c.customTiles.length) });
    });
    return { ok: true };
  });
  handle('tile:remove', (id) => {
    config.update((c) => { c.customTiles = c.customTiles.filter((t) => t.id !== id); });
    return true;
  });
  handle('folder:add', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Папка с видео', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return false;
    const folder = res.filePaths[0];
    config.update((c) => { if (!c.folders.includes(folder)) c.folders.push(folder); });
    await rescanLibrary();
    return true;
  });
  handle('folder:remove', async (folder) => {
    config.update((c) => { c.folders = c.folders.filter((f) => f !== folder); });
    await rescanLibrary();
    return true;
  });
  handle('library:rescan', async () => (await rescanLibrary()).length);
  handle('pair:get', pairingInfo);
  handle('device:remove', (id) => {
    config.update((c) => { c.devices = c.devices.filter((d) => d.id !== id); });
    if (remote) remote.disconnectDevice(id);
    return true;
  });
  handle('window:fullscreen', () => { toggleFullscreen(); return win.isFullScreen(); });
  handle('url:open', (url) => openUrl(url));

  ipcMain.on('screen', (e, name) => {
    if (e.sender !== win.webContents || !['home', 'player'].includes(name)) return;
    rendererScreen = name;
    broadcastState();
  });
  ipcMain.on('app:quit', (e) => { if (e.sender === win.webContents) app.quit(); });
}
