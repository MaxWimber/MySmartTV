'use strict';
/* global stv */

// ---------------------------------------------------------------- helpers

const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : `${Math.max(1, Math.round(b / 1e6))} МБ`);
const fmtDate = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const pad = (n) => String(n).padStart(2, '0');
function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '--:--';
  const s = Math.floor(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh}:${pad(mm)}:${pad(s % 60)}` : `${mm}:${pad(s % 60)}`;
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const isTextField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// Saved playback positions for local videos: { t: seconds, d: duration }.
function loadPos(path) {
  try { return JSON.parse(localStorage.getItem(`pos:${path}`)); } catch { return null; }
}

// ---------------------------------------------------------------- state

let state = { tiles: [], videos: [], videoCount: 0, folders: [], remoteClients: 0 };
let screen = 'home';
const rowMemory = new Map();   // row name -> data-key of the last focused card
const dialogStack = [];

async function refresh() {
  state = await stv.getState();
  renderHome();
  setRemoteStatus(state.remoteClients);
}

function setRemoteStatus(count) {
  const el = $('remoteStatus');
  el.textContent = count > 1 ? `Пультов подключено: ${count}` : 'Пульт подключён';
  el.classList.toggle('hidden', !count);
}

// ---------------------------------------------------------------- home screen

function card(cls, key, onclick, ...children) {
  return h('button', { class: `card ${cls} focusable`, dataset: { key }, onclick }, ...children);
}

function actionCard(key, icon, title, onclick) {
  return card('action', key, onclick, h('div', { class: 'action-icon' }, icon), h('div', { class: 'action-title' }, title));
}

function renderHome() {
  const focusedKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;

  $('tilesRow').replaceChildren(
    ...state.tiles.map((t) => {
      const el = card('tile', `tile:${t.id}`, () => stv.openTile(t.id), t.title, t.custom ? h('span', { class: 'tile-sub' }, hostOf(t.url)) : null);
      el.style.setProperty('--tile-color', t.color);
      return el;
    }),
    card('tile add', 'tile:add', showAddTile, '+ Добавить сайт'),
  );

  $('videosTitle').textContent = state.videoCount ? `Мои видео · ${state.videoCount}` : 'Мои видео';
  const videoCards = state.videos.map((v) => {
    const pos = loadPos(v.path);
    const pct = pos && pos.d ? Math.min(100, (pos.t / pos.d) * 100) : 0;
    return card('video', `video:${v.path}`, () => player.open(v),
      h('div', { class: 'video-name' }, v.name),
      h('div', { class: 'video-meta' }, h('span', {}, fmtDate(v.mtime)), h('span', {}, fmtSize(v.size))),
      pct ? h('div', { class: 'video-progress', style: { width: `${pct}%` } }) : null);
  });
  if (!videoCards.length) {
    videoCards.push(h('div', { class: 'empty-note' }, 'Видео не найдено. Добавьте папку с фильмами →'));
  }
  $('videosRow').replaceChildren(...videoCards, actionCard('video:folders', '📁', 'Папки с видео', showManage));

  $('settingsRow').replaceChildren(
    actionCard('set:pair', '📱', 'Подключить пульт', showPairing),
    actionCard('set:url', '🔗', 'Открыть ссылку', showOpenUrl),
    actionCard('set:manage', '⚙️', 'Плитки и папки', showManage),
    actionCard('set:fullscreen', '⛶', 'Во весь экран', () => stv.toggleFullscreen()),
    actionCard('set:quit', '⏻', 'Выход', () => stv.quit()),
  );

  if (screen !== 'home' || dialogStack.length) return;
  const el = focusedKey && document.querySelector(`#rows [data-key="${CSS.escape(focusedKey)}"]`);
  if (el) el.focus({ preventScroll: true });
  else if (!document.activeElement || !document.activeElement.closest('#rows')) focusDefault(true);
}

function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  const row = el.closest('.row');
  if (row) rowMemory.set(row.dataset.row, el.dataset.key);
}

function focusDefault(reset = false) {
  if (reset) {
    $('rows').scrollTo({ top: 0, behavior: 'smooth' });
    focusEl(document.querySelector('#rows .focusable'));
    return;
  }
  const active = document.activeElement;
  if (!active || active === document.body) focusEl(document.querySelector('#rows .focusable'));
}

