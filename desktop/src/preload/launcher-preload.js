'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['tv-status', 'pairing-changed', 'toast']);

contextBridge.exposeInMainWorld('stv', {
  getTvStatus: () => ipcRenderer.invoke('tv:status'),
  showTv: () => ipcRenderer.invoke('tv:show'),
  restartTv: () => ipcRenderer.invoke('tv:restart'),
  getPairing: () => ipcRenderer.invoke('pair:get'),
  removeDevice: (id) => ipcRenderer.invoke('device:remove', id),
  quit: () => ipcRenderer.send('app:quit'),
  on(channel, callback) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown channel ${channel}`);
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
