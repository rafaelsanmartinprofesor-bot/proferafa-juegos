'use strict';
// Reparte el estado del servidor al minijuego que corresponde (bombs, tetris, ...).
(() => {
  const TP = window.TP;
  const games = window.TPGames = window.TPGames || {};
  let current = null;
  TP.socket.on('game:state', (s) => {
    current = s;
    Object.values(games).forEach((m) => m.onState(s && s.type === m.type ? s : null));
  });
  window.TPGame = {
    refresh() {
      const m = current && games[current.type];
      if (m) m.draw();
      else TP.app.innerHTML = '<section class="loading-panel panel"><div class="spinner"></div><p>Preparando el juego…</p></section>';
    }
  };
})();
