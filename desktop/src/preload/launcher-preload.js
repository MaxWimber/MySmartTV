'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['go-home', 'media', 'pairing-changed', 'remote-clients', 'library-changed', 'toast']);

contextBridge.exposeInMainWorld('stv', {
  getState: () => ipcRenderer.invoke('state:get'),
  openTile: (id) => ipcRenderer.invoke('tile:open', id),
  addTile: (tile) => ipcRenderer.invoke('tile:add', tile),
  removeTile: (id) => ipcRenderer.invoke('tile:remove', id),
  addFolder: () => ipcRenderer.invoke('folder:add'),
  removeFolder: (folder) => ipcRenderer.invoke('folder:remove', folder),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  getPairing: () => ipcRenderer.invoke('pair:get'),
  removeDevice: (id) => ipcRenderer.invoke('device:remove', id),
  openUrl: (url) => ipcRenderer.invoke('url:open', url),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  setScreen: (name) => ipcRenderer.send('screen', name),
  quit: () => ipcRenderer.send('app:quit'),
  on(channel, callback) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown channel ${channel}`);
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
