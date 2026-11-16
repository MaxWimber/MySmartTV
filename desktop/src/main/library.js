'use strict';
// Finds local video files in the configured folders.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Containers Chromium can usually play. AVI and HEVC/AC3 tracks are not supported.
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv']);

async function scan(folders, { maxDepth = 4, maxFiles = 1000 } = {}) {
  const found = new Map();

  async function walk(dir, depth) {
    if (depth > maxDepth || found.size >= maxFiles) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.size >= maxFiles) return;
      if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) {
        try {
          const st = await fs.promises.stat(full);
          found.set(full.toLowerCase(), {
            name: path.parse(entry.name).name,
            path: full,
            url: pathToFileURL(full).href,
            size: st.size,
            mtime: st.mtimeMs,
          });
        } catch {
          // file vanished or is not readable
        }
      }
    }
  }

  for (const folder of folders) await walk(folder, 0);
  return [...found.values()].sort((a, b) => b.mtime - a.mtime);
}

module.exports = { scan };
