# Win Dock

Dock customizável para Windows feita com Electron.

- Arraste atalhos (programas, pastas, arquivos) para a barra; clique direito em um atalho para remover.
- Clique direito no botão azul para abrir as configurações (transparência, cor, tamanho, posição, temas).
- Temas ficam na pasta `themes` (veja `themes/LEIA-ME.txt`).
- Ícones personalizados: coloque `NomeDoAtalho.png` na pasta `icons` dentro da pasta de dados do app (`%APPDATA%\win-dock\icons`).

## Rodar em desenvolvimento
    npm install
    npm start

## Gerar o instalador (.exe)
    npm run dist
O resultado fica na pasta `dist/`.
