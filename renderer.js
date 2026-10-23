const { shell, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

const dock = document.getElementById('dock');
const configPath = path.join(ipcRenderer.sendSync('user-data-path'), 'shortcuts.json');

let shortcuts = [];
let currentEffect = '';
let enabledWidgets = [];
let widgetCleanups = [];

function loadShortcuts() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            shortcuts = JSON.parse(data);
            if (!Array.isArray(shortcuts)) shortcuts = [];
        }
    } catch (e) {
        shortcuts = [];
    }
    renderDock();
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
    if (changed) { saveShortcuts(); renderDock(); }
}

function saveShortcuts() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(shortcuts, null, 2));
    } catch (e) {
        console.error("Erro ao salvar:", e);
    }
}

function renderDock() {
    // Mantém o botão Iniciar e os separadores fixos, limpando apenas os atalhos dinâmicos anteriores
    // Para simplificar, vamos redesenhar a barra mantendo a estrutura:
    dock.innerHTML = '';

    // 1. Botão Iniciar Fixo
    const startBtn = document.createElement('div');
    startBtn.className = 'dock-item';
    startBtn.style.background = 'var(--accent, #0066ff)';
    startBtn.innerHTML = `<span style="color: white; font-weight: bold; font-size: 16px; pointer-events: none;">❖</span>`;
    startBtn.title = 'Clique direito para personalizar';
    startBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        ipcRenderer.send('open-settings');
    });
    dock.appendChild(startBtn);

    dock.appendChild(createSeparator());

    // 2. Atalhos do Utilizador
    if (shortcuts.length > 0) {
        shortcuts.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'dock-item';
            div.title = `${item.name} (Clique direito para remover)`;

            if (item.iconData) {
                div.innerHTML = `<img src="${item.iconData}" style="pointer-events: none;" />`;
            } else {
                const initial = item.name ? item.name.charAt(0).toUpperCase() : '📁';
                div.innerHTML = `<span style="color: #333; font-size: 14px; font-family: sans-serif; font-weight: bold; pointer-events: none;">${initial}</span>`;
            }

            // Abrir aplicação
            div.addEventListener('click', () => {
                if (item.path) shell.openPath(item.path);
            });

            // Remover com o Botão Direito (Garantido em qualquer parte do ícone)
            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                shortcuts.splice(index, 1);
                saveShortcuts();
                renderDock();
            });

            dock.appendChild(div);
        });
        dock.appendChild(createSeparator());
    }

    mountWidgets();
    fitWindow();
}

function createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'dock-separator';
    return sep;
}

// Drag and Drop com extração de ícone segura
window.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
window.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();

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
        renderDock();
    }
});

loadShortcuts();

// Aplica as configurações de aparência (settings.json) como variáveis CSS
function applySettings(s) {
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
    currentEffect = s.effect || '';
    const wanted = s.widgets || [];
    if (JSON.stringify(wanted) !== JSON.stringify(enabledWidgets)) {
        enabledWidgets = wanted;
        renderDock();
    } else {
        fitWindow();
    }
}
ipcRenderer.invoke('get-settings').then(applySettings);
ipcRenderer.on('settings-changed', (e, s) => applySettings(s));

// Ajusta o tamanho da janela ao conteúdo e desenha os efeitos
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

function fitWindow() {
    requestAnimationFrame(() => {
        const list = currentEffect.split(',').map((e) => e.trim()).filter(Boolean);
        const old = dock.querySelector('.dock-lights');
        if (old) old.remove();

        const contentWidth = Math.ceil(dock.scrollWidth);
        const tall = list.some((e) => FX_TALL.includes(e));
        ipcRenderer.send('resize-dock', {
            width: contentWidth + 20,
            height: tall ? 150 : 90,
            barW: contentWidth,
            barH: dock.offsetHeight
        });
        buildFx(list);

        if (list.includes('lights')) {
            const colors = ['#ff3b3b', '#35d46a', '#ffd43b', '#4dabff'];
            const count = Math.max(4, Math.floor(contentWidth / 22));
            const lights = document.createElement('div');
            lights.className = 'dock-lights';
            lights.style.width = contentWidth + 'px';
            for (let i = 0; i < count; i++) {
                const bulb = document.createElement('span');
                bulb.style.color = colors[i % colors.length];
                bulb.style.animationDelay = ((i % 4) * 0.4) + 's';
                lights.appendChild(bulb);
            }
            dock.appendChild(lights);
        }
    });
}

// Rolagem horizontal com a roda do mouse quando passar do limite da tela
dock.addEventListener('wheel', (e) => { dock.scrollLeft += e.deltaY; });

// ---- Widgets: arquivos .js nas pastas "widgets" (do app e do usuário) ----
const widgetApi = {
    openUrl: (url) => shell.openExternal(url),
    openPath: (p) => shell.openPath(p),
    dataDir: path.dirname(configPath),
    refreshLayout: () => fitWindow()
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

    for (const id of enabledWidgets) {
        const file = findWidgetFile(id);
        if (!file) continue;

        const box = document.createElement('div');
        box.className = 'dock-widget';
        box.dataset.widget = id;
        dock.appendChild(box);

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
