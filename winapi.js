// Ponte com a API do Windows (user32/dwm/shell32) via koffi.
// Usada pelo processo principal para listar janelas abertas, ativá-las e reservar espaço na tela.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const shell32 = koffi.load('shell32.dll');

const RECT = koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });

// HANDLEs são tratados como intptr_t (número) para servirem de id simples
const EnumProc = koffi.proto('bool __stdcall EnumProc(intptr_t hwnd, intptr_t lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumProc *cb, intptr_t lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hwnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hwnd)');
const GetWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)');
const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const GetAncestor = user32.func('intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32_t flags)');
const GetWindowLongW = user32.func('int32_t __stdcall GetWindowLongW(intptr_t hwnd, int index)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(intptr_t hwnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ void *buf, int max)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ void *buf, int max)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(intptr_t hwnd)');
const PostMessageW = user32.func('bool __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32_t from, uint32_t to, bool attach)');
const SendMessageTimeoutW = user32.func(
  'intptr_t __stdcall SendMessageTimeoutW(intptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)');
const GetClassLongPtrW = user32.func('uintptr_t __stdcall GetClassLongPtrW(intptr_t hwnd, int index)');
const GetDC = user32.func('intptr_t __stdcall GetDC(intptr_t hwnd)');
const ReleaseDC = user32.func('int __stdcall ReleaseDC(intptr_t hwnd, intptr_t hdc)');
const gdi32 = koffi.load('gdi32.dll');
const ICONINFO = koffi.struct('ICONINFO', { fIcon: 'int32_t', xHotspot: 'uint32_t', yHotspot: 'uint32_t', hbmMask: 'intptr_t', hbmColor: 'intptr_t' });
const BITMAP = koffi.struct('BITMAP', {
  bmType: 'int32_t', bmWidth: 'int32_t', bmHeight: 'int32_t', bmWidthBytes: 'int32_t',
  bmPlanes: 'uint16_t', bmBitsPixel: 'uint16_t', bmBits: 'intptr_t'
});
const BITMAPINFOHEADER = koffi.struct('BITMAPINFOHEADER', {
  biSize: 'uint32_t', biWidth: 'int32_t', biHeight: 'int32_t', biPlanes: 'uint16_t', biBitCount: 'uint16_t',
  biCompression: 'uint32_t', biSizeImage: 'uint32_t', biXPelsPerMeter: 'int32_t', biYPelsPerMeter: 'int32_t',
  biClrUsed: 'uint32_t', biClrImportant: 'uint32_t'
});
const GetIconInfo = user32.func('bool __stdcall GetIconInfo(intptr_t hicon, _Out_ ICONINFO *info)');
const GetObjectW = gdi32.func('int __stdcall GetObjectW(intptr_t h, int cb, _Out_ BITMAP *bm)');
const GetDIBits = gdi32.func('int __stdcall GetDIBits(intptr_t hdc, intptr_t hbm, uint32_t start, uint32_t lines, _Out_ void *bits, _Inout_ BITMAPINFOHEADER *bmi, uint32_t usage)');
const DeleteObject = gdi32.func('bool __stdcall DeleteObject(intptr_t h)');
const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()');

const OpenProcess = kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr_t h)');
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, _Out_ void *buf, _Inout_ uint32_t *size)');

const DwmGetWindowAttribute = dwmapi.func(
  'int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ uint32_t *value, uint32_t size)');

const APPBARDATA = koffi.struct('APPBARDATA', {
  cbSize: 'uint32_t', hWnd: 'intptr_t', uCallbackMessage: 'uint32_t', uEdge: 'uint32_t',
  rc: RECT, lParam: 'intptr_t'
});
const SHAppBarMessage = shell32.func('uintptr_t __stdcall SHAppBarMessage(uint32_t msg, _Inout_ APPBARDATA *data)');

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CAPTION = 0xC00000;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const GW_OWNER = 4;
const GA_ROOTOWNER = 3;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const WM_CLOSE = 0x10;
const DWMWA_CLOAKED = 14;
const ABM = { NEW: 0, REMOVE: 1, QUERYPOS: 2, SETPOS: 3 };
const ABE = { TOP: 1, BOTTOM: 3 };
const WM_USER_APPBAR = 0x0400 + 0x2A;

const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);

const textBuf = Buffer.alloc(1024);
function readText(fn, hwnd) {
  const n = fn(hwnd, textBuf, 512);
  return n > 0 ? textBuf.toString('utf16le', 0, n * 2) : '';
}

// Cache pid -> caminho do .exe (processos não mudam de caminho)
const exeCache = new Map();
function exeOf(pid) {
  if (exeCache.has(pid)) return exeCache.get(pid);
  let exe = '';
  const h = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
  if (h) {
    const size = [512];
    if (QueryFullProcessImageNameW(h, 0, textBuf, size)) exe = textBuf.toString('utf16le', 0, size[0] * 2);
    CloseHandle(h);
  }
  exeCache.set(pid, exe);
  return exe;
}

function isCloaked(hwnd) {
  const out = [0];
  return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out, 4) === 0 && out[0] !== 0;
}

// Janelas que o Windows mostraria na barra de tarefas
function isTaskbarWindow(hwnd, all) {
  if (!IsWindowVisible(hwnd)) return false;
  if (isCloaked(hwnd)) return false;
  if (all) return true;   // modo "todos os tipos": inclui janelas de ferramenta e diálogos
  const ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
  if (ex & WS_EX_TOOLWINDOW) return false;
  if (GetWindow(hwnd, GW_OWNER) && !(ex & WS_EX_APPWINDOW)) return false;
  if (isCloaked(hwnd)) return false;
  return true;
}

