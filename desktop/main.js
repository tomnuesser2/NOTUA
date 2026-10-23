// NOTUA Desktop – Electron-Hauptprozess (Windows + macOS)
// Lädt die Live-App von notua.site (immer aktuell, offline über den Service Worker der Seite),
// zeigt beim Start ein schwebendes, durchsichtiges Startbild im Affinity-Stil und kümmert sich um
// das, was eine Web-App im Browser nicht kann: Fensterposition merken, nur eine Instanz,
// externe Links im Standardbrowser, Google-Anmeldung im Popup, Menü, Rechtsklick-Menü und
// Hinweis auf neue Versionen der Desktop-App.
'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, nativeTheme, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_URL = process.env.NOTUA_URL || 'https://notua.site/';
const APP_ORIGIN = new URL(APP_URL).origin;
const RELEASES_API = 'https://api.github.com/repos/tomnuesser2/NOTUA/releases/latest';
const RELEASES_PAGE = 'https://github.com/tomnuesser2/NOTUA/releases/latest';
const IS_MAC = process.platform === 'darwin';
const SPLASH_MIN_MS = 1900;   // Startbild mindestens so lange zeigen, damit nichts flackert
const SPLASH_MAX_MS = 12000;  // spätestens dann die App zeigen, egal was passiert
const SPLASH_W = 760, SPLASH_H = 480;

// ---------- Einstellungen (Fenstergröße, letztes Farbschema fürs Startbild) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'notua-desktop.json');
let settings = {};
function loadSettings() { try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch (e) { settings = {}; } }
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) {} }, 300);
}

// ---------- User-Agent: wie normales Chrome + eigener Marker ----------
// Ohne "Electron" im UA lässt Google die Anmeldung im Popup zu; der Marker NOTUADesktopApp lässt
// index.html erkennen, dass es in der App läuft (Download-Knopf ausblenden usw.).
function buildUserAgent() {
  const base = app.userAgentFallback
    .replace(/\sElectron\/\S+/, '')
    .replace(/\snotua-desktop\/\S+/i, '')
    .replace(/\sNOTUA\/\S+/, '');
  return `${base} NOTUADesktopApp/${app.getVersion()}`;
}

// ---------- Nur eine Instanz ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });
}

let mainWin = null, splashWin = null, splashShownAt = 0, revealed = false, loadFailed = false;

