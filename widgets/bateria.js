// Widget: bateria do celular e do relógio Android.
//
// O dock abre um mini servidor HTTP na rede local. O celular (MacroDroid/Tasker/app)
// envia o nível da bateria para ele, e o widget desenha as barras em tempo real.
//
// Configuração (criada sozinha na 1ª vez em %APPDATA%\win-dock\bateria.json):
//   { "porta": 8787, "token": "<gerado automaticamente>" }
//
// Envio (qualquer um dos dois funciona):
//   POST http://IP_DO_PC:8787/bateria   header X-Token: <token>
//        corpo JSON: {"device":"celular","level":82,"charging":false}
//   GET  http://IP_DO_PC:8787/bateria?token=<token>&device=relogio&level=55&charging=1
//
// "device" pode ser "celular" ou "relogio" (outros nomes também aparecem).

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ICONES = { celular: '📱', relogio: '⌚' };
const ORDEM = ['celular', 'relogio'];
const VELHO_MS = 30 * 60 * 1000; // sem atualização há 30 min = esmaecido

function lerConfig(dataDir) {
  const arq = path.join(dataDir, 'bateria.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(arq, 'utf-8')); } catch (e) { /* primeira vez */ }
  let mudou = false;
  if (!cfg.token) { cfg.token = crypto.randomBytes(12).toString('hex'); mudou = true; }
  if (!cfg.porta) { cfg.porta = 8787; mudou = true; }
  if (mudou) { try { fs.writeFileSync(arq, JSON.stringify(cfg, null, 2)); } catch (e) {} }
  return cfg;
}

function ipLocal() {
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

module.exports = {
  name: 'Bateria (celular e relógio)',

  css: `
    .w-bat { display: flex; gap: 12px; align-items: center; cursor: default; }
    .w-bat .d { display: flex; flex-direction: column; gap: 3px; min-width: 52px; line-height: 1.1; transition: opacity .3s; }
    .w-bat .d.velho { opacity: 0.45; }
    .w-bat .topo { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 12px; }
    .w-bat .pct { font-weight: 600; font-variant-numeric: tabular-nums; }
    .w-bat .barra { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.22); overflow: hidden; }
    .w-bat .barra i { display: block; height: 100%; width: 0; border-radius: 3px; background: #4ade80; transition: width .4s, background .3s; }
    .w-bat .d.media .barra i { background: #facc15; }
    .w-bat .d.baixa .barra i { background: #f87171; }
    .w-bat .vazio { font-size: 10px; opacity: 0.7; max-width: 150px; }
  `,

  setup(el, api) {
    const dataDir = api.dataDir;
    const cfg = lerConfig(dataDir);
    const arqEstado = path.join(dataDir, 'bateria-estado.json');

    let estado = {};
    try { estado = JSON.parse(fs.readFileSync(arqEstado, 'utf-8')); } catch (e) { estado = {}; }

    el.innerHTML = '<div class="w-bat"></div>';
    const caixa = el.querySelector('.w-bat');
    const dica = 'Envie para: http://' + ipLocal() + ':' + cfg.porta + '/bateria\nToken: ' + cfg.token;
    caixa.title = dica;

    function desenhar() {
      const nomes = [...ORDEM.filter((n) => estado[n]), ...Object.keys(estado).filter((n) => !ORDEM.includes(n))];
      if (!nomes.length) {
        caixa.innerHTML = '<span class="vazio">🔋 Aguardando dados do celular…</span>';
      } else {
        caixa.innerHTML = nomes.map((n) => {
          const d = estado[n];
          const nivel = Math.max(0, Math.min(100, Math.round(d.level)));
          const cls = (nivel <= 20 ? 'baixa' : nivel <= 50 ? 'media' : '') +
            (Date.now() - d.ts > VELHO_MS ? ' velho' : '');
          const quando = new Date(d.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          return '<div class="d ' + cls + '" title="' + n + ' · atualizado às ' + quando + '">' +
            '<div class="topo"><span>' + (ICONES[n] || '🔋') + '</span>' +
            '<span class="pct">' + nivel + '%' + (d.charging ? ' ⚡' : '') + '</span></div>' +
            '<div class="barra"><i style="width:' + nivel + '%"></i></div></div>';
        }).join('');
      }
      api.refreshLayout();
    }

    function salvar() {
      try { fs.writeFileSync(arqEstado, JSON.stringify(estado)); } catch (e) {}
    }

    function receber(device, level, charging) {
      const nome = String(device || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
      const nivel = Number(level);
      if (!nome || !Number.isFinite(nivel) || nivel < 0 || nivel > 100) return false;
      estado[nome] = { level: nivel, charging: charging === true || charging === 'true' || charging === '1' || charging === 1, ts: Date.now() };
      salvar();
      desenhar();
      return true;
    }

    const servidor = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const fim = (codigo, msg) => { res.writeHead(codigo, { 'Content-Type': 'text/plain' }); res.end(msg || ''); };

      if (url.pathname !== '/bateria') return fim(404);

      const token = req.headers['x-token'] || url.searchParams.get('token');
      if (token !== cfg.token) return fim(401, 'token invalido');

      if (req.method === 'GET') {
        const ok = receber(url.searchParams.get('device'), url.searchParams.get('level'), url.searchParams.get('charging'));
        return ok ? fim(200, 'ok') : fim(400, 'parametros invalidos');
      }

      if (req.method === 'POST') {
        let corpo = '';
        req.on('data', (c) => { corpo += c; if (corpo.length > 1024) req.destroy(); });
        req.on('end', () => {
          try {
            const j = JSON.parse(corpo);
            return receber(j.device, j.level, j.charging) ? fim(200, 'ok') : fim(400, 'parametros invalidos');
          } catch (e) { return fim(400, 'json invalido'); }
        });
        return;
      }
      fim(405);
    });

    servidor.on('error', (e) => {
      caixa.innerHTML = '<span class="vazio">🔋 Porta ' + cfg.porta + ' em uso (' + (e.code || 'erro') + ')</span>';
      api.refreshLayout();
    });
    servidor.listen(cfg.porta, '0.0.0.0');

    desenhar();
    // Reavalia o "esmaecido" de dados antigos
    const timer = setInterval(desenhar, 60 * 1000);

    return () => {
      clearInterval(timer);
      try { servidor.close(); } catch (e) {}
    };
  }
};
