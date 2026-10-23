// Widget: barra de contribuições (estilo GitHub) com os commits das últimas semanas.
// Cada quadradinho é um dia; quanto mais verde, mais commits. Atualiza em tempo real.
//
// REPOS   pastas dos repositórios (os commits de todos são somados)
// SEMANAS quantas semanas mostrar
const REPOS = ['C:\\Users\\mayco\\OneDrive\\Desktop\\win-dock'];
const SEMANAS = 20;

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const pad = (n) => String(n).padStart(2, '0');
const chave = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function commitsPorDia(repo, desde) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repo, 'log', '--all', '--since=' + desde,
      '--date=format-local:%Y-%m-%d', '--format=%ad'], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, out) => resolve(err ? [] : out.split('\n').filter(Boolean)));
  });
}

function nivel(n) {
  if (n === 0) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}
// Cores dos quadradinhos: do dia sem commit (0) ao dia com muitos commits (4).
// Para escurecer mais, diminua os números; para clarear, aumente.
const CORES = ['rgba(255, 255, 255, 0.03)', '#0a3320', '#0d5a2b', '#17803a', '#22a049'];

module.exports = {
  name: 'Barra de contribuições',

  css: `
    .w-contrib { display: flex; align-items: center; gap: 8px; }
    .w-contrib .grade { display: grid; grid-template-rows: repeat(7, 5px); grid-auto-flow: column; grid-auto-columns: 5px; gap: 1px; }
    .w-contrib .grade i { width: 5px; height: 5px; border-radius: 1px; }
    .w-contrib .total { display: flex; flex-direction: column; line-height: 1.1; text-align: center; }
    .w-contrib .total b { font-size: 14px; font-weight: 600; }
    .w-contrib .total small { font-size: 9px; opacity: 0.8; }
  `,

  setup(el, api) {
    el.innerHTML = '<div class="w-contrib"><div class="grade"></div><div class="total"><b>-</b><small>commits</small></div></div>';
    const grade = el.querySelector('.grade');
    const total = el.querySelector('.total b');

    async function carregar() {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      // a primeira coluna começa no domingo, (SEMANAS - 1) semanas atrás
      const inicio = new Date(hoje);
      inicio.setDate(hoje.getDate() - hoje.getDay() - (SEMANAS - 1) * 7);

      const listas = await Promise.all(REPOS.map((r) => commitsPorDia(r, chave(inicio))));
      const contagem = {};
      listas.flat().forEach((dia) => { contagem[dia] = (contagem[dia] || 0) + 1; });

      grade.innerHTML = '';
      let soma = 0;
      for (let i = 0; i < SEMANAS * 7; i++) {
        const dia = new Date(inicio);
        dia.setDate(inicio.getDate() + i);
        const cel = document.createElement('i');
        if (dia > hoje) {
          cel.style.visibility = 'hidden';
        } else {
          const n = contagem[chave(dia)] || 0;
          soma += n;
          cel.style.background = CORES[nivel(n)];
          cel.title = n + (n === 1 ? ' commit' : ' commits') + ' em ' +
            pad(dia.getDate()) + '/' + pad(dia.getMonth() + 1);
        }
        grade.appendChild(cel);
      }
      total.textContent = soma;
      el.title = soma + ' commits nas últimas ' + SEMANAS + ' semanas';
      api.refreshLayout();
    }

    carregar();

    // Tempo real: o git escreve em .git/logs a cada commit
    const watchers = [];
    let debounce = null;
    REPOS.forEach((repo) => {
      try {
        watchers.push(fs.watch(path.join(repo, '.git', 'logs'), { recursive: true }, () => {
          clearTimeout(debounce);
          debounce = setTimeout(carregar, 500);
        }));
      } catch (e) { /* o intervalo abaixo cobre */ }
    });
    const timer = setInterval(carregar, 10 * 60 * 1000);

    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      watchers.forEach((w) => w.close());
    };
  }
};