// ---------- Startbild ----------
function themeForSplash() {
  const t = settings.theme || {};
  const dark = typeof t.dark === 'boolean' ? t.dark : nativeTheme.shouldUseDarkColors;
  return { dark, vars: t.vars || null };
}
function createSplash() {
  const area = screen.getPrimaryDisplay().workArea;
  splashWin = new BrowserWindow({
    width: SPLASH_W, height: SPLASH_H,
    x: Math.round(area.x + (area.width - SPLASH_W) / 2),
    y: Math.round(area.y + (area.height - SPLASH_H) / 2),
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: false, show: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  splashWin.setIgnoreMouseEvents(true); // Klicks gehen durch die durchsichtigen Bereiche auf den Desktop
  const theme = themeForSplash();
  splashWin.loadFile(path.join(__dirname, 'splash', 'splash.html'), {
    query: { v: app.getVersion(), t: JSON.stringify(theme), os: process.platform }
  });
  splashWin.once('ready-to-show', () => { splashShownAt = Date.now(); splashWin.showInactive(); });
  splashWin.on('closed', () => { splashWin = null; });
}
function splashStatus(text, pct) {
  if (!splashWin || splashWin.isDestroyed()) return;
  splashWin.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)}, ${pct})`).catch(() => {});
}
function reveal() {
  if (revealed || !mainWin) return;
  revealed = true;
  if (settings.maximized) mainWin.maximize();
  mainWin.show();
  mainWin.focus();
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.executeJavaScript('window.fadeOut && window.fadeOut()').catch(() => {});
    setTimeout(() => { if (splashWin && !splashWin.isDestroyed()) splashWin.close(); }, 420);
  }
  setTimeout(checkForUpdate, 8000);
}
function revealWhenReady() {
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - (splashShownAt || Date.now())));
  setTimeout(reveal, wait);
}

// ---------- Hauptfenster ----------
function isAppUrl(u) { try { return new URL(u).origin === APP_ORIGIN; } catch (e) { return false; } }
const AUTH_HOSTS = /(^|\.)(google\.com|googleusercontent\.com|gstatic\.com)$/i;
function isAuthUrl(u) { try { const x = new URL(u); return x.protocol === 'https:' && AUTH_HOSTS.test(x.hostname); } catch (e) { return false; } }
function openExternal(u) { try { const p = new URL(u).protocol; if (['http:', 'https:', 'mailto:', 'tel:'].includes(p)) shell.openExternal(u); } catch (e) {} }

function createMain() {
  const b = settings.bounds || {};
  const theme = themeForSplash();
  const canvas = (theme.vars && theme.vars['--canvas']) || (theme.dark ? '#14171C' : '#E7EAEE');
  mainWin = new BrowserWindow({
    width: b.width || 1360, height: b.height || 860, x: b.x, y: b.y,
    minWidth: 420, minHeight: 480,
    show: false, title: 'NOTUA', backgroundColor: canvas,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true
    }
  });
  if (!IS_MAC) { try { mainWin.webContents.session.setSpellCheckerLanguages(['de-DE', 'en-US']); } catch (e) {} }

  const wc = mainWin.webContents;
  wc.on('did-start-loading', () => { if (!revealed) splashStatus('Verbinde mit notua.site …', 22); });
  wc.on('dom-ready', () => { if (!revealed) splashStatus('Boards werden geladen …', 55); });
  wc.on('did-finish-load', () => {
    if (revealed) return;
    splashStatus(loadFailed ? 'Offline' : 'Bilder und Notizen vorbereiten …', 86);
    setTimeout(() => { splashStatus(loadFailed ? 'Offline-Modus' : 'Fertig', 100); revealWhenReady(); }, 450);
  });
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = abgebrochen (z. B. Weiterleitung)
    loadFailed = true;
    if (!revealed) splashStatus('Keine Verbindung, öffne Offline-Seite …', 70);
    mainWin.loadFile(path.join(__dirname, 'offline.html'));
  });
  wc.on('render-process-gone', () => { setTimeout(() => { if (mainWin) mainWin.loadURL(APP_URL); }, 800); });

  // Neue Fenster: Google-Anmeldung als Popup in der App, alles Fremde im Standardbrowser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAuthUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, parent: mainWin, backgroundColor: '#FFFFFF', title: 'Anmelden' } };
    }
    if (url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:') || isAppUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url) || isAuthUrl(url) || url.startsWith('file:')) return;
    e.preventDefault();
    openExternal(url);
  });

  // Rechtsklick in Textfeldern (Electron hat von sich aus keins). NOTUA-eigene Kontextmenüs
  // auf dem Board rufen preventDefault() auf, dann kommt dieses Ereignis gar nicht erst an.
  wc.on('context-menu', (e, p) => {
    const items = [];
    if (p.misspelledWord && p.dictionarySuggestions && p.dictionarySuggestions.length) {
      p.dictionarySuggestions.slice(0, 5).forEach(s => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
      items.push({ label: 'Zum Wörterbuch hinzufügen', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ label: 'Ausschneiden', role: 'cut', enabled: p.editFlags.canCut },
                 { label: 'Kopieren', role: 'copy', enabled: p.editFlags.canCopy },
                 { label: 'Einfügen', role: 'paste', enabled: p.editFlags.canPaste },
                 { type: 'separator' },
                 { label: 'Alles auswählen', role: 'selectAll' });
    } else if (p.selectionText && p.selectionText.trim()) {
      items.push({ label: 'Kopieren', role: 'copy' });
    } else if (p.linkURL && !isAppUrl(p.linkURL)) {
      items.push({ label: 'Link im Browser öffnen', click: () => openExternal(p.linkURL) },
                 { label: 'Link kopieren', click: () => require('electron').clipboard.writeText(p.linkURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWin });
  });

  // Tasten ohne sichtbares Menü (Windows): F5 neu laden, F11 Vollbild, Strg+Umschalt+I Entwicklertools.
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || IS_MAC) return;
    if (input.key === 'F5') { e.preventDefault(); wc.reload(); }
    else if (input.key === 'F11') { e.preventDefault(); mainWin.setFullScreen(!mainWin.isFullScreen()); }
    else if (input.control && input.shift && input.key.toLowerCase() === 'i') { e.preventDefault(); wc.toggleDevTools(); }
  });

  const remember = () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    settings.maximized = mainWin.isMaximized();
    if (!settings.maximized && !mainWin.isFullScreen()) settings.bounds = mainWin.getNormalBounds();
    saveSettings();
  };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach(ev => mainWin.on(ev, remember));
  mainWin.on('close', remember);
  mainWin.on('closed', () => { mainWin = null; });

  mainWin.loadURL(APP_URL);
  setTimeout(() => { if (!revealed) reveal(); }, SPLASH_MAX_MS);
}

// ---------- Nachrichten aus der Seite (preload.js) ----------
ipcMain.on('notua:theme', (e, theme) => {
  if (!theme || typeof theme !== 'object') return;
  const vars = {};
  for (const [k, v] of Object.entries(theme.vars || {})) {
    if (/^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && v.length < 64) vars[k] = v;
  }
  settings.theme = { dark: !!theme.dark, vars };
  saveSettings();
});
ipcMain.on('notua:retry', () => { if (mainWin) { loadFailed = false; mainWin.loadURL(APP_URL); } });

// ---------- Neue Version der Desktop-App? ----------
function newer(a, b) { // a > b ?
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
async function checkForUpdate(manual) {
  try {
    const res = await net.fetch(RELEASES_API, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^desktop-v|^v/, '');
    if (!latest || !newer(latest, app.getVersion())) {
      if (manual) dialog.showMessageBox(mainWin, { type: 'info', message: 'NOTUA ist aktuell', detail: `Du hast die neueste Version (${app.getVersion()}).` });
      return;
    }
    if (!manual && settings.skipVersion === latest) return;
    const want = IS_MAC ? /\.dmg$/i : /\.exe$/i;
    const asset = (rel.assets || []).find(a => want.test(a.name));
    const r = await dialog.showMessageBox(mainWin, {
      type: 'info', buttons: ['Herunterladen', 'Später', 'Diese Version überspringen'], defaultId: 0, cancelId: 1,
      message: `Neue Version der NOTUA-App: ${latest}`,
      detail: `Installiert ist ${app.getVersion()}. Deine Boards bleiben erhalten, sie liegen in deinem Konto.`
    });
    if (r.response === 0) openExternal(asset ? asset.browser_download_url : RELEASES_PAGE);
    if (r.response === 2) { settings.skipVersion = latest; saveSettings(); }
  } catch (e) {
    if (manual) dialog.showMessageBox(mainWin, { type: 'warning', message: 'Prüfen nicht möglich', detail: 'Es konnte gerade nicht nach Updates gesucht werden. Bitte später nochmal versuchen.' });
  }
}

// ---------- Menü ----------
function buildMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; }
  const tpl = [
    { label: 'NOTUA', submenu: [
      { label: 'Über NOTUA', role: 'about' },
      { label: 'Nach Updates suchen …', click: () => checkForUpdate(true) },
      { type: 'separator' },
      { label: 'Dienste', role: 'services' },
      { type: 'separator' },
      { label: 'NOTUA ausblenden', role: 'hide' },
      { label: 'Andere ausblenden', role: 'hideOthers' },
      { label: 'Alle einblenden', role: 'unhide' },
      { type: 'separator' },
      { label: 'NOTUA beenden', role: 'quit' }
    ] },
    { label: 'Bearbeiten', submenu: [
      { label: 'Widerrufen', role: 'undo' }, { label: 'Wiederholen', role: 'redo' }, { type: 'separator' },
      { label: 'Ausschneiden', role: 'cut' }, { label: 'Kopieren', role: 'copy' }, { label: 'Einfügen', role: 'paste' },
      { label: 'Einfügen und Stil anpassen', role: 'pasteAndMatchStyle' }, { label: 'Alles auswählen', role: 'selectAll' }
    ] },
    { label: 'Ansicht', submenu: [
      { label: 'Neu laden', accelerator: 'Cmd+R', click: () => mainWin && mainWin.webContents.reload() },
      { label: 'Vollbild', role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Entwicklertools', accelerator: 'Alt+Cmd+I', click: () => mainWin && mainWin.webContents.toggleDevTools() }
    ] },
    { label: 'Fenster', role: 'windowMenu' },
    { label: 'Hilfe', role: 'help', submenu: [
      { label: 'notua.site im Browser öffnen', click: () => openExternal(APP_URL) },
      { label: 'Alle Versionen der App', click: () => openExternal(RELEASES_PAGE) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------- Start ----------
app.userAgentFallback = buildUserAgent();
app.setAboutPanelOptions({ applicationName: 'NOTUA', applicationVersion: app.getVersion(), copyright: '© 2026 Tom Nüßer', website: 'https://notua.site' });
if (process.platform === 'win32') app.setAppUserModelId('site.notua.desktop');

app.whenReady().then(() => {
  loadSettings();
  buildMenu();
  createSplash();
  createMain();
  app.on('activate', () => { // macOS: Klick aufs Dock-Icon ohne offenes Fenster
    if (!mainWin) { revealed = false; createMain(); setTimeout(reveal, 300); }
    else mainWin.show();
  });
});
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
