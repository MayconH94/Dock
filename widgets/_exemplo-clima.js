// Exemplo com internet: temperatura atual (Open-Meteo, grátis e sem chave).
// Para usar: renomeie para clima.js e troque a latitude/longitude pela da sua cidade.
const LATITUDE = -23.55;
const LONGITUDE = -46.63;

module.exports = {
  name: 'Clima',
  css: `.w-clima { font-size: 13px; white-space: nowrap; }`,

  setup(el, api) {
    el.innerHTML = '<span class="w-clima">☁ --°</span>';
    const texto = el.querySelector('.w-clima');

    async function carregar() {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&current=temperature_2m`;
        const dados = await (await fetch(url)).json();
        texto.textContent = '☁ ' + Math.round(dados.current.temperature_2m) + '°';
        api.refreshLayout();
      } catch (e) {
        texto.textContent = '☁ sem rede';
      }
    }
    carregar();
    const timer = setInterval(carregar, 15 * 60 * 1000); // atualiza a cada 15 min
    return () => clearInterval(timer);
  }
};
