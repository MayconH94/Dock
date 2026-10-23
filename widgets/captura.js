// Widget: atalhos de captura de tela.
//
//   ✂  recorte: abre a seleção de área do Windows (igual ao Win+Shift+S). A imagem vai para a área de transferência.
//   🖥  tela toda: salva um PNG em Imagens\Capturas e também copia para a área de transferência.
//   📁  abre a pasta Imagens\Capturas.
//
// Obs.: na captura da tela toda o próprio dock aparece na imagem.
const { execFile } = require('child_process');

// Roda um script PowerShell (em STA, necessário para a área de transferência) e devolve o texto impresso.
function powershell(script) {
  const codificado = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado],
      { windowsHide: true, timeout: 20000 },
      (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim())) : resolve(out.trim())));
  });
}

const SCRIPT_TELA_TODA = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[Dpi]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$dir = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Capturas'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$arq = Join-Path $dir ('captura-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
$v = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $v.Width, $v.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($v.Left, $v.Top, 0, 0, $bmp.Size)
$bmp.Save($arq, [System.Drawing.Imaging.ImageFormat]::Png)
[System.Windows.Forms.Clipboard]::SetDataObject($bmp, $true)
$g.Dispose()
Write-Output $arq
`;

const SCRIPT_PASTA = `
$dir = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Capturas'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Output $dir
`;

module.exports = {
  name: 'Captura de tela',

  css: `
    .w-cap { display: flex; gap: 4px; align-items: center; }
    .w-cap button { width: 30px; height: 30px; border: 0; border-radius: 8px; cursor: pointer; font-size: 15px;
      color: inherit; background: rgba(255,255,255,0.12); transition: background .15s, transform .1s; }
    .w-cap button:hover { background: rgba(255,255,255,0.28); }
    .w-cap button:active { transform: scale(0.92); }
    .w-cap button:disabled { opacity: 0.5; cursor: default; }
    .w-cap .ok { background: rgba(74,222,128,0.45); }
    .w-cap .erro { background: rgba(248,113,113,0.5); }
  `,

  setup(el, api) {
    el.innerHTML =
      '<div class="w-cap">' +
        '<button data-a="recorte" title="Recortar uma área (vai para a área de transferência)">✂</button>' +
        '<button data-a="tela" title="Capturar a tela toda (salva em Imagens\\Capturas e copia)">🖥</button>' +
        '<button data-a="pasta" title="Abrir a pasta de capturas">📁</button>' +
      '</div>';
    const botoes = {};
    el.querySelectorAll('button').forEach((b) => { botoes[b.dataset.a] = b; });

    const timers = [];
    function piscar(botao, classe, dica) {
      const antes = botao.title;
      botao.classList.add(classe);
      if (dica) botao.title = dica;
      timers.push(setTimeout(() => { botao.classList.remove(classe); botao.title = antes; }, 1800));
    }

    botoes.recorte.addEventListener('click', () => {
      // abre a ferramenta de recorte do Windows 10/11
      execFile('cmd.exe', ['/c', 'start', '', 'ms-screenclip:'], { windowsHide: true }, (err) => {
        if (err) piscar(botoes.recorte, 'erro', 'Não consegui abrir o recorte: ' + err.message);
      });
    });

    botoes.tela.addEventListener('click', async () => {
      botoes.tela.disabled = true;
      try {
        const arquivo = await powershell(SCRIPT_TELA_TODA);
        piscar(botoes.tela, 'ok', 'Salva: ' + arquivo + ' (e copiada)');
      } catch (e) {
        piscar(botoes.tela, 'erro', 'Falhou: ' + String(e.message).split('\n')[0].slice(0, 120));
      } finally {
        botoes.tela.disabled = false;
      }
    });

    botoes.pasta.addEventListener('click', async () => {
      try {
        api.openPath(await powershell(SCRIPT_PASTA));
      } catch (e) {
        piscar(botoes.pasta, 'erro', 'Não abriu a pasta: ' + String(e.message).split('\n')[0].slice(0, 120));
      }
    });

    return () => timers.forEach(clearTimeout);
  }
};
