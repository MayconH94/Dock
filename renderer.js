const { shell, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

const dock = document.getElementById('dock');
const startBtn = document.getElementById('start');
const secPinned = document.getElementById('sec-pinned');
const secRunning = document.getElementById('sec-running');
const secWidgets = document.getElementById('sec-widgets');
const sepA = document.getElementById('sep-a');
const sepB = document.getElementById('sep-b');
const sepW = document.getElementById('sep-w');
const tip = document.getElementById('tip');
const configPath = path.join(ipcRenderer.sendSync('user-data-path'), 'shortcuts.json');

let shortcuts = [];
let windows = [];            // janelas abertas (vindas do processo principal)
let settings = {};
let currentEffect = '';
let enabledWidgets = [];
let widgetCleanups = [];
let runOrder = [];           // ordem estável dos grupos abertos que não estão fixados
const targets = new Map();   // caminho do atalho -> programa de destino (minúsculo)
const exeIcons = new Map();  // exe -> ícone
const send = (...a) => ipcRenderer.send(...a);

// ---------- Atalhos fixados ----------
function loadShortcuts() {
    try {
        if (fs.existsSync(configPath)) {
            shortcuts = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (!Array.isArray(shortcuts)) shortcuts = [];
        }
    } catch (e) {
        shortcuts = [];
    }
    render();
    resolveTargets();
    refreshIcons();
}

// Atualiza os ícones salvos (corrige ícones genéricos de .lnk gravados antes)
async function refreshIcons() {
    let changed = false;
    for (const item of shortcuts) {
        if (!item.path) continue;
        try {
            const icon = await ipcRenderer.invoke('get-icon', item.path, item.name);
            if (icon && icon !== item.iconData) { item.iconData = icon; changed = true; }
        } catch (e) {}
    }
    if (changed) { saveShortcuts(); render(); }
}

// Descobre o programa real de cada atalho, para saber se já está aberto
async function resolveTargets() {
    let added = false;
    for (const item of shortcuts) {
        if (!item.path || targets.has(item.path)) continue;
        try {
            targets.set(item.path, String(await ipcRenderer.invoke('resolve-target', item.path) || '').toLowerCase());
            added = true;
        } catch (e) { targets.set(item.path, ''); }
    }
    if (added) render();
}

function saveShortcuts() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(shortcuts, null, 2));
    } catch (e) {
        console.error("Erro ao salvar:", e);
    }
}

// ---------- Ligação atalho <-> janela ----------
const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const exeBase = (exe) => compact(path.basename(exe || '', path.extname(exe || '')));

function matches(item, w) {
    const exe = w.exe.toLowerCase();
    const target = targets.get(item.path);
    if (target && target === exe && !w.key.startsWith('uwp:')) return true;
    // Apps da Store, pastas e atalhos sem destino claro: compara pelo nome
    const name = compact(item.name);
    if (name.length < 3) return false;
    return exeBase(w.exe) === name || compact(w.title).includes(name);
}

// Divide as janelas entre os atalhos fixados e os grupos "soltos"
function buildModel() {
    const used = new Set();
    const pinned = shortcuts.map((item) => {
        const wins = windows.filter((w) => !used.has(w.hwnd) && matches(item, w));
        wins.forEach((w) => used.add(w.hwnd));
        return { item, wins };
    });

    const groups = new Map();
    for (const w of windows) {
        if (used.has(w.hwnd)) continue;
        if (!groups.has(w.key)) groups.set(w.key, []);
        groups.get(w.key).push(w);
    }
    runOrder = runOrder.filter((k) => groups.has(k));
    for (const k of groups.keys()) if (!runOrder.includes(k)) runOrder.push(k);
    return { pinned, running: runOrder.map((key) => ({ key, wins: groups.get(key) })) };
}

// ---------- Ações de janela ----------
// Clique em um app aberto: traz para frente; se já está na frente, minimiza (ou passa para a próxima janela)
function toggleGroup(wins) {
    const active = wins.find((w) => w.active);
    if (!active) { send('window-action', 'activate', wins[0].hwnd); return; }
    if (wins.length === 1) { send('window-action', 'minimize', active.hwnd); return; }
    const ordered = [...wins].sort((a, b) => a.hwnd - b.hwnd);
    const next = ordered[(ordered.findIndex((w) => w.hwnd === active.hwnd) + 1) % ordered.length];
    send('window-action', 'activate', next.hwnd);
}

async function menu(items) {
    tip.classList.remove('show');
    return ipcRenderer.invoke('context-menu', items);
}

