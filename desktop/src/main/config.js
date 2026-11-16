'use strict';
// Persistent settings stored as JSON in the user's AppData folder.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const defaults = () => ({
  devices: [],                   // [{ id, name, tokenHash, pairedAt, lastSeen }]
  port: 8765,
});

let data = null;
let file = null;

function load() {
  file = path.join(app.getPath('userData'), 'config.json');
  try {
    data = { ...defaults(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    data = defaults();
  }
  return data;
}

function get() {
  return data || load();
}

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function update(mutator) {
  mutator(get());
  save();
  return data;
}

module.exports = { load, get, update };
