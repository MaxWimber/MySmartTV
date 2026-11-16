'use strict';
/* global stv */
// SmartTV panel: Google TV start-up status, remote pairing and paired phones.

const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const fmtDate = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------------------------------------------------------------- Google TV status

const TITLES = {
  stopped: 'Google TV выключен',
  missing: 'Google TV не установлен',
  'no-accel': 'Нужна виртуализация Windows',
  starting: 'Запуск Google TV…',
  booting: 'Запуск Google TV…',
  ready: 'Google TV работает',
  error: 'Google TV не запустился',
};

const HELP = {
  'no-accel': [
    'Google TV работает в виртуальной машине, ей нужна «Платформа гипервизора Windows».',
    'Откройте PowerShell от имени администратора и выполните:',
    h('code', {}, 'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All'),
    'Затем перезагрузите компьютер.',
  ],
  missing: [
    'Нужны Android SDK с эмулятором и образ Google TV (system-images;android-34;google-tv;x86), а также виртуальное устройство SmartTV_GoogleTV.',
    'Инструкция — в README проекта.',
  ],
};

function renderStatus({ status, detail }) {
  $('tvTitle').textContent = TITLES[status] || status;
  $('tvDetail').textContent = status === 'booting' ? 'Первый запуск занимает пару минут, дальше — несколько секунд.' : detail || '';
  $('spinner').classList.toggle('hidden', status !== 'starting' && status !== 'booting');
  $('btnTv').classList.toggle('hidden', status !== 'ready');
  const help = HELP[status];
  $('help').replaceChildren(...(help || []).map((line) => (line instanceof Node ? line : h('p', {}, line))));
  $('help').classList.toggle('hidden', !help);
  if (!document.activeElement || document.activeElement === document.body || document.activeElement.classList.contains('hidden')) {
    focusFirst();
  }
}

// ---------------------------------------------------------------- pairing

async function renderPairing() {
  const p = await stv.getPairing();
  $('pair').replaceChildren(
    p.qr
      ? h('div', { class: 'pair-box' },
        h('img', { class: 'qr', src: p.qr, alt: 'QR-код' }),
        h('div', {},
          h('ol', {},
            h('li', {}, 'Установите на телефон приложение «SmartTV пульт».'),
            h('li', {}, 'Нажмите «Сканировать QR-код» и наведите камеру на этот код.'),
            h('li', {}, 'Или выберите этот компьютер в списке и введите PIN.')),
          h('div', { class: 'pin-label' }, 'PIN'),
          h('div', { class: 'pin' }, p.pin),
          h('div', { class: 'muted' }, p.remoteUrl)))
      : h('p', { class: 'muted' }, 'Компьютер не подключён к сети. Подключите Wi-Fi или кабель.'),
  );
  $('devices').replaceChildren(
    ...(p.devices.length
      ? p.devices.map((dev) => h('div', { class: 'device' },
        h('div', { class: 'device-info' },
          h('div', { class: 'device-name' }, dev.name),
          h('div', { class: 'muted' }, `Подключён ${fmtDate(dev.pairedAt)}`)),
        h('button', {
          class: 'btn small focusable',
          onclick: async () => {
            await stv.removeDevice(dev.id);
            toast(`«${dev.name}» отвязан`);
            renderPairing();
          },
        }, 'Отвязать')))
      : [h('p', { class: 'muted' }, 'Пока ни одного.')]),
  );
}

// ---------------------------------------------------------------- keyboard / remote navigation

const focusables = () => [...document.querySelectorAll('.focusable')].filter((el) => !el.closest('.hidden') && !el.classList.contains('hidden'));

function focusFirst() {
  const first = focusables()[0];
  if (first) first.focus();
}

// Picks the nearest element in the pressed direction.
function moveFocus(dir) {
  const items = focusables();
  const cur = document.activeElement;
  if (!items.includes(cur)) return focusFirst();
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = { up: -dy, down: dy, left: -dx, right: dx }[dir];
    if (along <= 1) continue;
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) best.focus();
  return undefined;
}

const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
document.addEventListener('keydown', (e) => {
  if (DIRS[e.key]) {
    e.preventDefault();
    moveFocus(DIRS[e.key]);
  } else if (e.key === 'Escape' || e.key === 'BrowserBack') {
    e.preventDefault();
    stv.showTv();
  }
});

// ---------------------------------------------------------------- start

$('btnTv').addEventListener('click', () => stv.showTv());
$('btnRestart').addEventListener('click', () => stv.restartTv());
$('btnQuit').addEventListener('click', () => stv.quit());

stv.on('tv-status', renderStatus);
stv.on('pairing-changed', renderPairing);
stv.on('toast', toast);

stv.getTvStatus().then(renderStatus);
renderPairing();
