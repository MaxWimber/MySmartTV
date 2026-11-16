'use strict';
// Built-in video services and link resolving ("open this URL on the TV").

// YouTube serves its TV interface (youtube.com/tv) only to TV browsers,
// so the YouTube view pretends to be a Samsung Tizen TV.
const TV_USER_AGENT =
  'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  '76.0.3809.146/6.0 TV Safari/537.36';

// tvMode: the site has its own remote-friendly UI (arrows, Enter, Escape = back).
// spatnav: inject our arrow-key navigation into a regular desktop site.
const BUILTIN_TILES = [
  {
    id: 'youtube',
    title: 'YouTube',
    url: 'https://www.youtube.com/tv',
    color: '#e62117',
    tvMode: true,
    userAgent: TV_USER_AGENT,
    hosts: ['youtube.com', 'youtu.be'],
  },
  {
    id: 'rutube',
    title: 'RUTUBE',
    url: 'https://rutube.ru/',
    color: '#1d2d5c',
    spatnav: true,
    hosts: ['rutube.ru'],
  },
  {
    id: 'vkvideo',
    title: 'VK Видео',
    url: 'https://vkvideo.ru/',
    color: '#0077ff',
    spatnav: true,
    hosts: ['vkvideo.ru', 'vk.com', 'vk.ru'],
  },
];

const TILE_COLORS = ['#7b3fe4', '#00897b', '#e65100', '#c2185b', '#3949ab', '#2e7d32', '#6d4c41', '#00838f'];

function parseHttpUrl(raw) {
  try {
    let s = String(raw ?? '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u;
  } catch {
    return null;
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function youtubeVideoId(u) {
  const host = u.hostname.toLowerCase();
  let id = null;
  if (hostMatches(host, 'youtu.be')) {
    id = u.pathname.slice(1).split('/')[0];
  } else if (hostMatches(host, 'youtube.com')) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/);
    if (m) id = m[1];
  }
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

// Turns any shared link into something the TV can open.
function resolveOpenTarget(raw) {
  const u = parseHttpUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const youtube = BUILTIN_TILES[0];

  if (youtube.hosts.some((d) => hostMatches(host, d))) {
    const id = youtubeVideoId(u);
    return {
      ...youtube,
      id: 'link',
      url: id ? `https://www.youtube.com/tv#/watch?v=${id}` : youtube.url,
    };
  }
  const builtin = BUILTIN_TILES.find((t) => t.hosts.some((d) => hostMatches(host, d)));
  return {
    id: 'link',
    title: builtin ? builtin.title : host,
    url: u.href,
    color: builtin ? builtin.color : '#444',
    spatnav: true,
  };
}

function pickColor(index) {
  return TILE_COLORS[index % TILE_COLORS.length];
}

module.exports = { BUILTIN_TILES, parseHttpUrl, resolveOpenTarget, pickColor };
