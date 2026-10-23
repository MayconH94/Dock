// MODELO DE WIDGET. Para criar o seu:
//   1) copie este arquivo, tire o "_" do começo do nome (ex.: meu-widget.js)
//   2) edite o que quiser
//   3) abra as configurações do dock (botão direito no ❖) e marque o widget na lista
//
// Arquivos que começam com "_" não aparecem na lista.
module.exports = {
  // Nome mostrado na lista de configurações
  name: 'Meu widget',

  // (opcional) estilos só deste widget
  css: `
    .w-meu { font-size: 12px; }
  `,

  // Roda quando o widget aparece. "el" é a caixinha (div) dentro do dock.
  // "api" traz:
  //   api.openUrl('https://...')   abre um link no navegador
  //   api.openPath('C:\\pasta')    abre arquivo, pasta ou programa
  //   api.dataDir                  pasta de dados do dock (%APPDATA%\win-dock)
  //   api.refreshLayout()          chame se o widget mudar de largura
  setup(el, api) {
    el.innerHTML = '<span class="w-meu">Olá!</span>';

    el.addEventListener('click', () => {
      api.openUrl('https://www.google.com');
    });

    // (opcional) devolva uma função para limpar timers quando o widget for desligado
    return () => {};
  }
};