// TV-style navigation: left/right inside a row, up/down jumps between rows
// and returns to the card that was last focused in that row.
function homeMove(dir) {
  const cur = document.activeElement;
  const rowEl = cur && cur.closest('#rows .row');
  if (!rowEl) {
    focusDefault(true);
    return;
  }
  const items = [...rowEl.querySelectorAll('.focusable')];
  const i = items.indexOf(cur);
  if (dir === 'left' && i > 0) focusEl(items[i - 1]);
  if (dir === 'right' && i < items.length - 1) focusEl(items[i + 1]);
  if (dir === 'up' || dir === 'down') {
    const rows = [...document.querySelectorAll('#rows .row')].filter((r) => r.querySelector('.focusable'));
    const ri = rows.indexOf(rowEl) + (dir === 'down' ? 1 : -1);
    if (ri < 0) {
      $('rows').scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (ri >= rows.length) return;
    const target = rows[ri];
    const remembered = rowMemory.get(target.dataset.row);
    const el = (remembered && target.querySelector(`[data-key="${CSS.escape(remembered)}"]`)) || target.querySelector('.focusable');
    focusEl(el);
    if (ri === 0) $('rows').scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Generic spatial navigation, used inside dialogs.
function spatMove(dir, root) {
  const list = [...root.querySelectorAll('.focusable')].filter((el) => !el.disabled && el.offsetParent !== null);
  const cur = document.activeElement;
  if (!root.contains(cur) || !list.includes(cur)) {
    if (list[0]) list[0].focus();
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    let main;
    let cross;
    if (dir === 'left') { if (bx >= ax - 1) continue; main = a.left - b.right; cross = Math.abs(by - ay); }
    if (dir === 'right') { if (bx <= ax + 1) continue; main = b.left - a.right; cross = Math.abs(by - ay); }
    if (dir === 'up') { if (by >= ay - 1) continue; main = a.top - b.bottom; cross = Math.abs(bx - ax); }
    if (dir === 'down') { if (by <= ay + 1) continue; main = b.top - a.bottom; cross = Math.abs(bx - ax); }
    const score = Math.max(0, main) + cross * (dir === 'left' || dir === 'right' ? 3 : 1);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'nearest' });
  }
}

function goHome() {
  if (player.active) player.close();
  while (dialogStack.length) closeDialog();
  focusDefault(true);
}

// ---------------------------------------------------------------- dialogs

function openDialog(type, build) {
  const box = h('div', { class: 'dialog', role: 'dialog' });
  const backdrop = h('div', { class: 'dialog-backdrop' }, box);
  const d = { type, el: box, backdrop, prevFocus: document.activeElement, refresh: null };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeDialog(d); });
  $('dialogs').append(backdrop);
  dialogStack.push(d);
  build(box, d);
  focusInside(box);
  return d;
}

function focusInside(box) {
  if (box.contains(document.activeElement)) return;
  const el = box.querySelector('[autofocus]') || box.querySelector('.focusable');
  if (el) el.focus();
}

function closeDialog(d = dialogStack[dialogStack.length - 1]) {
  if (!d) return;
  const i = dialogStack.indexOf(d);
  if (i >= 0) dialogStack.splice(i, 1);
  d.backdrop.remove();
  const top = dialogStack[dialogStack.length - 1];
  if (top) focusInside(top.el);
  else if (d.prevFocus && d.prevFocus.isConnected) d.prevFocus.focus({ preventScroll: true });
  else focusDefault();
}

function buttons(...list) {
  return h('div', { class: 'dialog-buttons' }, ...list);
}

function btn(label, onclick, cls = '') {
  return h('button', { class: `btn focusable ${cls}`, onclick }, label);
}

function inputField(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function showPairing() {
  openDialog('pair', (box, d) => {
    d.refresh = async () => {
      const p = await stv.getPairing();
      const focusedKey = document.activeElement && document.activeElement.dataset.key;
      const devices = p.devices.length
        ? p.devices.map((dev) => h('div', { class: 'list-item' },
          h('div', { class: 'li-text' },
            h('div', { class: 'li-title' }, dev.name),
            h('div', { class: 'li-sub' }, `Подключён ${fmtDate(dev.pairedAt)}`)),
          h('button', {
            class: 'btn danger focusable',
            dataset: { key: `dev:${dev.id}` },
            onclick: async () => { await stv.removeDevice(dev.id); d.refresh(); },
          }, 'Отвязать')))
        : [h('p', {}, 'Пока ни одного пульта.')];

      box.replaceChildren(
        h('h1', {}, 'Подключить пульт'),
        p.qr
          ? h('div', { class: 'pair' },
            h('img', { src: p.qr, alt: 'QR-код для подключения' }),
            h('div', {},
              h('p', {}, 'Наведите камеру телефона на QR-код. Телефон должен быть в той же сети Wi-Fi.'),
              h('p', {}, 'Или откройте в браузере телефона:'),
              h('p', { class: 'pair-url' }, p.remoteUrl),
              h('p', {}, 'и введите PIN:'),
              h('div', { class: 'pin' }, ...p.pin.split('').map((c) => h('span', {}, c)))))
          : h('p', {}, 'Компьютер не подключён к сети. Подключитесь к Wi-Fi или кабелем и откройте это окно снова.'),
        h('h3', {}, 'Подключённые пульты'),
        ...devices,
        buttons(h('button', { class: 'btn primary focusable', dataset: { key: 'pair:done' }, onclick: () => closeDialog(d) }, 'Готово')),
      );
      const again = focusedKey && box.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
      if (again) again.focus();
      else focusInside(box);
    };
    d.refresh();
  });
}

function showAddTile() {
  openDialog('addTile', (box, d) => {
    const name = h('input', { type: 'text', class: 'focusable', maxlength: '40', placeholder: 'Например, Кинопоиск', autofocus: true });
    const url = h('input', { type: 'text', class: 'focusable', spellcheck: 'false', placeholder: 'https://www.kinopoisk.ru' });
    const error = h('p', { class: 'form-error' });
    const submit = async () => {
      const res = await stv.addTile({ title: name.value, url: url.value });
      if (!res.ok) {
        error.textContent = res.error;
        url.focus();
        return;
      }
      closeDialog(d);
      await refresh();
      toast('Плитка добавлена');
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); url.focus(); } });
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    box.append(
      h('h1', {}, 'Добавить сайт'),
      h('p', {}, 'Плитка появится в ряду «Приложения». Сайт откроется внутри SmartTV, по нему можно ходить стрелками.'),
      inputField('Название', name),
      inputField('Адрес сайта', url),
      error,
      buttons(btn('Добавить', submit, 'primary'), btn('Отмена', () => closeDialog(d))),
    );
  });
}

