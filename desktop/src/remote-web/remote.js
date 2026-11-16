'use strict';
// Browser test remote. Speaks the same WebSocket protocol as the future
// Android app (docs/protocol.md).

const TOKEN_KEY = 'smarttv.token';
const $ = (id) => document.getElementById(id);

let ws = null;
let token = localStorage.getItem(TOKEN_KEY);
let authed = false;
let pendingPin = null;
let reconnectTimer = null;

// The QR code carries the PIN in the URL fragment: http://pc:8765/#pair=1234
const m = location.hash.match(/pair=(\d{4})/);
if (m) {
  pendingPin = m[1];
  history.replaceState(null, '', location.pathname);
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function deviceName() {
  const ua = navigator.userAgent;
  const android = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\sBuild|\))/);
  if (android) return android[1].trim().slice(0, 40);
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return 'Браузер';
}

function showPair(message = '') {
  $('remoteView').classList.add('hidden');
  $('pairView').classList.remove('hidden');
  $('pairError').textContent = message;
}

function showRemote() {
  $('pairView').classList.add('hidden');
  $('remoteView').classList.remove('hidden');
}

function setConnected(on) {
  $('connDot').classList.toggle('on', on);
  if (!on) $('screenTitle').textContent = 'Нет связи с ТВ, переподключаюсь…';
}

function pair(pin) {
  $('pairError').textContent = '';
  send({ type: 'pair', pin, name: deviceName() });
}

function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    if (token) send({ type: 'auth', token });
    else if (pendingPin) pair(pendingPin);
    else showPair();
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.type) {
      case 'paired':
        token = msg.token;
        localStorage.setItem(TOKEN_KEY, token);
        pendingPin = null;
        break;
      case 'authed':
        authed = true;
        setConnected(true);
        showRemote();
        break;
      case 'state':
        $('screenTitle').textContent = msg.title || '';
        break;
      case 'error':
        if (msg.code === 'bad_token' || msg.code === 'unauthorized') {
          token = null;
          authed = false;
          localStorage.removeItem(TOKEN_KEY);
          showPair(msg.message);
        } else if (msg.code === 'bad_pin') {
          pendingPin = null;
          showPair(msg.message);
        } else {
          $('remoteError').textContent = msg.message || msg.code;
          setTimeout(() => { $('remoteError').textContent = ''; }, 3000);
        }
        break;
      default:
        break;
    }
  };
  ws.onclose = () => {
    authed = false;
    setConnected(false);
    reconnectTimer = setTimeout(connect, 1500);
  };
}

// ---------------------------------------------------------------- pairing UI

$('pairBtn').addEventListener('click', () => {
  const pin = $('pinInput').value.trim();
  if (!/^\d{4}$/.test(pin)) {
    $('pairError').textContent = 'PIN: 4 цифры';
    return;
  }
  pair(pin);
});
$('pinInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  if (e.target.value.length === 4) $('pairBtn').click();
});

// ---------------------------------------------------------------- buttons

const buzz = () => { if (navigator.vibrate) navigator.vibrate(12); };
const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'seekfwd', 'seekback']);

function bindPress(el, action, repeat) {
  let delay = null;
  let interval = null;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(interval);
    el.classList.remove('pressed');
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('pressed');
    buzz();
    action();
    if (repeat) delay = setTimeout(() => { interval = setInterval(action, 110); }, 420);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

document.querySelectorAll('[data-key]').forEach((el) => {
  const key = el.dataset.key;
  bindPress(el, () => send({ type: 'key', key }), REPEATABLE.has(key));
});
document.querySelectorAll('[data-vol]').forEach((el) => {
  const action = el.dataset.vol;
  bindPress(el, () => send({ type: 'volume', action }), action !== 'mute');
});
document.querySelectorAll('[data-click]').forEach((el) => {
  bindPress(el, () => send({ type: 'click', button: el.dataset.click }), false);
});

document.querySelectorAll('.tabs button').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('hidden', s.id !== `tab-${tab.dataset.tab}`));
  });
});

$('sendText').addEventListener('click', () => {
  const text = $('textInput').value;
  if (!text) return;
  send({ type: 'text', text });
  $('textInput').value = '';
  buzz();
});
$('openUrl').addEventListener('click', () => {
  const url = $('urlInput').value.trim();
  if (!url) return;
  send({ type: 'open', url });
  $('urlInput').value = '';
  buzz();
});
$('unpair').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  token = null;
  if (ws) ws.close();
  showPair('Телефон отвязан. Чтобы подключиться снова, введите PIN.');
});

// ---------------------------------------------------------------- touchpad

(() => {
  const pad = $('touchpad');
  const pointers = new Map();
  let acc = { dx: 0, dy: 0 };
  let scrollAcc = 0;
  let frame = null;
  let tap = null;

  function flush() {
    frame = null;
    const dx = Math.round(acc.dx);
    const dy = Math.round(acc.dy);
    if (dx || dy) {
      send({ type: 'mouse', dx, dy });
      acc.dx -= dx;
      acc.dy -= dy;
    }
  }

  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap = pointers.size === 1 ? { t: performance.now(), moved: 0 } : null;
  });

  pad.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (tap) tap.moved += Math.abs(dx) + Math.abs(dy);

    if (pointers.size >= 2) {
      // Two fingers: wheel scrolling (only one of the fingers drives it).
      if (e.pointerId !== pointers.keys().next().value) return;
      scrollAcc += dy;
      while (Math.abs(scrollAcc) >= 24) {
        const dir = Math.sign(scrollAcc);
        send({ type: 'scroll', dy: dir * 120 });
        scrollAcc -= dir * 24;
      }
      return;
    }
    // Faster finger = disproportionately faster cursor.
    const speed = Math.hypot(dx, dy);
    const gain = 1.6 + Math.min(speed / 8, 2.5);
    acc.dx += dx * gain;
    acc.dy += dy * gain;
    if (!frame) frame = requestAnimationFrame(flush);
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (tap && pointers.size === 0 && tap.moved < 10 && performance.now() - tap.t < 250) {
      send({ type: 'click', button: 'left' });
      buzz();
    }
    if (pointers.size === 0) {
      tap = null;
      scrollAcc = 0;
    }
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
})();

connect();