function listWindows(ownPids, all) {
  const found = [];
  const cb = koffi.register((hwnd) => {
    try {
      if (!isTaskbarWindow(hwnd, all)) return true;
      const title = readText(GetWindowTextW, hwnd);
      if (!title) return true;
      const cls = readText(GetClassNameW, hwnd);
      if (IGNORED_CLASSES.has(cls)) return true;
      const pidOut = [0];
      GetWindowThreadProcessId(hwnd, pidOut);
      const pid = pidOut[0];
      if (ownPids.has(pid)) return true;
      found.push({ hwnd, title, cls, pid, exe: exeOf(pid), minimized: IsIconic(hwnd) });
    } catch (e) { /* ignora janela problemática */ }
    return true;
  }, koffi.pointer(EnumProc));
  try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }

  const fg = GetAncestor(GetForegroundWindow(), GA_ROOTOWNER);
  for (const w of found) w.active = w.hwnd === fg;
  return found;
}

// Janela em primeiro plano (para detectar apps em tela cheia)
function foregroundInfo() {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;
  const rect = {};
  if (!GetWindowRect(hwnd, rect)) return null;
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return { hwnd, pid: pid[0], cls: readText(GetClassNameW, hwnd), rect, hasCaption: !!(GetWindowLongW(hwnd, GWL_STYLE) & WS_CAPTION) };
}

function activate(hwnd) {
  if (!IsWindow(hwnd)) return;
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  // O Windows só deixa trazer para frente quem já está em primeiro plano; o "alt" fantasma libera isso
  keybd_event(0x12, 0, 0, 0);
  keybd_event(0x12, 0, 2, 0);
  const fgThread = GetWindowThreadProcessId(GetForegroundWindow(), [0]);
  const me = GetCurrentThreadId();
  if (fgThread && fgThread !== me) AttachThreadInput(me, fgThread, true);
  BringWindowToTop(hwnd);
  SetForegroundWindow(hwnd);
  if (fgThread && fgThread !== me) AttachThreadInput(me, fgThread, false);
}

// Ícone da janela (funciona para apps da Store, cujo .exe não dá para ler). Retorna { width, height, bgra }
function windowIcon(hwnd) {
  let hicon = 0;
  for (const kind of [2 /* SMALL2 */, 1 /* BIG */, 0 /* SMALL */]) {
    const out = [0];
    SendMessageTimeoutW(hwnd, 0x7F /* WM_GETICON */, kind, 0, 2 /* SMTO_ABORTIFHUNG */, 150, out);
    if (out[0]) { hicon = Number(out[0]); break; }
  }
  if (!hicon) hicon = Number(GetClassLongPtrW(hwnd, -14)) || Number(GetClassLongPtrW(hwnd, -34));
  if (!hicon) return null;

  const info = {};
  if (!GetIconInfo(hicon, info) || !info.hbmColor) return null;
  try {
    const bm = {};
    GetObjectW(info.hbmColor, koffi.sizeof(BITMAP), bm);
    const { bmWidth: width, bmHeight: height } = bm;
    if (!width || !height) return null;
    const bgra = Buffer.alloc(width * height * 4);
    const bmi = {
      biSize: koffi.sizeof(BITMAPINFOHEADER), biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32,
      biCompression: 0, biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0, biClrUsed: 0, biClrImportant: 0
    };
    const dc = GetDC(0);
    const lines = GetDIBits(dc, info.hbmColor, 0, height, bgra, bmi, 0);
    ReleaseDC(0, dc);
    if (!lines) return null;
    // Ícones antigos não têm canal alfa: deixa opaco
    let hasAlpha = false;
    for (let i = 3; i < bgra.length; i += 4) if (bgra[i]) { hasAlpha = true; break; }
    if (!hasAlpha) for (let i = 3; i < bgra.length; i += 4) bgra[i] = 255;
    return { width, height, bgra };
  } finally {
    DeleteObject(info.hbmColor);
    if (info.hbmMask) DeleteObject(info.hbmMask);
  }
}

function minimize(hwnd) { if (IsWindow(hwnd)) ShowWindow(hwnd, SW_MINIMIZE); }
function close(hwnd) { if (IsWindow(hwnd)) PostMessageW(hwnd, WM_CLOSE, 0, 0); }

// Abre o menu Iniciar do Windows (tecla Windows)
function pressWinKey() {
  keybd_event(0x5B, 0, 0, 0);
  keybd_event(0x5B, 0, 2, 0);
}

// ---- AppBar: reserva faixa da tela para as janelas maximizarem sem ficar atrás do dock ----
function appBarData(hwnd, edge, rect) {
  return {
    cbSize: koffi.sizeof(APPBARDATA), hWnd: hwnd, uCallbackMessage: WM_USER_APPBAR,
    uEdge: edge, rc: rect || { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0
  };
}

// Retorna o retângulo realmente reservado (em pixels físicos), ou null
function appBarReserve(hwnd, top, rect) {
  const edge = top ? ABE.TOP : ABE.BOTTOM;
  SHAppBarMessage(ABM.NEW, appBarData(hwnd, edge, rect));
  const data = appBarData(hwnd, edge, { ...rect });
  SHAppBarMessage(ABM.QUERYPOS, data);
  // Mantém a espessura pedida a partir da borda que o sistema devolveu
  const thick = rect.bottom - rect.top;
  if (top) data.rc.bottom = data.rc.top + thick; else data.rc.top = data.rc.bottom - thick;
  SHAppBarMessage(ABM.SETPOS, data);
  return data.rc;
}

function appBarRelease(hwnd) {
  SHAppBarMessage(ABM.REMOVE, appBarData(hwnd, ABE.BOTTOM));
}

module.exports = { listWindows, windowIcon, foregroundInfo, activate, minimize, close, pressWinKey, appBarReserve, appBarRelease, isWindow: IsWindow };
