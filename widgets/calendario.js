// Widget: calendário da semana com feriados nacionais do Brasil.
//
//   - mostra a semana atual (domingo a sábado); o dia de hoje fica destacado
//   - feriado: número em âmbar; ponto facultativo (Carnaval, Corpus Christi): âmbar mais claro
//   - role o mouse sobre o widget para ir às semanas anteriores / seguintes
//   - clique no mês/ano para voltar para a semana de hoje
//   - clique em um dia para abrir esse dia no Google Agenda (troque URL_DIA para usar outro)
const URL_DIA = (a, m, d) => 'https://calendar.google.com/calendar/r/day/' + a + '/' + m + '/' + d;

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Domingo de Páscoa (algoritmo gregoriano)
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

const chave = (d) => (d.getMonth() + 1) + '-' + d.getDate();
const somarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const cacheFeriados = {};
function feriados(ano) {
  if (cacheFeriados[ano]) return cacheFeriados[ano];
  const m = {};
  const fixo = (mes, dia, nome) => { m[mes + '-' + dia] = { nome, facultativo: false }; };
  fixo(1, 1, 'Confraternização Universal');
  fixo(4, 21, 'Tiradentes');
  fixo(5, 1, 'Dia do Trabalho');
  fixo(9, 7, 'Independência do Brasil');
  fixo(10, 12, 'Nossa Senhora Aparecida');
  fixo(11, 2, 'Finados');
  fixo(11, 15, 'Proclamação da República');
  if (ano >= 2024) fixo(11, 20, 'Dia da Consciência Negra');
  fixo(12, 25, 'Natal');
  const p = pascoa(ano);
  m[chave(somarDias(p, -48))] = { nome: 'Carnaval (ponto facultativo)', facultativo: true };
  m[chave(somarDias(p, -47))] = { nome: 'Carnaval (ponto facultativo)', facultativo: true };
  m[chave(somarDias(p, -2))] = { nome: 'Sexta-feira Santa', facultativo: false };
  m[chave(somarDias(p, 60))] = { nome: 'Corpus Christi (ponto facultativo)', facultativo: true };
  cacheFeriados[ano] = m;
  return m;
}

module.exports = {
  name: 'Calendário',

  css: `
    .w-cal { display: flex; align-items: center; gap: 10px; user-select: none; }
    .w-cal .mes { display: flex; flex-direction: column; line-height: 1.1; text-align: center; cursor: pointer; }
    .w-cal .mes b { font-size: 13px; font-weight: 700; letter-spacing: .5px; }
    .w-cal .mes small { font-size: 10px; opacity: 0.75; }
    .w-cal .dias { display: flex; gap: 2px; }
    .w-cal .dia { display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1;
      width: 24px; padding: 3px 0; border-radius: 8px; cursor: pointer; transition: background .15s; }
    .w-cal .dia:hover { background: rgba(255,255,255,0.18); }
    .w-cal .dia small { font-size: 9px; opacity: 0.7; }
    .w-cal .dia b { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .w-cal .dia.fds b { opacity: 0.6; }
    .w-cal .dia.feriado b { color: #fbbf24; opacity: 1; }
    .w-cal .dia.facultativo b { color: #fde68a; opacity: 1; }
    .w-cal .dia.hoje { background: var(--accent, #0066ff); }
    .w-cal .dia.hoje b, .w-cal .dia.hoje small { color: #fff; opacity: 1; }
  `,

  setup(el, api) {
    el.innerHTML = '<div class="w-cal"><div class="mes" title="Voltar para hoje"></div><div class="dias"></div></div>';
    const rotulo = el.querySelector('.mes');
    const grade = el.querySelector('.dias');

    let semana = 0; // deslocamento em semanas em relação a hoje
    let diaDesenhado = '';

    function desenhar() {
      const hoje = new Date();
      const hojeChave = hoje.getFullYear() + '-' + chave(hoje);
      diaDesenhado = hojeChave;
      const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + semana * 7);
      const inicio = somarDias(base, -base.getDay());

      let html = '';
      for (let i = 0; i < 7; i++) {
        const d = somarDias(inicio, i);
        const fer = feriados(d.getFullYear())[chave(d)];
        const eHoje = d.getFullYear() + '-' + chave(d) === hojeChave;
        const cls = ['dia',
          (i === 0 || i === 6) ? 'fds' : '',
          fer ? (fer.facultativo ? 'facultativo' : 'feriado') : '',
          eHoje ? 'hoje' : ''].filter(Boolean).join(' ');
        const texto = DIAS_LONGOS[i] + ', ' + d.getDate() + ' de ' + MESES_LONGOS[d.getMonth()] + ' de ' + d.getFullYear() +
          (fer ? '\n' + fer.nome : '');
        html += '<div class="' + cls + '" data-a="' + d.getFullYear() + '" data-m="' + (d.getMonth() + 1) + '" data-d="' + d.getDate() +
          '" title="' + texto + '"><small>' + DIAS[i] + '</small><b>' + d.getDate() + '</b></div>';
      }
      grade.innerHTML = html;

      const fim = somarDias(inicio, 6);
      const mes = inicio.getMonth() === fim.getMonth()
        ? MESES[inicio.getMonth()]
        : MESES[inicio.getMonth()] + '/' + MESES[fim.getMonth()];
      const ano = inicio.getFullYear() === fim.getFullYear() ? inicio.getFullYear() : inicio.getFullYear() + '/' + String(fim.getFullYear()).slice(2);
      rotulo.innerHTML = '<b>' + mes + '</b><small>' + ano + '</small>';
      api.refreshLayout();
    }

    grade.addEventListener('click', (e) => {
      const dia = e.target.closest('.dia');
      if (dia) api.openUrl(URL_DIA(dia.dataset.a, dia.dataset.m, dia.dataset.d));
    });
    rotulo.addEventListener('click', () => { semana = 0; desenhar(); });
    const aoRolar = (e) => {
      e.preventDefault();
      semana += e.deltaY > 0 ? 1 : -1;
      desenhar();
    };
    el.addEventListener('wheel', aoRolar, { passive: false });

    desenhar();

    // virou o dia? atualiza o destaque de "hoje"
    const timer = setInterval(() => {
      const agora = new Date();
      if (agora.getFullYear() + '-' + chave(agora) !== diaDesenhado) desenhar();
    }, 60 * 1000);

    return () => clearInterval(timer);
  }
};
