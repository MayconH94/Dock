const { app, BrowserWindow, screen, ipcMain, shell, nativeImage, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

// API do Windows (lista de janelas, reserva de espaço). Se falhar, o dock funciona só como lançador.
let winapi = null;
try { winapi = require('./winapi'); } catch (e) { console.error('winapi indisponível:', e.message); }

// Só uma cópia do dock por vez
if (!app.requestSingleInstanceLock()) app.quit();

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
  itemColor: 'rgba(255, 255, 255, 0.25)', accent: '#0066ff', decor: '', effect: '', widgets: [],
  taskbar: true,     // mostra as janelas abertas (como a barra de tarefas)
  reserve: true,     // reserva espaço na tela: janelas maximizadas não ficam atrás do dock
  autostart: false,  // abre junto com o Windows
  allWindows: true,  // mostra também janelas de ferramenta e diálogos (não só as da barra do Windows)
  style: 'vidro'     // vidro | solido | minimalista | ilhas
};
const themesDir = path.join(__dirname, 'themes');          // temas que vêm com o app
const userThemesDir = path.join(dataDir, 'themes');        // temas criados por você

function readSettings() {
  try { return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) }; }
  catch (e) { return { ...defaultSettings }; }
}
let settings = readSettings();

// Grava, avisa o dock e aplica o que depende do sistema
function commitSettings(next) {
  settings = next;
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); } catch (e) {}
  if (dockWin) dockWin.webContents.send('settings-changed', settings);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.autostart });
  placeDock();
  scheduleReservation();
  pollWindows();
}

// ---- Posição da janela ----
// A janela ocupa a largura toda da área útil e é transparente: a barra cresce/encolhe só por CSS
// (animações fluidas) e o mouse atravessa tudo que não for a barra.
const MARGIN = 15;                 // distância da barra até a borda da tela
let layout = { bar: { x: 0, y: 0, w: 0, h: 60 }, height: 130 };
let reservedDip = 0;               // espessura que reservamos na tela
let reservedTop = false;

function placeDock() {
  if (!dockWin) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const top = settings.position === 'top';
  const h = layout.height;
  // workArea já descontou a nossa própria reserva: somamos de volta para achar a borda real
  const bounds = {
    x: wa.x,
    y: top ? wa.y - (reservedTop ? reservedDip : 0) : wa.y + wa.height + (reservedTop ? 0 : reservedDip) - h,
    width: wa.width,
    height: h
  };
  const cur = dockWin.getBounds();
  if (cur.x !== bounds.x || cur.y !== bounds.y || cur.width !== bounds.width || cur.height !== bounds.height) {
    dockWin.setBounds(bounds);
  }
}

// ---- Reserva de espaço (AppBar do Windows) ----
let reserveTimer = null;
function scheduleReservation(force) {
  clearTimeout(reserveTimer);
  reserveTimer = setTimeout(() => updateReservation(force), 150);
}

const handleOf = () => Number(dockWin.getNativeWindowHandle().readBigUInt64LE(0));

function updateReservation(force) {
  if (!dockWin || !winapi) return;
  const top = settings.position === 'top';
  const thickness = Math.round(layout.bar.h + MARGIN + 6);

  if (!settings.reserve || layout.bar.w <= 0) { releaseReservation(); return; }
  if (reservedDip === thickness && reservedTop === top && !force) return;
  if (reservedDip && (reservedTop !== top || force)) {
    releaseReservation();
    setTimeout(() => updateReservation(), 150);   // espera o Windows atualizar a área útil
    return;
  }

  // Área útil livre = workArea atual + o que já reservamos
  const wa = { ...screen.getPrimaryDisplay().workArea };
  if (reservedDip) { if (reservedTop) wa.y -= reservedDip; wa.height += reservedDip; }
  const rect = screen.dipToScreenRect(dockWin, {
    x: wa.x, width: wa.width, height: thickness,
    y: top ? wa.y : wa.y + wa.height - thickness
  });
  try {
    winapi.appBarReserve(handleOf(), top, {
      left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height
    });
    reservedDip = thickness;
    reservedTop = top;
    placeDock();
  } catch (e) { console.error('Falha ao reservar espaço:', e.message); }
}

function releaseReservation() {
  if (!reservedDip) return;
  try { if (dockWin && winapi) winapi.appBarRelease(handleOf()); } catch (e) {}
  reservedDip = 0;
  placeDock();
}

// ---- Mouse atravessa a janela, exceto sobre a barra ----
let ignoring = false;
function pollCursor() {
  if (!dockWin || !dockWin.isVisible()) return;
  const b = dockWin.getBounds();
  const p = screen.getCursorScreenPoint();
  const r = layout.bar;
  const inside = p.x >= b.x + r.x - 4 && p.x <= b.x + r.x + r.w + 4
    && p.y >= b.y + r.y - 4 && p.y <= b.y + r.y + r.h + 4;
  if (!inside !== ignoring) {
    dockWin.setIgnoreMouseEvents(!inside, { forward: true });
    ignoring = !inside;
  }
}

