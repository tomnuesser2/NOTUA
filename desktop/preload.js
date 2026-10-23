// Brücke zwischen notua.site und der Desktop-App.
// - window.notuaDesktop: index.html kann erkennen, dass es in der App läuft (zusätzlich zum UA-Marker).
// - Meldet die aktuellen UI-Farben an die App, damit das Startbild beim nächsten Start
//   im selben Look erscheint (hell, dunkel oder eigene Palette).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notuaDesktop', {
  isDesktop: true,
  platform: process.platform,
  retry: () => ipcRenderer.send('notua:retry')
});

const VARS = ['--canvas', '--canvas-dot', '--surface', '--surface-2', '--ink', '--muted', '--faint', '--border', '--accent', '--accent-ink', '--shadow', '--shadow-lg'];
let last = '';
function report() {
  try {
    if (location.protocol === 'file:') return;
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const vars = {};
    VARS.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) vars[k] = v; });
    if (!vars['--surface']) return;
    const attr = root.getAttribute('data-theme');
    const dark = attr ? attr === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const json = JSON.stringify({ dark, vars });
    if (json !== last) { last = json; ipcRenderer.send('notua:theme', { dark, vars }); }
  } catch (e) {}
}
let t = 0;
function soon() { clearTimeout(t); t = setTimeout(report, 400); }
window.addEventListener('DOMContentLoaded', () => {
  soon();
  try {
    new MutationObserver(soon).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', soon);
  } catch (e) {}
});
window.addEventListener('beforeunload', report);
