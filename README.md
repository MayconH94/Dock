# Win Dock

Dock customizável para Windows feita com Electron, que também funciona como **barra de tarefas**.

## Recursos

### Barra de tarefas
- Mostra as **janelas abertas** com ícone e bolinhas indicadoras (uma por janela, até 3; a da janela ativa fica alongada).
- **Clique** em um app aberto: traz para frente; se já está na frente, minimiza; com várias janelas, alterna entre elas. Se o app fixado não está aberto, inicia o programa.
- **Clique do meio** abre outra janela do app.
- **Clique direito**: abrir, fechar janela(s), fixar ou desafixar.
- **Botão ❖**: clique esquerdo abre o menu Iniciar do Windows; clique direito abre as configurações ou fecha o dock.
- **Reserva de espaço**: janelas maximizadas não ficam atrás do dock (opcional).
- Não rouba o foco do programa em uso e **se esconde** quando um app está em tela cheia (vídeo, jogo).
- Opção de mostrar **todos os tipos de janela**, incluindo diálogos e janelas de ferramenta.
- Opção de **iniciar com o Windows** (no app instalado).

### Visual e fluidez
- Ampliação suave dos ícones sob o mouse, animações de entrada/saída e dica com o nome do app.
- Com muitos itens, os ícones encolhem para caber na tela.
- **Estilos**: Vidro, Sólido, Minimalista e Ilhas.
- **Temas**, transparência, cor, desfoque, arredondamento, tamanho dos ícones e posição (embaixo ou em cima).
- **Widgets** (relógio, calendário, música, bateria...) e efeitos sazonais.

## Como usar
- Arraste atalhos (programas, pastas, arquivos) para a barra para fixá-los.
- Clique direito no botão azul ❖ → **Personalizar dock…** para abrir as configurações.
- Temas ficam na pasta `themes` (veja `themes/LEIA-ME.txt`).
- Widgets ficam na pasta `widgets` (veja `widgets/_modelo.js`).
- Ícones personalizados: coloque `NomeDoAtalho.png` em `%APPDATA%\win-dock\icons`.

Os dados (atalhos, configurações, ícones, temas e widgets próprios) ficam em `%APPDATA%\win-dock`.

## Rodar em desenvolvimento
    npm install
    npm start

> Se o app abrir como Node puro, a variável `ELECTRON_RUN_AS_NODE` está definida no terminal; remova-a antes de rodar.

## Gerar o instalador (.exe)
    npm run dist
O resultado fica na pasta `dist/`.

## Como funciona
- `main.js`: janela transparente em largura total (o mouse atravessa tudo que não é a barra), configurações, menus e reserva de espaço.
- `winapi.js`: ponte com a API do Windows via [koffi](https://koffi.dev) (lista de janelas, ativar/minimizar/fechar, AppBar, ícones de janela).
- `renderer.js` / `style.css`: interface, animações e ampliação.