// O renderer informa onde está a barra e quanta altura a janela precisa (efeitos, dicas)
ipcMain.on('bar-layout', (event, d) => {
  const hChanged = d.bar.h !== layout.bar.h || (d.bar.w > 0) !== (layout.bar.w > 0);
  layout = { bar: d.bar, height: Math.max(90, Math.ceil(d.height)) };
  placeDock();
  // a reserva só depende da altura da barra: ignorar mudanças de largura evita refazê-la o tempo todo
  if (hChanged) scheduleReservation();
});

// ---- Janelas abertas (barra de tarefas) ----
const ownPids = new Set([process.pid]);
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);
let lastList = [];
let lastJson = '[]';
let hiddenForFullscreen = false;

// Esconde o dock quando um app ocupa a tela inteira (vídeo, jogo), como a barra do Windows
function updateFullscreen() {
  const fg = winapi.foregroundInfo();
  let full = false;
  if (fg && !fg.hasCaption && !ownPids.has(fg.pid) && !DESKTOP_CLASSES.has(fg.cls)) {
    const r = screen.dipToScreenRect(null, screen.getPrimaryDisplay().bounds);
    full = fg.rect.left <= r.x && fg.rect.top <= r.y
      && fg.rect.right >= r.x + r.width && fg.rect.bottom >= r.y + r.height;
  }
  if (full === hiddenForFullscreen) return;
  hiddenForFullscreen = full;
  if (full) dockWin.hide(); else dockWin.showInactive();
}

function pollWindows() {
  if (!dockWin || !winapi) return;
  try {
    updateFullscreen();
    const list = settings.taskbar ? winapi.listWindows(ownPids, settings.allWindows).map((w) => ({
      hwnd: w.hwnd, title: w.title, exe: w.exe, active: w.active, minimized: w.minimized,
      // apps da Store compartilham o ApplicationFrameHost: cada janela vira seu próprio grupo
      key: /applicationframehost\.exe$/i.test(w.exe) ? 'uwp:' + w.title : w.exe.toLowerCase()
    })) : [];
    const json = JSON.stringify(list);
    if (json === lastJson) return;
    lastJson = json;
    lastList = list;
    dockWin.webContents.send('windows-changed', list);
  } catch (e) { console.error('Erro ao listar janelas:', e.message); }
}

ipcMain.handle('get-windows', () => lastList);

ipcMain.on('window-action', (event, action, hwnd) => {
  if (!winapi) return;
  try {
    if (action === 'activate') winapi.activate(hwnd);
    else if (action === 'minimize') winapi.minimize(hwnd);
    else if (action === 'close') winapi.close(hwnd);
  } catch (e) { console.error(e.message); }
  setTimeout(pollWindows, 120);
});

ipcMain.on('start-menu', () => { if (winapi) winapi.pressWinKey(); });
ipcMain.on('quit-app', () => app.quit());

// Menu nativo de clique direito: recebe [{id, label}] (ou {separator:true}) e devolve o id escolhido
ipcMain.handle('context-menu', (event, items) => new Promise((resolve) => {
  const template = items.map((i) => i.separator ? { type: 'separator' } : { label: i.label, click: () => resolve(i.id) });
  Menu.buildFromTemplate(template).popup({ window: dockWin, callback: () => resolve(null) });
}));

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    x: wa.x, y: wa.y + wa.height - layout.height, width: wa.width, height: layout.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,      // clicar no dock não rouba o foco do programa que você está usando
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  dockWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoring = true;
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

// Ícone tirado da própria janela (apps da Store). Devolve data URL ou null
ipcMain.handle('get-window-icon', (event, hwnd) => {
  try {
    const ico = winapi && winapi.windowIcon(hwnd);
    if (!ico) return null;
    return nativeImage.createFromBitmap(ico.bgra, { width: ico.width, height: ico.height }).toDataURL();
  } catch (e) { return null; }
});

// Alvo real de um atalho .lnk (para saber se o programa já está aberto)
ipcMain.handle('resolve-target', (event, filePath) => {
  try {
    if (path.extname(filePath).toLowerCase() === '.lnk') return expandEnv(shell.readShortcutLink(filePath).target) || '';
  } catch (e) {}
  return filePath;
});


// ---- Configurações personalizáveis (sem mexer no código) ----
ipcMain.handle('get-settings', () => settings);

ipcMain.on('save-settings', (event, incoming) => commitSettings({ ...settings, ...incoming }));

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
  if (!theme) return settings;
  const { id: _id, name: _name, ...values } = theme;
  commitSettings({ ...settings, ...values, theme: id });
  return settings;
});

ipcMain.handle('reset-settings', () => {
  commitSettings({ ...defaultSettings });
  return settings;
});

ipcMain.on('open-settings', () => {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 340, height: 720, title: 'Configurações do dock',
    autoHideMenuBar: true, resizable: false, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  settingsWin.setAlwaysOnTop(true, 'floating');
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
});

app.whenReady().then(() => {
  createWindow();
  setInterval(pollWindows, 500);
  setInterval(pollCursor, 50);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.autostart });

  // Mudou a resolução / monitor: reposiciona e refaz a reserva só se os limites da tela mudaram
  // (a reserva em si altera a workArea, então ignoramos esse tipo de evento para não entrar em loop)
  screen.on('display-metrics-changed', (e, display, changed) => {
    placeDock();
    if (changed.includes('bounds')) scheduleReservation(true);
  });
});

app.on('before-quit', releaseReservation);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
