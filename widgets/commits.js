// Widget: último commit de um repositório git, atualizado em tempo real.
//
// Configure UM dos dois (ou os dois):
//   REPO_LOCAL   pasta do repositório no seu computador (precisa ter o git instalado)
//   REPO_GITHUB  "usuario/repositorio" para consultar o GitHub (atualiza a cada 2 min)
const REPO_LOCAL = 'C:\\Users\\mayco\\OneDrive\\Desktop\\win-dock';
const REPO_GITHUB = '';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function haQuanto(segundos) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - segundos));
  if (s < 60) return 'agora';
  if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
  if (s < 86400) return 'há ' + Math.floor(s / 3600) + ' h';
  return 'há ' + Math.floor(s / 86400) + ' d';
}

function git(args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', REPO_LOCAL, ...args], { windowsHide: true }, (err, out) => {
      if (err) reject(err); else resolve(out.trim());
    });
  });
}

async function lerLocal() {
  const [info, hoje] = await Promise.all([
    git(['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%ct']),
    git(['rev-list', '--count', '--since=midnight', 'HEAD'])
  ]);
  const [hash, msg, autor, ts] = info.split('\x1f');
  return { hash, msg, autor, ts: Number(ts), hoje: Number(hoje) };
}

async function lerGithub() {
  const resp = await fetch('https://api.github.com/repos/' + REPO_GITHUB + '/commits?per_page=1');
  const [c] = await resp.json();
  return {
    hash: c.sha.slice(0, 7),
    msg: c.commit.message.split('\n')[0],
    autor: c.commit.author.name,
    ts: new Date(c.commit.author.date).getTime() / 1000,
    hoje: null
  };
}

module.exports = {
  name: 'Último commit',

  css: `
    .w-commit { display: flex; flex-direction: column; line-height: 1.2; max-width: 230px; cursor: pointer; }
    .w-commit b { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .w-commit small { font-size: 10px; opacity: 0.8; white-space: nowrap; }
  `,

  setup(el, api) {
    el.innerHTML = '<div class="w-commit"><b>Carregando commit...</b><small></small></div>';
    const titulo = el.querySelector('b');
    const detalhe = el.querySelector('small');
    const caixa = el.querySelector('.w-commit');
    let ultimo = null;

    function desenhar() {
      if (!ultimo) return;
      titulo.textContent = '● ' + ultimo.msg;
      detalhe.textContent = ultimo.hash + ' · ' + haQuanto(ultimo.ts) +
        (ultimo.hoje != null ? ' · ' + ultimo.hoje + ' hoje' : '');
      caixa.title = ultimo.msg + '\n' + ultimo.autor;
      api.refreshLayout();
    }

    async function carregar() {
      try {
        ultimo = REPO_LOCAL ? await lerLocal() : await lerGithub();
        desenhar();
      } catch (e) {
        titulo.textContent = 'Sem commits';
        detalhe.textContent = String(e.message || e).split('\n')[0].slice(0, 40);
      }
    }

    caixa.addEventListener('click', () => {
      if (REPO_LOCAL) api.openPath(REPO_LOCAL);
      else api.openUrl('https://github.com/' + REPO_GITHUB);
    });

    carregar();

    // Tempo real: o git escreve em .git/logs/HEAD a cada commit, checkout, merge ou pull
    let watcher = null;
    let debounce = null;
    if (REPO_LOCAL) {
      try {
        watcher = fs.watch(path.join(REPO_LOCAL, '.git', 'logs'), { recursive: true }, () => {
          clearTimeout(debounce);
          debounce = setTimeout(carregar, 500);
        });
      } catch (e) { /* sem watch: o intervalo abaixo cobre */ }
    }

    // Reserva: recarrega periodicamente e mantém o "há X min" atualizado
    const timer = setInterval(() => (REPO_LOCAL ? desenhar() : carregar()), REPO_LOCAL ? 30000 : 120000);
    const timerGit = REPO_LOCAL ? setInterval(carregar, 5 * 60 * 1000) : null;

    return () => {
      clearInterval(timer);
      if (timerGit) clearInterval(timerGit);
      clearTimeout(debounce);
      if (watcher) watcher.close();
    };
  }
};