async function pinnedMenu(ctx) {
    const items = [{ id: 'open', label: ctx.wins.length ? 'Abrir nova janela' : 'Abrir' }];
    if (ctx.wins.length) items.push({ id: 'close', label: ctx.wins.length > 1 ? 'Fechar todas as janelas' : 'Fechar janela' });
    items.push({ separator: true }, { id: 'unpin', label: 'Desafixar do dock' });
    const choice = await menu(items);
    if (choice === 'open') shell.openPath(ctx.item.path);
    else if (choice === 'close') ctx.wins.forEach((w) => send('window-action', 'close', w.hwnd));
    else if (choice === 'unpin') {
        shortcuts.splice(shortcuts.indexOf(ctx.item), 1);
        saveShortcuts();
        render();
    }
}

async function runningMenu(ctx) {
    const choice = await menu([
        { id: 'pin', label: 'Fixar no dock' },
        { id: 'close', label: ctx.wins.length > 1 ? 'Fechar todas as janelas' : 'Fechar janela' }
    ]);
    if (choice === 'close') ctx.wins.forEach((w) => send('window-action', 'close', w.hwnd));
    else if (choice === 'pin') pinWindow(ctx.wins[0]);
}

async function pinWindow(w) {
    if (!w.exe || shortcuts.some((s) => s.path === w.exe)) return;
    const name = path.basename(w.exe, path.extname(w.exe));
    const iconData = exeIcons.get(w.key) || await ipcRenderer.invoke('get-icon', w.exe, name)
        || await ipcRenderer.invoke('get-window-icon', w.hwnd);
    shortcuts.push({ name, path: w.exe, iconData });
    targets.set(w.exe, w.exe.toLowerCase());
    saveShortcuts();
    render();
}

// ---------- Renderização por chaves ----------
// Em vez de recriar tudo, reaproveita os elementos (animações e hover continuam) e anima entradas/saídas.
function reconcile(container, entries) {
    const existing = new Map();
    for (const el of container.children) {
        if (el.dataset.key !== undefined && !el.classList.contains('leaving')) existing.set(el.dataset.key, el);
    }
    const wanted = new Set(entries.map((e) => e.key));
    for (const [key, el] of existing) {
        if (wanted.has(key)) continue;
        el.classList.remove('entering');
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 260);
    }
    let prev = null;
    for (const e of entries) {
        let el = existing.get(e.key);
        if (!el) {
            el = createItem();
            el.dataset.key = e.key;
            el.classList.add('entering');
            el.addEventListener('animationend', () => el.classList.remove('entering'), { once: true });
        }
        el._ctx = e.ctx;
        paintItem(el, e);
        const ref = prev ? prev.nextSibling : container.firstChild;
        if (el !== ref) container.insertBefore(el, ref);
        prev = el;
    }
}

function createItem() {
    const el = document.createElement('div');
    el.className = 'dock-item';
    const dots = document.createElement('div');
    dots.className = 'dots';
    el.appendChild(dots);

    el.addEventListener('click', () => {
        const c = el._ctx;
        if (c.wins.length) toggleGroup(c.wins);
        else if (c.item && c.item.path) shell.openPath(c.item.path);
    });
    el.addEventListener('auxclick', (e) => {      // botão do meio abre outra janela
        if (e.button === 1 && el._ctx.item) shell.openPath(el._ctx.item.path);
    });
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (el._ctx.item) pinnedMenu(el._ctx); else runningMenu(el._ctx);
    });
    el.addEventListener('mouseenter', () => showTip(el));
    el.addEventListener('mouseleave', () => tip.classList.remove('show'));
    return el;
}

function paintItem(el, e) {
    const { wins } = e.ctx;
    setIcon(el, e.icon, e.label);
    el.classList.toggle('active', wins.some((w) => w.active));
    el.classList.toggle('minimized', wins.length > 0 && wins.every((w) => w.minimized));
    el._tip = e.tip;

    const dots = el.querySelector('.dots');
    const n = Math.min(wins.length, 3);
    while (dots.children.length < n) dots.appendChild(document.createElement('i'));
    while (dots.children.length > n) dots.lastChild.remove();
    const activeIndex = wins.findIndex((w) => w.active);
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === Math.max(activeIndex, 0)));
}

