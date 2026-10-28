'use strict';
// Pantallas del minijuego 4 (Órbita Cero): proyector y teléfono.
(() => {
  const TP = window.TP;
  const { socket, app } = TP;
  const esc = TP.escapeHtml;
  window.TPGames = window.TPGames || {};

  let s = null, offset = 0, round = -1, self = null, sig = '', timerId = null;

  const me = () => (s && TP.player ? s.players.find((p) => p.id === TP.player.id) : null);
  const rankOrder = (a, b) => (Number(b.alive) - Number(a.alive)) || (a.alive ? b.score - a.score : (b.outRound - a.outRound) || (b.score - a.score));
  const initial = (p) => esc((p.name || '?').slice(0, 1).toUpperCase());

  // ---------- Plano ----------
  // mode: 'plain' (sin sector), 'play' (sector y centro), 'reveal' (proyector, con giro animado),
  // 'phone-reveal' (resultado en el teléfono). interactive agrega las casillas tocables.
  function board(mode, avatarList, interactive) {
    const { min, max } = s.bounds, N = max - min + 1;
    const X = (x) => x - min, Y = (y) => max - y, VX = (v) => v - min, VY = (v) => max + 1 - v;
    const targetKeys = new Set((s.target || []).map((c) => c.join(',')));
    const rect = (c, cls, style = '') => `<rect class="${cls}" x="${X(c[0]) + 0.04}" y="${Y(c[1]) + 0.04}" width="0.92" height="0.92" rx="0.12" ${style}/>`;
    const falling = mode === 'reveal' && !s.void;
    let h = `<svg class="tb o-board" viewBox="-1.6 -0.4 ${N + 2} ${N + 1.9}" role="img" aria-label="Plano cartesiano con el sector que va a girar">`;
    for (let x = min; x <= max; x++) {
      for (let y = min; y <= max; y++) {
        const fall = falling && !targetKeys.has(`${x},${y}`);
        h += rect([x, y], `o-tile${fall ? ' o-fall' : ''}`, fall ? `style="animation-delay:${(2.1 + ((((x * 7 + y * 3) % 10) + 10) % 10) / 25).toFixed(2)}s"` : '');
      }
    }
    for (let i = 0; i <= N; i++) {
      h += `<line class="g${i === -min ? ' ax' : ''}" x1="${i}" y1="0" x2="${i}" y2="${N}"/><line class="g${i === max + 1 ? ' ax' : ''}" x1="0" y1="${i}" x2="${N}" y2="${i}"/>`;
      h += `<text class="tl" x="${i}" y="${N + 0.75}" text-anchor="middle">${min + i}</text><text class="tl" x="-0.2" y="${i + 0.17}" text-anchor="end">${max + 1 - i}</text>`;
    }
    const o = s.order;
    if (o && mode !== 'plain') {
      const cells = (list, cls) => list.map((c) => rect(c, cls)).join('');
      if (mode === 'play') h += cells(s.sector, 'o-sector');
      else if (mode === 'phone-reveal') h += cells(s.sector, 'o-sector ghost') + cells(s.target || [], 'o-sector');
      else if (mode === 'reveal') {
        const angle = o.dir === 'horario' ? o.mag : o.dir === 'antihorario' ? -o.mag : 180; // sentido anunciado, visto en pantalla
        h += `<g>${cells(s.sector, 'o-sector')}<animateTransform attributeName="transform" type="rotate" from="0 ${VX(o.center[0])} ${VY(o.center[1])}" to="${angle} ${VX(o.center[0])} ${VY(o.center[1])}" begin="0.4s" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1"/></g>`;
      }
      h += `<circle class="o-center" cx="${VX(o.center[0])}" cy="${VY(o.center[1])}" r="0.17"/>`;
    }
    const byCell = {};
    (avatarList || []).forEach((p) => { (byCell[`${p.x},${p.y}`] = byCell[`${p.x},${p.y}`] || []).push(p); });
    Object.entries(byCell).forEach(([k, arr]) => {
      const [x, y] = k.split(',').map(Number);
      const cols = Math.ceil(Math.sqrt(arr.length)), r = Math.min(0.36, 0.44 / cols);
      arr.forEach((p, i) => {
        const cx = X(x) + ((i % cols) + 0.5) / cols, cy = Y(y) + (Math.floor(i / cols) + 0.5) / cols;
        const fall = falling && p.safe === false;
        h += `<g class="${fall ? 'o-fall' : ''}" ${fall ? 'style="animation-delay:2s"' : ''}><circle class="o-av${p.me ? ' o-me' : ''}" cx="${cx}" cy="${cy}" r="${r}" style="fill:${esc(p.color)}"/>${arr.length === 1 ? `<text class="o-init" x="${cx}" y="${cy}">${initial(p)}</text>` : ''}</g>`;
      });
    });
    if (interactive) {
      for (let x = min; x <= max; x++) for (let y = min; y <= max; y++) h += `<rect class="o-hit" data-x="${x}" data-y="${y}" x="${X(x)}" y="${Y(y)}" width="1" height="1"/>`;
    }
    return `${h}</svg>`;
  }

  function timerBlock() { return '<div class="tbar"><span id="otf"></span></div><div class="tsec" id="ots"></div>'; }
  function tick() {
    if (!s) return;
    const left = Math.max(0, (s.endsAt - (Date.now() + offset)) / 1000);
    const total = Math.max(1, s.durationMs / 1000);
    const f = document.getElementById('otf'), t = document.getElementById('ots');
    if (f) f.style.width = `${Math.min(100, (left / total) * 100)}%`;
    if (t) t.textContent = s.phase === 'end' ? '' : `${Math.ceil(left)} s`;
  }

  // ---------- Proyector ----------
  function hostView() {
    const ranking = [...s.players].sort(rankOrder);
    const alive = s.players.filter((p) => p.alive);
    const titles = { intro: '¡Sube a la plataforma!', play: '¡Anticipa el giro!', reveal: s.void ? 'Nadie se salvó' : '¡El gran giro!', end: 'Resultado final' };
    let side = '';
    if (s.phase === 'intro') {
      side = '<p class="rule">Un <strong>sector dorado</strong> del plano va a girar. En tu teléfono toca la casilla donde quedará ese sector después de la rotación.<br>Las casillas que no pertenezcan a la nueva posición <strong>se desmoronan</strong>. El último en pie gana.<br>Si nadie se salva en una ronda, esa ronda no cuenta.</p>';
    } else if (s.phase === 'play' || s.phase === 'reveal') {
      side = `<p class="rule">Ronda <strong>${s.round} de ${s.rounds}</strong></p><div class="o-order o-big">${esc(s.order.label)}</div>`
        + (s.phase === 'play' ? `<p class="rule">Ya eligieron <strong>${alive.filter((p) => p.moved).length} de ${alive.length}</strong>. El punto rosa marca el centro del giro.</p>` : `<p class="rule">${s.void ? 'Nadie quedó sobre la nueva posición. La ronda no cuenta y todos siguen.' : `Se salvaron <strong>${s.players.filter((p) => p.safe === true).length}</strong> de ${s.players.filter((p) => p.safe !== null).length}.`}</p>`);
    } else {
      const top = ranking.slice(0, 3);
      side = `<div class="winner">🏆<h2>${top[0] ? esc(top[0].name) : ''}</h2></div><ol class="t-sol">${top.map((p, i) => `<li>${['🥇', '🥈', '🥉'][i]} ${esc(p.name)}</li>`).join('')}</ol>`;
    }
    const list = ranking.slice(0, 10).map((p, i) => `<li class="${p.alive ? '' : 'out'}"><span class="t-pos">${i + 1}</span><span class="t-dotc" style="--c:${esc(p.color)}"></span><span class="t-nm">${esc(p.name)}${s.phase === 'play' && p.alive && p.moved ? ' ✓' : ''}</span><span class="t-muted">${p.alive ? '' : `cayó en ${p.outRound}`}</span><span class="t-pts">${p.score}</span></li>`).join('');
    const mode = s.phase === 'play' ? 'play' : (s.phase === 'reveal' || s.phase === 'end') && s.order ? 'reveal' : 'plain';
    const avatars = (s.phase === 'reveal' || s.phase === 'end') ? s.players.filter((p) => p.x !== null) : [];
    return `
      <div class="lobby-heading"><div><span class="eyebrow">ÓRBITA CERO · RONDA ${Math.max(s.round, 1)} DE ${s.rounds}</span><h1>${titles[s.phase]}</h1></div><span class="state-pill">${alive.length} EN PIE</span></div>
      <div class="gm-layout">
        <section class="panel gm-board">${board(mode, avatars, false)}${s.phase === 'end' ? '' : timerBlock()}</section>
        <aside class="panel gm-side">${side}<h3>Jugadores</h3><ul class="mm-rank">${list}</ul></aside>
      </div>
      ${s.phase === 'end' ? TP.switchPicker('orbit') : ''}
      <section class="host-controls panel"><div class="control-copy"><strong>Controles del profesor</strong><span>Las rondas avanzan solas. Cada ronda trae un giro más difícil y menos tiempo.</span></div>
        <div class="control-buttons">${s.phase === 'end' ? '<button class="button" id="gRestart" type="button">Jugar otra vez</button>' : ''}<button class="button secondary" id="gLobby" type="button">↶ Volver al lobby</button><button class="button danger" id="gEnd" type="button">Terminar sala</button></div></section>`;
  }

  // ---------- Teléfono ----------
  function playerView() {
    const m = me();
    if (!m) return '<section class="started-card panel"><h1>Mira el proyector.</h1></section>';
    const head = `<div class="t-top"><span class="room-badge" style="--c:${esc(m.color)}">● ${esc(m.name)}</span><span class="t-score">⭐ ${m.score}</span></div>`;
    const mine = (x, y) => [{ x, y, color: m.color, name: m.name, me: true }];
    let body = '';
    if (s.phase === 'intro') {
      body = '<h1>¡Prepárate!</h1><p>Un sector del plano va a girar. Toca la casilla donde quedará después del giro. Las demás casillas se desmoronan.</p>';
    } else if (s.phase === 'play') {
      if (!m.alive) body = '<h1>Quedaste fuera</h1><p>Sigue la partida en el proyector.</p>';
      else {
        body = `<div class="t-info">Ronda ${s.round} de ${s.rounds}</div><div class="o-order">${esc(s.order.label)}</div>`
          + board('play', self ? mine(self.x, self.y) : [], true) + timerBlock()
          + '<p class="mm-hint">Toca la casilla donde quedará el sector dorado tras el giro. Puedes cambiar tu elección mientras haya tiempo. El punto rosa es el centro del giro.</p>';
      }
    } else if (s.phase === 'reveal') {
      if (m.safe === null) body = '<h1>Quedaste fuera</h1><p>Sigue la partida en el proyector.</p>';
      else {
        const title = s.void ? '🛟 Nadie se salvó' : (m.safe ? '✅ ¡Te salvaste!' : '💥 Caíste al abismo');
        const text = s.void ? 'La ronda no cuenta y todos siguen.' : (m.safe ? 'Elegiste la casilla correcta.' : 'La casilla que elegiste no quedó sobre el sector.');
        body = `<h1>${title}</h1><p>${text}</p>${board('phone-reveal', m.x === null ? [] : mine(m.x, m.y), false)}<p class="mm-hint">Línea punteada: el sector antes del giro. Zona dorada: el sector después.</p>`;
      }
    } else {
      const r = 1 + s.players.filter((p) => rankOrder(p, m) < 0).length;
      body = `<h1>${r === 1 ? '🏆 ¡Ganaste!' : `Quedaste en el lugar ${r}`}</h1><p>Sobreviviste hasta la ronda ${m.alive ? s.round : m.outRound}. Mira el proyector para ver el podio.</p><p>${esc(TP.sessionLine(m.id))}</p>`;
    }
    return `<section class="gm-phone t-phone panel">${head}${body}</section>`;
  }

  const mySig = () => { const m = me(); return m ? [s.phase, s.round, m.alive, m.safe, m.score, s.void].join('|') : 'x'; };

  function draw() {
    if (!s || !TP.role) return;
    clearInterval(timerId);
    const host = TP.role === 'host';
    if (!host) sig = mySig();
    app.innerHTML = host ? hostView() : playerView();
    if (host) {
      const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      on('gRestart', () => TP.hostAction('restart'));
      on('gLobby', () => TP.hostAction('reset'));
      on('gEnd', () => { if (window.confirm('¿Terminar esta sala?')) TP.hostAction('end'); });
      TP.bindSwitchPicker(app);
    } else {
      app.querySelectorAll('.o-hit').forEach((r) => r.addEventListener('click', () => {
        if (s.phase !== 'play') return;
        const x = Number(r.dataset.x), y = Number(r.dataset.y);
        self = { x, y };
        socket.emit('game:action', { code: TP.room.code, type: 'move', x, y });
        draw();
      }));
    }
    timerId = setInterval(tick, 200); tick();
  }

  socket.on('game:self', (pos) => {
    if (!pos || TP.role !== 'player') return;
    const changed = !self || self.x !== pos.x || self.y !== pos.y;
    self = { x: pos.x, y: pos.y };
    if (changed && s && s.phase === 'play') draw();
  });

  window.TPGames.orbit = {
    type: 'orbit',
    onState(next) {
      s = next;
      if (!s) { clearInterval(timerId); sig = ''; round = -1; return; }
      offset = s.now - Date.now();
      if (s.round !== round) round = s.round;
      if (!(TP.room && TP.room.status === 'started' && TP.role)) return;
      if (TP.role === 'player' && mySig() === sig) return;
      draw();
    },
    draw() { draw(); }
  };
})();