function showOpenUrl() {
  openDialog('openUrl', (box, d) => {
    const url = h('input', { type: 'text', class: 'focusable', spellcheck: 'false', placeholder: 'https://youtu.be/…', autofocus: true });
    const error = h('p', { class: 'form-error' });
    const submit = async () => {
      if (await stv.openUrl(url.value)) closeDialog(d);
      else error.textContent = 'Неверная ссылка';
    };
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    box.append(
      h('h1', {}, 'Открыть ссылку'),
      h('p', {}, 'Ссылки на YouTube откроются в ТВ-версии YouTube, остальные как сайт.'),
      inputField('Ссылка', url),
      error,
      buttons(btn('Открыть', submit, 'primary'), btn('Отмена', () => closeDialog(d))),
    );
  });
}

function showManage() {
  openDialog('manage', (box, d) => {
    d.refresh = async () => {
      await refresh();
      const focusedKey = document.activeElement && document.activeElement.dataset.key;
      const custom = state.tiles.filter((t) => t.custom);
      box.replaceChildren(
        h('h1', {}, 'Плитки и папки'),
        h('h3', {}, 'Мои сайты'),
        ...(custom.length
          ? custom.map((t) => h('div', { class: 'list-item' },
            h('div', { class: 'li-text' }, h('div', { class: 'li-title' }, t.title), h('div', { class: 'li-sub' }, t.url)),
            h('button', {
              class: 'btn danger focusable',
              dataset: { key: `rm-tile:${t.id}` },
              onclick: async () => { await stv.removeTile(t.id); d.refresh(); },
            }, 'Удалить')))
          : [h('p', {}, 'Своих плиток пока нет.')]),
        h('h3', {}, 'Папки с видео'),
        ...(state.folders.length
          ? state.folders.map((f) => h('div', { class: 'list-item' },
            h('div', { class: 'li-text' }, h('div', { class: 'li-title' }, f)),
            h('button', {
              class: 'btn danger focusable',
              dataset: { key: `rm-folder:${f}` },
              onclick: async () => { await stv.removeFolder(f); d.refresh(); },
            }, 'Удалить')))
          : [h('p', {}, 'Папок нет.')]),
        h('p', {}, `Найдено видео: ${state.videoCount}`),
        buttons(
          h('button', { class: 'btn focusable', dataset: { key: 'm:add-tile' }, onclick: showAddTile }, '+ Сайт'),
          h('button', { class: 'btn focusable', dataset: { key: 'm:add-folder' }, onclick: async () => { if (await stv.addFolder()) d.refresh(); } }, '+ Папка'),
          h('button', { class: 'btn focusable', dataset: { key: 'm:rescan' }, onclick: async () => { const n = await stv.rescan(); toast(`Найдено видео: ${n}`); d.refresh(); } }, 'Обновить'),
          h('button', { class: 'btn primary focusable', dataset: { key: 'm:done' }, onclick: () => closeDialog(d) }, 'Готово'),
        ),
      );
      const again = focusedKey && box.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
      if (again) again.focus();
      else focusInside(box);
    };
    d.refresh();
  });
}

// ---------------------------------------------------------------- local video player

