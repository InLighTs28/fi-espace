// FI espace — application de bureau (Windows, macOS, Linux).
// Ouvre le site en ligne dans sa propre fenêtre : les mises à jour du site arrivent sans réinstaller.
// Sécurité : aucune API Node.js dans la page, navigation limitée au site, liens externes ouverts dans le navigateur.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Adresse du site. Si elle change (nouveau domaine…), mettre à jour ici et publier une nouvelle version.
const SITE_URL = 'https://inlights28.github.io/fi-espace/';
const SITE = new URL(SITE_URL);
const isOwnPage = url => { try { const u = new URL(url); return u.origin === SITE.origin && u.pathname.startsWith(SITE.pathname); } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    title: 'FI espace',
    backgroundColor: '#f4efe2',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPage(url)) { event.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { site: SITE_URL } });
  });
  // Page d'erreur du serveur (ex. 404 si l'adresse du site a changé) : afficher l'écran d'aide plutôt qu'une page vide.
  win.webContents.on('did-navigate', (_e, url, httpResponseCode) => {
    if (isOwnPage(url) && httpResponseCode >= 400) win.loadFile(path.join(__dirname, 'offline.html'), { query: { site: SITE_URL, code: String(httpResponseCode) } });
  });

  win.loadURL(SITE_URL);
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Fichier', submenu: [{ role: 'reload', label: 'Actualiser' }, { type: 'separator' }, { role: 'quit', label: 'Quitter' }] },
    { label: 'Édition', submenu: [{ role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' }, { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
    { label: 'Affichage', submenu: [{ role: 'zoomIn', label: 'Zoom avant' }, { role: 'zoomOut', label: 'Zoom arrière' }, { role: 'resetZoom', label: 'Taille réelle' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Plein écran' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
