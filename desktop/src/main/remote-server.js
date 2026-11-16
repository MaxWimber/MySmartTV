'use strict';
// Local-network server for remotes:
//  - HTTP: serves the browser test remote (src/remote-web)
//  - WebSocket /ws: JSON protocol, see docs/protocol.md
//  - UDP 8766: discovery, so the Android app can find the PC after its IP changes
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');

const PROTOCOL_VERSION = 1;
const DISCOVERY_PORT = 8766;
const DISCOVERY_REQUEST = 'SMARTTV_DISCOVER';
const MAX_PIN_FAILURES = 5;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const newPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

// IPv4 addresses of real network adapters (skips Hyper-V/WSL/VirtualBox/VPN-ish ones).
function getLanAddresses() {
  const virtual = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|TAP|Tailscale|ZeroTier/i;
  const result = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) result.push(a.address);
    }
  }
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return result.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

class RemoteServer extends EventEmitter {
  constructor({ staticDir, serverName, devices }) {
    super();
    this.staticDir = staticDir;
    this.serverName = serverName;
    this.devices = devices;
    this.port = null;
    this.pin = newPin();
    this.pinFailures = 0;
    this.http = null;
    this.wss = null;
    this.udp = null;
    this.serverId = crypto.createHash('sha1').update(os.hostname()).digest('hex').slice(0, 12);
  }

  async start(preferredPort) {
    for (let port = preferredPort; port < preferredPort + 10; port += 1) {
      try {
        await this._listen(port);
        this.port = port;
        break;
      } catch (err) {
        if (err.code !== 'EADDRINUSE') throw err;
      }
    }
    if (!this.port) throw new Error('No free port for the remote server');
    this._startDiscovery();
  }

  _listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this._serveStatic(req, res));
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        this.http = server;
        this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
        this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
        this._pingTimer = setInterval(() => this._pingAll(), 15000);
        resolve();
      });
    });
  }

  stop() {
    clearInterval(this._pingTimer);
    if (this.wss) for (const ws of this.wss.clients) ws.terminate();
    if (this.http) this.http.close();
    if (this.udp) this.udp.close();
  }

  _serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    const file = path.normalize(path.join(this.staticDir, pathname));
    if (!file.startsWith(this.staticDir + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  }

  _onConnection(ws, req) {
    // Browsers always send Origin. Only our own page may connect, so other
    // websites opened on the phone cannot talk to the TV. Native apps send none.
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
      if (!ok) {
        ws.close(1008, 'origin');
        return;
      }
    }
    ws.isAlive = true;
    ws.deviceId = null;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg && typeof msg === 'object') this._onMessage(ws, msg);
    });
    ws.on('close', () => { if (ws.deviceId) this.emit('clients-changed', this.clientCount()); });
    this.send(ws, { type: 'hello', name: this.serverName, id: this.serverId, version: PROTOCOL_VERSION, pairingRequired: true });
  }

  _onMessage(ws, msg) {
    if (msg.type === 'pair') return this._pair(ws, msg);
    if (msg.type === 'auth') return this._auth(ws, msg);
    if (msg.type === 'ping') return this.send(ws, { type: 'pong' });
    if (!ws.deviceId) return this.send(ws, { type: 'error', code: 'unauthorized', message: 'Сначала подключите пульт' });
    this.emit('command', msg, ws);
    return undefined;
  }

  _pair(ws, msg) {
    const pin = String(msg.pin ?? '');
    const ok = /^\d{4}$/.test(pin) && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(this.pin));
    if (!ok) {
      this.pinFailures += 1;
      if (this.pinFailures >= MAX_PIN_FAILURES) {
        this.pinFailures = 0;
        this._rotatePin();
      }
      this.send(ws, { type: 'error', code: 'bad_pin', message: 'Неверный PIN' });
      return;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const device = {
      id: crypto.randomBytes(6).toString('hex'),
      name: String(msg.name ?? 'Телефон').trim().slice(0, 40) || 'Телефон',
      tokenHash: sha256(token).toString('hex'),
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.devices.add(device);
    this.pinFailures = 0;
    this._rotatePin();
    this.send(ws, { type: 'paired', token, deviceId: device.id });
    this.emit('paired', device);
    this._authorize(ws, device);
  }

  _auth(ws, msg) {
    const hash = sha256(String(msg.token ?? ''));
    const device = this.devices.list().find((d) => {
      const stored = Buffer.from(String(d.tokenHash), 'hex');
      return stored.length === hash.length && crypto.timingSafeEqual(stored, hash);
    });
    if (!device) {
      this.send(ws, { type: 'error', code: 'bad_token', message: 'Пульт отвязан, подключите заново' });
      return;
    }
    this.devices.touch(device.id);
    this._authorize(ws, device);
  }

  _authorize(ws, device) {
    ws.deviceId = device.id;
    this.send(ws, { type: 'authed', deviceId: device.id, name: this.serverName });
    this.emit('client-authed', ws);
    this.emit('clients-changed', this.clientCount());
  }

  _rotatePin() {
    this.pin = newPin();
    this.emit('pin-changed', this.pin);
  }

  _pingAll() {
    for (const ws of this.wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  _startDiscovery() {
    const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('error', (err) => {
      console.warn('Discovery disabled:', err.message);
      udp.close();
      this.udp = null;
    });
    udp.on('message', (buf, rinfo) => {
      if (buf.toString().trim() !== DISCOVERY_REQUEST) return;
      const reply = JSON.stringify({ service: 'smarttv', name: this.serverName, id: this.serverId, port: this.port, version: PROTOCOL_VERSION });
      udp.send(reply, rinfo.port, rinfo.address);
    });
    udp.bind(DISCOVERY_PORT);
    this.udp = udp;
  }

  send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  broadcast(obj) {
    if (!this.wss) return;
    for (const ws of this.wss.clients) if (ws.deviceId) this.send(ws, obj);
  }

  clientCount() {
    if (!this.wss) return 0;
    return [...this.wss.clients].filter((ws) => ws.deviceId).length;
  }

  disconnectDevice(id) {
    if (!this.wss) return;
    for (const ws of this.wss.clients) {
      if (ws.deviceId === id) {
        this.send(ws, { type: 'error', code: 'bad_token', message: 'Пульт отвязан на телевизоре' });
        ws.close();
      }
    }
  }
}

module.exports = { RemoteServer, getLanAddresses, DISCOVERY_PORT };