const player = (() => {
  const root = $('player');
  const video = $('video');
  const osd = $('osd');
  let current = null;
  let hideTimer = null;
  let saveTimer = null;

  function savePos() {
    if (!current || !Number.isFinite(video.duration) || video.currentTime < 5) return;
    const key = `pos:${current.path}`;
    if (video.duration - video.currentTime < 20) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ t: video.currentTime, d: video.duration }));
  }

  function updateOsd() {
    const d = video.duration;
    $('osdProgress').style.width = Number.isFinite(d) && d > 0 ? `${(video.currentTime / d) * 100}%` : '0';
    $('osdTime').textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
    $('osdState').textContent = video.paused ? '❚❚ Пауза' : '▶ Воспроизведение';
  }

  function showOsd() {
    osd.classList.remove('faded');
    root.classList.remove('idle');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) {
        osd.classList.add('faded');
        root.classList.add('idle');
      }
    }, 3000);
    updateOsd();
  }

  function open(v) {
    current = v;
    screen = 'player';
    stv.setScreen('player');
    root.classList.remove('hidden');
    $('playerError').classList.add('hidden');
    $('osdTitle').textContent = v.name;
    if (document.activeElement) document.activeElement.blur();
    const saved = loadPos(v.path);
    video.addEventListener('loadedmetadata', () => {
      if (saved && saved.t > 30 && saved.t < video.duration - 30) {
        video.currentTime = saved.t;
        toast(`Продолжаем с ${fmtTime(saved.t)}`);
      }
    }, { once: true });
    video.src = v.url;
    video.play().catch(() => {});
    showOsd();
    saveTimer = setInterval(savePos, 5000);
  }

  function close() {
    if (!current) return;
    savePos();
    clearInterval(saveTimer);
    clearTimeout(hideTimer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    root.classList.add('hidden');
    current = null;
    screen = 'home';
    stv.setScreen('home');
    renderHome();
    focusDefault();
  }

  function toggle() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    showOsd();
  }

  function seek(delta) {
    if (!Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta));
    showOsd();
  }

  function media(action) {
    if (action === 'playpause') toggle();
    if (action === 'seekfwd') seek(10);
    if (action === 'seekback') seek(-10);
  }

  function onKey(e) {
    const actions = {
      Enter: toggle,
      ' ': toggle,
      MediaPlayPause: toggle,
      ArrowLeft: () => seek(-10),
      ArrowRight: () => seek(10),
      ArrowUp: () => seek(60),
      ArrowDown: () => seek(-60),
      MediaTrackNext: () => seek(60),
      MediaTrackPrevious: () => seek(-60),
      Escape: close,
      BrowserBack: close,
      Backspace: close,
    };
    const fn = actions[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    } else {
      showOsd();
    }
  }

  video.addEventListener('timeupdate', updateOsd);
  video.addEventListener('pause', showOsd);
  video.addEventListener('play', showOsd);
  video.addEventListener('ended', () => {
    if (current) localStorage.removeItem(`pos:${current.path}`);
    close();
  });
  video.addEventListener('error', () => {
    if (!current) return;
    const box = $('playerError');
    box.replaceChildren(
      h('div', {}, 'Не удалось воспроизвести файл'),
      h('small', {}, 'Скорее всего, формат или кодек не поддерживается (например, AVI, HEVC/H.265, AC3/DTS-звук). Лучше всего работают MP4 (H.264/AAC) и WebM.'),
      h('small', {}, 'Esc — назад'),
    );
    box.classList.remove('hidden');
  });
  root.addEventListener('mousemove', showOsd);
  video.addEventListener('click', toggle);

  return {
    open,
    close,
    onKey,
    media,
    get active() { return !!current; },
  };
})();

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  if (e.key === 'BrowserHome' || (e.ctrlKey && e.code === 'KeyH')) {
    e.preventDefault();
    goHome();
    return;
  }
  if (screen === 'player') {
    player.onKey(e);
    return;
  }
  const top = dialogStack[dialogStack.length - 1];
  if (e.key === 'Escape' || e.key === 'BrowserBack') {
    e.preventDefault();
    if (top) closeDialog(top);
    else focusDefault(true);
    return;
  }
  const dir = DIRS[e.key];
  if (!dir) return;
  if (top) {
    if (isTextField(e.target) && (dir === 'left' || dir === 'right')) return;
    e.preventDefault();
    spatMove(dir, top.el);
    return;
  }
  e.preventDefault();
  homeMove(dir);
});

// ---------------------------------------------------------------- clock & events

function tick() {
  const now = new Date();
  $('clockTime').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $('clockDate').textContent = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}
tick();
setInterval(tick, 5000);

stv.on('go-home', goHome);
stv.on('media', (action) => { if (player.active) player.media(action); });
stv.on('pairing-changed', () => dialogStack.filter((d) => d.type === 'pair').forEach((d) => d.refresh()));
stv.on('remote-clients', setRemoteStatus);
stv.on('library-changed', () => { if (screen === 'home') refresh(); });
stv.on('toast', toast);

refresh().then(() => focusDefault(true));
