// Widget: player de música.
//
// Mostra o que está tocando e controla (anterior / play-pause / próxima) qualquer app que use os
// controles de mídia do Windows: Spotify, YouTube e outros no navegador, Deezer, VLC, Groove etc.
// Não precisa de login nem de chave de API.
const { spawn, execFile } = require('child_process');

const TIPO_GERENCIADOR = '[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]';
const TIPO_PROPRIEDADES = '[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]';

// Parte comum: carrega o WinRT e cria a função Await para as chamadas assíncronas
const PRELUDIO = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $tipo) {
  $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
$Gerenciador = ${TIPO_GERENCIADOR}
$Propriedades = ${TIPO_PROPRIEDADES}
`;

// Fica rodando e imprime uma linha JSON a cada ~1,5 s com o que está tocando
const SCRIPT_MONITOR = PRELUDIO + `
function Emitir($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
$mgr = Await ($Gerenciador::RequestAsync()) $Gerenciador
while ($true) {
  try {
    $s = $mgr.GetCurrentSession()
    if ($null -eq $s) { Emitir @{ estado = 'nenhum' } }
    else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $Propriedades
      $estado = $s.GetPlaybackInfo().PlaybackStatus.ToString()
      Emitir @{ estado = $estado; titulo = [string]$p.Title; artista = [string]$p.Artist; app = [string]$s.SourceAppUserModelId }
    }
  } catch { Emitir @{ estado = 'nenhum' } }
  Start-Sleep -Milliseconds 1500
}
`;

// Executa um comando de mídia uma vez
function scriptComando(metodo) {
  return PRELUDIO + `
$mgr = Await ($Gerenciador::RequestAsync()) $Gerenciador
$s = $mgr.GetCurrentSession()
if ($null -ne $s) { Await ($s.${metodo}()) ([bool]) | Out-Null }
`;
}

function powershellArgs(script) {
  return ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

module.exports = {
  name: 'Player de música',

  css: `
    .w-mus { display: flex; align-items: center; gap: 8px; }
    .w-mus .info { display: flex; flex-direction: column; line-height: 1.2; width: 150px; }
    .w-mus .info b { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .w-mus .info small { font-size: 10px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .w-mus .ctl { display: flex; gap: 2px; }
    .w-mus button { width: 26px; height: 26px; border: 0; border-radius: 50%; cursor: pointer; font-size: 12px;
      color: inherit; background: rgba(255,255,255,0.12); transition: background .15s, transform .1s; }
    .w-mus button:hover { background: rgba(255,255,255,0.28); }
    .w-mus button:active { transform: scale(0.9); }
    .w-mus.parado .info { opacity: 0.6; }
  `,

  setup(el, api) {
    el.innerHTML =
      '<div class="w-mus parado">' +
        '<div class="ctl">' +
          '<button data-c="TrySkipPreviousAsync" title="Anterior">⏮</button>' +
          '<button data-c="TryTogglePlayPauseAsync" data-play title="Tocar / pausar">▶</button>' +
          '<button data-c="TrySkipNextAsync" title="Próxima">⏭</button>' +
        '</div>' +
        '<div class="info"><b>Nada tocando</b><small>♪</small></div>' +
      '</div>';
    const caixa = el.querySelector('.w-mus');
    const titulo = el.querySelector('b');
    const detalhe = el.querySelector('small');
    const botaoPlay = el.querySelector('[data-play]');

    function mostrar(d) {
      const tocando = d.estado === 'Playing';
      const temMusica = d.estado && d.estado !== 'nenhum' && d.estado !== 'Closed';
      caixa.classList.toggle('parado', !tocando);
      botaoPlay.textContent = tocando ? '⏸' : '▶';
      if (!temMusica) {
        titulo.textContent = 'Nada tocando';
        detalhe.textContent = '♪';
        caixa.title = '';
        return;
      }
      titulo.textContent = d.titulo || 'Sem título';
      detalhe.textContent = d.artista || (d.app || '').replace(/\.exe$/i, '');
      caixa.title = [d.titulo, d.artista, d.app].filter(Boolean).join('\n');
    }

    // Monitor permanente (um único PowerShell em segundo plano)
    let monitor = null;
    let buffer = '';
    let encerrado = false;
    function iniciarMonitor() {
      monitor = spawn('powershell.exe', powershellArgs(SCRIPT_MONITOR), { windowsHide: true });
      monitor.stdout.setEncoding('utf8');
      monitor.stdout.on('data', (chunk) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const linha = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!linha) continue;
          try { mostrar(JSON.parse(linha)); } catch (e) { /* linha quebrada, ignora */ }
        }
      });
      // se o PowerShell cair, tenta de novo em 5 s
      monitor.on('exit', () => {
        monitor = null;
        if (!encerrado) setTimeout(() => { if (!encerrado && !monitor) iniciarMonitor(); }, 5000);
      });
    }
    iniciarMonitor();

    const parar = () => { encerrado = true; if (monitor) { try { monitor.kill(); } catch (e) {} } };
    window.addEventListener('beforeunload', parar);

    el.querySelectorAll('button[data-c]').forEach((b) => {
      b.addEventListener('click', () => {
        const metodo = b.dataset.c;
        // reação imediata no ícone; o monitor corrige em seguida se for preciso
        if (metodo === 'TryTogglePlayPauseAsync') {
          const vaiTocar = botaoPlay.textContent === '▶';
          botaoPlay.textContent = vaiTocar ? '⏸' : '▶';
          caixa.classList.toggle('parado', !vaiTocar);
        }
        execFile('powershell.exe', powershellArgs(scriptComando(metodo)), { windowsHide: true }, () => {});
      });
    });

    return () => {
      window.removeEventListener('beforeunload', parar);
      parar();
    };
  }
};