function setIcon(el, src, label) {
    let img = el.querySelector('img');
    let initial = el.querySelector('.initial');
    if (src) {
        if (initial) initial.remove();
        if (!img) { img = document.createElement('img'); el.prepend(img); }
        if (el._src !== src) { img.src = src; el._src = src; }
    } else {
        if (img) { img.remove(); el._src = null; }
        if (!initial) { initial = document.createElement('span'); initial.className = 'initial'; el.prepend(initial); }
        initial.textContent = label ? label.charAt(0).toUpperCase() : '📁';
    }
}

function render() {
    const { pinned, running } = buildModel();
    const showRunning = settings.taskbar !== false;

    reconcile(secPinned, pinned.map(({ item, wins }) => ({
        key: 'p:' + item.path,
        ctx: { item, wins },
        icon: item.iconData,
        label: item.name,
        tip: wins.length === 1 ? item.name + ' — ' + wins[0].title : item.name
    })));

    reconcile(secRunning, showRunning ? running.map(({ key, wins }) => {
        ensureExeIcon(wins[0]);
        const name = path.basename(wins[0].exe, path.extname(wins[0].exe));
        return {
            key: 'r:' + key,
            ctx: { wins },
            icon: exeIcons.get(key),
            label: name,
            tip: wins.length === 1 ? wins[0].title : name + ' (' + wins.length + ' janelas)'
        };
    }) : []);

    const hasPinned = shortcuts.length > 0;
    const hasRunning = showRunning && running.length > 0;
    const hasWidgets = enabledWidgets.length > 0;
    sepA.style.display = hasPinned || hasRunning || hasWidgets ? '' : 'none';
    sepB.style.display = hasPinned && hasRunning ? '' : 'none';
    sepW.style.display = hasWidgets && (hasPinned || hasRunning) ? '' : 'none';
    measure();
}

// Ícone do programa; se o .exe não puder ser lido (apps da Store), usa o ícone da própria janela
function ensureExeIcon(w) {
    const id = w.key;
    if (!w.exe || exeIcons.has(id)) return;
    exeIcons.set(id, null);
    const name = path.basename(w.exe, path.extname(w.exe));
    ipcRenderer.invoke('get-icon', w.exe, name)
        .then((icon) => icon || ipcRenderer.invoke('get-window-icon', w.hwnd))
        .then((icon) => {
            if (icon) { exeIcons.set(id, icon); render(); } else exeIcons.delete(id);
        })
        .catch(() => exeIcons.delete(id));
}

ipcRenderer.on('windows-changed', (e, list) => { windows = list; render(); });
ipcRenderer.invoke('get-windows').then((list) => { windows = list; render(); });

// ---------- Botão Iniciar ----------
startBtn.title = '';
startBtn.addEventListener('click', () => send('start-menu'));
startBtn.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const choice = await menu([
        { id: 'settings', label: 'Personalizar dock…' },
        { separator: true },
        { id: 'quit', label: 'Sair do dock' }
    ]);
    if (choice === 'settings') send('open-settings');
    else if (choice === 'quit') send('quit-app');
});
startBtn.addEventListener('mouseenter', () => { startBtn._tip = 'Iniciar'; showTip(startBtn); });
startBtn.addEventListener('mouseleave', () => tip.classList.remove('show'));

// ---------- Dica flutuante ----------
function showTip(el) {
    if (!el._tip) return;
    tip.textContent = el._tip;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const x = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2));
    const above = document.body.dataset.pos !== 'top';
    // usa a posição da barra (sem a ampliação) para a dica não pular durante o zoom
    const bar = dock.getBoundingClientRect();
    tip.style.transform = '';
    tip.style.left = x + 'px';
    tip.style.top = (above ? Math.max(2, bar.top - tip.offsetHeight - 22) : bar.bottom + 22) + 'px';
    tip.classList.add('show');
}

// ---------- Ampliação suave dos ícones sob o mouse ----------
let magFrame = 0;
let mouseX = null;
function applyMagnify() {
    magFrame = 0;
    const items = dock.querySelectorAll('.dock-item:not(.leaving)');
    const size = parseFloat(getComputedStyle(items[0] || dock).getPropertyValue('--size')) || 44;
    const reach = size * 2.4;
    for (const el of items) {
        let mag = 0;
        if (mouseX !== null) {
            const r = el.getBoundingClientRect();
            const d = Math.abs(mouseX - (r.left + r.width / 2));
            if (d < reach) mag = Math.pow(Math.cos((d / reach) * Math.PI / 2), 2);
        }
        el.style.setProperty('--mag', mag.toFixed(3));
    }
}
dock.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    if (!magFrame) magFrame = requestAnimationFrame(applyMagnify);
});
dock.addEventListener('mouseleave', () => {
    mouseX = null;
    tip.classList.remove('show');
    if (!magFrame) magFrame = requestAnimationFrame(applyMagnify);
});

