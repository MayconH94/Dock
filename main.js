const { app, BrowserWindow, screen, ipcMain, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// Dados do usuário (atalhos, configurações, ícones, temas próprios) ficam fora da pasta do programa,
// senão não dá para gravar quando o app está instalado como .exe.
// Mesma pasta no modo de desenvolvimento e no app instalado: %APPDATA%\win-dock
app.setPath('userData', path.join(app.getPath('appData'), 'win-dock'));
const dataDir = app.getPath('userData');
fs.mkdirSync(dataDir, { recursive: true });
for (const name of ['shortcuts.json', 'settings.json', 'icons', 'themes']) {
  const from = path.join(__dirname, name);
  const to = path.join(dataDir, name);
  try {
    if (name === 'themes') { fs.mkdirSync(to, { recursive: true }); continue; }
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
  } catch (e) {}
}
fs.mkdirSync(path.join(dataDir, 'icons'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'widgets'), { recursive: true });
ipcMain.on('user-data-path', (event) => { event.returnValue = dataDir; });

let dockWin = null;
let settingsWin = null;

const settingsPath = path.join(dataDir, 'settings.json');
const defaultSettings = {
  theme: 'padrao', opacity: 0.35, color: '#000000', radius: 20, iconSize: 44, blur: 20, position: 'bottom',
  itemColor: 'rgba(255, 255, 255, 0.25)', accent: '#0066ff', decor: '', effect: '', widgets: []
};
const themesDir = path.join(__dirname, 'themes');          // temas que vêm com o app
const userThemesDir = path.join(dataDir, 'themes');        // temas criados por você

function loadSettings() {
  try { return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) }; }
  catch (e) { return { ...defaultSettings }; }
}

let dockWidth = 950;
let dockHeight = 90;
let barW = 0;
let barH = 60;
let dockAtTop = false;

function placeDock() {
  if (!dockWin) return;
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  dockAtTop = loadSettings().position === 'top';
  const w = Math.min(dockWidth, width);
  dockWin.setBounds({
    x: x + Math.floor((width - w) / 2),
    y: dockAtTop ? y + 15 : y + height - dockHeight - 15,
    width: w,
    height: dockHeight
  });
}

// Com efeitos a janela fica mais alta: o clique atravessa as áreas vazias e só a barra recebe o mouse
let mouseTimer = null;
let ignoring = false;
function updateMouseThrough() {
  if (!dockWin) return;
  if (dockHeight <= 90) {
    if (mouseTimer) { clearInterval(mouseTimer); mouseTimer = null; }
    if (ignoring) { dockWin.setIgnoreMouseEvents(false); ignoring = false; }
    return;
  }
  if (mouseTimer) return;
  mouseTimer = setInterval(() => {
    if (!dockWin) { clearInterval(mouseTimer); mouseTimer = null; return; }
    const b = dockWin.getBounds();
    const p = screen.getCursorScreenPoint();
    const rw = Math.min(barW, b.width - 20);
    const rx = b.x + (b.width - rw) / 2;
    const ry = dockAtTop ? b.y + 15 : b.y + b.height - 15 - barH;
    const inside = p.x >= rx - 6 && p.x <= rx + rw + 6 && p.y >= ry - 6 && p.y <= ry + barH + 6;
    if (!inside !== ignoring) {
      dockWin.setIgnoreMouseEvents(!inside, { forward: true });
      ignoring = !inside;
    }
  }, 80);
}

