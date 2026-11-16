'use strict';
// Tray icon drawn in code (a small TV screen), so the app ships no image files.
const zlib = require('node:zlib');
const { nativeImage } = require('electron');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function create(size = 32) {
  const s = size / 32;
  const inRect = (x, y, x0, y0, x1, y1) => x >= x0 * s && x < x1 * s && y >= y0 * s && y < y1 * s;
  return nativeImage.createFromBuffer(png(size, (x, y) => {
    if (inRect(x, y, 3, 6, 29, 23)) {
      return inRect(x, y, 5, 8, 27, 21) ? [77, 163, 255, 255] : [242, 244, 248, 255]; // screen and bezel
    }
    if (inRect(x, y, 11, 25, 21, 27) || inRect(x, y, 15, 23, 17, 25)) return [242, 244, 248, 255]; // stand
    return [0, 0, 0, 0];
  }));
}

module.exports = { create };
