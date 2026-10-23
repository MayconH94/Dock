// Widget de exemplo: relógio com data.
module.exports = {
  name: 'Relógio',

  // CSS opcional do widget
  css: `
    .w-clock { display: flex; flex-direction: column; line-height: 1.15; text-align: center; min-width: 58px; }
    .w-clock b { font-size: 15px; font-weight: 600; }
    .w-clock small { font-size: 10px; opacity: 0.8; text-transform: capitalize; }
  `,

  // Chamado quando o widget aparece no dock. "el" é a caixinha do widget.
  setup(el, api) {
    el.innerHTML = '<div class="w-clock"><b></b><small></small></div>';
    const hora = el.querySelector('b');
    const data = el.querySelector('small');

    const atualizar = () => {
      const agora = new Date();
      hora.textContent = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      data.textContent = agora.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    };
    atualizar();
    const timer = setInterval(atualizar, 1000);

    // Opcional: função de limpeza, chamada quando o widget é desligado
    return () => clearInterval(timer);
  }
};