// A janela cresce/encolhe conforme os atalhos e os efeitos
ipcMain.on('resize-dock', (event, d) => {
  dockWidth = Math.max(160, Math.ceil(d.width));
  dockHeight = d.height || 90;
  barW = d.barW || 0;
  barH = d.barH || 60;
  placeDock();
  updateMouseThrough();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 950,
    height: 90,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  dockWin = win;
  win.on('closed', () => { dockWin = null; });
  win.loadFile('index.html');
  placeDock();
}

// Extração de ícones no processo principal.
// Para atalhos .lnk, tenta (1) o ícone definido no atalho, (2) o programa de destino,
// (3) a miniatura do shell do Windows (funciona para apps da Store/MSIX).
const expandEnv = (p) => p && p.replace(/%([^%]+)%/g, (m, v) => process.env[v] || m);

async function iconFrom(p) {
  const img = await app.getFileIcon(p, { size: 'large' });
  return img.isEmpty() ? null : img;
}

// Ícones personalizados: coloque icons/<nome do atalho>.png (ou .ico, .svg, .jpg, .webp)
const iconsDir = path.join(dataDir, 'icons');
function customIcon(name) {
  if (!name) return null;
  try {
    const files = fs.readdirSync(iconsDir);
    const wanted = name.trim().toLowerCase();
    const file = files.find((f) => path.parse(f).name.trim().toLowerCase() === wanted
      && /\.(png|ico|svg|jpe?g|webp)$/i.test(f));
    if (!file) return null;
    const full = path.join(iconsDir, file);
    const ext = path.extname(file).toLowerCase();
    const mime = { '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
    return 'data:' + mime + ';base64,' + fs.readFileSync(full).toString('base64');
  } catch (e) { return null; }
}

ipcMain.handle('get-icon', async (event, filePath, name) => {
  try {
    const custom = customIcon(name);
    if (custom) return custom;
    if (path.extname(filePath).toLowerCase() === '.lnk') {
      let link = {};
      try { link = shell.readShortcutLink(filePath); } catch (e) { /* usa o próprio .lnk */ }

      const iconFile = expandEnv(link.icon);
      for (const candidate of [iconFile, expandEnv(link.target)]) {
        if (candidate && fs.existsSync(candidate)) {
          const img = await iconFrom(candidate);
          if (img) return img.toDataURL();
        }
      }
      try {
        const thumb = await nativeImage.createThumbnailFromPath(filePath, { width: 64, height: 64 });
        if (!thumb.isEmpty()) return thumb.toDataURL();
      } catch (e) { /* sem miniatura */ }
    }
    const img = await iconFrom(filePath);
    return img ? img.toDataURL() : null;
  } catch (err) {
    return null;
  }
});


// ---- Configurações personalizáveis (sem mexer no código) ----
ipcMain.handle('get-settings', () => loadSettings());

ipcMain.on('save-settings', (event, settings) => {
  const merged = { ...loadSettings(), ...settings };
  try { fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2)); } catch (e) {}
  if (dockWin) dockWin.webContents.send('settings-changed', merged);
  placeDock();
});

function readThemes(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      return { id: path.parse(f).name, ...data };
    });
  } catch (e) { return []; }
}

ipcMain.handle('get-themes', () => {
  const all = new Map();
  [...readThemes(themesDir), ...readThemes(userThemesDir)].forEach((t) => all.set(t.id, t));
  return [...all.values()];
});

ipcMain.handle('apply-theme', (event, id) => {
  const theme = readThemes(userThemesDir).concat(readThemes(themesDir)).find((t) => t.id === id);
  if (!theme) return loadSettings();
  const { id: _id, name: _name, ...values } = theme;
  const merged = { ...loadSettings(), ...values, theme: id };
  try { fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2)); } catch (e) {}
  if (dockWin) dockWin.webContents.send('settings-changed', merged);
  placeDock();
  return merged;
});

ipcMain.handle('reset-settings', () => {
  try { fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2)); } catch (e) {}
  if (dockWin) dockWin.webContents.send('settings-changed', defaultSettings);
  placeDock();
  return { ...defaultSettings };
});

ipcMain.on('open-settings', () => {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 340, height: 620, title: 'Configurações do dock',
    autoHideMenuBar: true, resizable: false, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  settingsWin.setAlwaysOnTop(true, 'floating');
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