// ---------- Arrastar e soltar para fixar ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dock.classList.add('dropping'); });
window.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dock.classList.remove('dropping'); } });
window.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    dock.classList.remove('dropping');

    if (e.dataTransfer && e.dataTransfer.files) {
        for (const file of e.dataTransfer.files) {
            const filePath = webUtils.getPathForFile(file);
            const fileName = path.basename(filePath, path.extname(filePath));

            if (filePath && !shortcuts.some(s => s.path === filePath)) {
                let iconData = null;
                try {
                    iconData = await ipcRenderer.invoke('get-icon', filePath, fileName);
                } catch (err) {
                    console.log("Erro ao extrair ícone, usando texto padrão.");
                }

                shortcuts.push({ name: fileName, path: filePath, iconData });
            }
        }
        saveShortcuts();
        render();
        resolveTargets();
    }
});

// ---------- Aparência (settings.json) como variáveis CSS ----------
function applySettings(s) {
    settings = s;
    const hex = (s.color || '#f5f3ee').replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
    const root = document.documentElement.style;
    root.setProperty('--dock-rgb', rgb);
    root.setProperty('--dock-opacity', s.opacity);
    root.setProperty('--dock-radius', s.radius + 'px');
    root.setProperty('--dock-blur', s.blur + 'px');
    root.setProperty('--item-size', s.iconSize + 'px');
    root.setProperty('--item-bg', s.itemColor || 'rgba(255, 255, 255, 0.25)');
    root.setProperty('--accent', s.accent || '#0066ff');
    root.setProperty('--decor', JSON.stringify(s.decor || ''));
    root.setProperty('--decor-display', s.decor ? 'block' : 'none');
    document.body.dataset.pos = s.position || 'bottom';
    document.body.dataset.style = s.style || 'vidro';
    currentEffect = s.effect || '';
    const wanted = s.widgets || [];
    if (JSON.stringify(wanted) !== JSON.stringify(enabledWidgets)) {
        enabledWidgets = wanted;
        mountWidgets();
    }
    render();
}
ipcRenderer.invoke('get-settings').then(applySettings);
ipcRenderer.on('settings-changed', (e, s) => applySettings(s));

// ---------- Efeitos (neve, morcegos...) ----------
let fxKey = null;
const FX_TALL = ['snow', 'santa', 'bats'];

function buildFx(list) {
    const key = list.filter((e) => FX_TALL.includes(e)).join(',');
    if (key === fxKey) return;
    fxKey = key;
    const old = document.getElementById('fx');
    if (old) old.remove();
    if (!key) return;

    const fx = document.createElement('div');
    fx.id = 'fx';
    const rnd = (a, b) => a + Math.random() * (b - a);

    if (list.includes('bats')) {
        for (let i = 0; i < 7; i++) {
            const bat = document.createElement('div');
            bat.className = 'bat';
            bat.style.top = rnd(2, 75) + '%';
            bat.style.fontSize = rnd(14, 26) + 'px';
            bat.style.setProperty('--fly', rnd(7, 14) + 's');
            bat.style.setProperty('--bob', rnd(1.2, 2.2) + 's');
            bat.style.setProperty('--delay', -rnd(0, 14) + 's');
            bat.innerHTML = '<span>🦇</span>';
            fx.appendChild(bat);
        }
    }
    if (list.includes('snow')) {
        for (let i = 0; i < 40; i++) {
            const flake = document.createElement('div');
            flake.className = 'flake';
            flake.style.left = rnd(0, 100) + '%';
            flake.style.fontSize = rnd(8, 16) + 'px';
            flake.style.opacity = rnd(0.6, 1);
            flake.style.setProperty('--fall', rnd(5, 10) + 's');
            flake.style.setProperty('--sway', rnd(1.5, 3) + 's');
            flake.style.setProperty('--delay', -rnd(0, 10) + 's');
            flake.textContent = '❄';
            fx.appendChild(flake);
        }
    }
    if (list.includes('santa')) {
        const santa = document.createElement('div');
        santa.className = 'santa';
        santa.textContent = '🦌🛷🎅';
        fx.appendChild(santa);
    }
    document.body.appendChild(fx);
}

// ---------- Medidas: encaixe na tela, tamanho da janela e luzes ----------
let measureQueued = false;
let lightsKey = '';
let lastLayout = '';

function measure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => {
        measureQueued = false;
        const list = currentEffect.split(',').map((e) => e.trim()).filter(Boolean);
        const root = document.documentElement.style;

        // Muitos itens: encolhe os ícones em vez de passar da tela
        const count = dock.querySelectorAll('.dock-item:not(.leaving)').length;
        const size = parseFloat(settings.iconSize) || 44;
        const fit = parseFloat(root.getPropertyValue('--fit')) || 1;
        const fixed = dock.offsetWidth - count * size * fit;
        const avail = window.innerWidth - 24;
        const wantFit = Math.max(0.45, Math.min(1, (avail - fixed) / (count * size || 1)));
        if (Math.abs(wantFit - fit) > 0.005) root.setProperty('--fit', wantFit.toFixed(3));

        const rect = dock.getBoundingClientRect();
        const tall = list.some((e) => FX_TALL.includes(e));
        // altura: barra + margem + ampliação dos ícones + dica
        const need = Math.ceil(rect.height + 15 + size * 0.45 + 8 + 40);
        const height = tall ? Math.max(need, 170) : need;
        const bar = {
            x: Math.round(rect.left), w: Math.round(rect.width),
            h: Math.round(rect.height)
        };
        // y da barra dentro da janela (a janela é redimensionada pelo processo principal; calculamos pela posição)
        bar.y = document.body.dataset.pos === 'top' ? 15 : height - 15 - bar.h;
        const key = JSON.stringify([bar, height]);
        if (key !== lastLayout) {
            lastLayout = key;
            send('bar-layout', { bar, height });
        }

        root.setProperty('--fx-left', Math.round(rect.left - 10) + 'px');
        root.setProperty('--fx-width', Math.round(rect.width + 20) + 'px');
        buildFx(list);
        buildLights(list, Math.round(rect.width - 28));
    });
}

function buildLights(list, width) {
    const key = list.includes('lights') ? String(width) : '';
    if (key === lightsKey) return;
    lightsKey = key;
    const old = dock.querySelector('.dock-lights');
    if (old) old.remove();
    if (!key) return;
    const colors = ['#ff3b3b', '#35d46a', '#ffd43b', '#4dabff'];
    const count = Math.max(4, Math.floor(width / 22));
    const lights = document.createElement('div');
    lights.className = 'dock-lights';
    lights.style.width = width + 'px';
    for (let i = 0; i < count; i++) {
        const bulb = document.createElement('span');
        bulb.style.color = colors[i % colors.length];
        bulb.style.animationDelay = ((i % 4) * 0.4) + 's';
        lights.appendChild(bulb);
    }
    dock.appendChild(lights);
}

// A barra cresce e encolhe com animação: acompanha cada quadro
new ResizeObserver(measure).observe(dock);
window.addEventListener('resize', measure);

// ---------- Widgets: arquivos .js nas pastas "widgets" (do app e do usuário) ----------
const widgetApi = {
    openUrl: (url) => shell.openExternal(url),
    openPath: (p) => shell.openPath(p),
    dataDir: path.dirname(configPath),
    refreshLayout: () => measure()
};

function findWidgetFile(id) {
    const dirs = [path.join(widgetApi.dataDir, 'widgets'), path.join(__dirname, 'widgets')];
    for (const dir of dirs) {
        const file = path.join(dir, id + '.js');
        if (fs.existsSync(file)) return file;
    }
    return null;
}

function mountWidgets() {
    widgetCleanups.forEach((fn) => { try { fn(); } catch (e) {} });
    widgetCleanups = [];
    document.querySelectorAll('style[data-widget]').forEach((s) => s.remove());
    secWidgets.innerHTML = '';

    for (const id of enabledWidgets) {
        const file = findWidgetFile(id);
        if (!file) continue;

        const box = document.createElement('div');
        box.className = 'dock-widget';
        box.dataset.widget = id;
        secWidgets.appendChild(box);

        try {
            delete require.cache[require.resolve(file)];
            const mod = require(file);
            if (mod.css) {
                const style = document.createElement('style');
                style.dataset.widget = id;
                style.textContent = mod.css;
                document.head.appendChild(style);
            }
            const cleanup = mod.setup && mod.setup(box, widgetApi);
            if (typeof cleanup === 'function') widgetCleanups.push(cleanup);
        } catch (e) {
            box.textContent = '⚠ ' + id;
            box.title = String(e);
            console.error('Erro no widget ' + id, e);
        }
    }
}

loadShortcuts();
