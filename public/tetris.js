'use strict';
// Pantallas del minijuego 2 (Encaje vectorial): proyector y teléfono.
(() => {
  const TP = window.TP;
  const { socket, app } = TP;
  const esc = TP.escapeHtml;
  window.TPGames = window.TPGames || {};

  let s = null, offset = 0, round = -1, seq = [], tdx = 0, tdy = 0, msg = '', sig = '', timerId = null;

  // ---------- Geometría (misma lógica que el servidor) ----------
  const toC = ([x, y]) => [2 * x + 1, 2 * y + 1];
  const fromC = ([a, b]) => [(a - 1) / 2, (b - 1) / 2];
  function applyOp(cs, op) {
    switch (op.t) {
      case 'r90': return cs.map(([a, b]) => [-b, a]);
      case 'r-90': return cs.map(([a, b]) => [b, -a]);
      case 'r180': return cs.map(([a, b]) => [-a, -b]);
      case 'mx': return cs.map(([a, b]) => [a, -b]);
      case 'my': return cs.map(([a, b]) => [-a, b]);
      case 'tr': return cs.map(([a, b]) => [a + 2 * op.dx, b + 2 * op.dy]);
      default: return cs;
    }
  }
  const flip = (op) => (op.t === 'r90' ? { t: 'r-90' } : op.t === 'r-90' ? { t: 'r90' } : op);
  const keyOf = (cs) => cs.map((c) => c.join(',')).sort().join('|');
  const SHORT = { r90: '↺ 90°', 'r-90': '↻ 90°', r180: '↻ 180°', mx: '⇅ eje X', my: '⇄ eje Y' };
  const LONG = { r90: 'Rotación de 90° antihoraria', 'r-90': 'Rotación de 90° horaria', r180: 'Rotación de 180°', mx: 'Reflexión respecto al eje X', my: 'Reflexión respecto al eje Y' };
  const short = (o) => (o.t === 'tr' ? `→ (${o.dx}, ${o.dy})` : SHORT[o.t]);
  const long = (o) => (o.t === 'tr' ? `Traslación con vector (${o.dx}, ${o.dy})` : LONG[o.t]);

  const me = () => (s && TP.player ? s.players.find((p) => p.id === TP.player.id) : null);
  const amVictim = () => Boolean(me() && s.hit.includes(me().id));
  function preview() {
    const ops = amVictim() ? seq.map(flip) : seq;
    return ops.reduce((acc, op) => applyOp(acc, op), s.start.map(toC)).map(fromC);
  }
  const sameCells = (a, b) => keyOf(a.map(toC)) === keyOf(b.map(toC));
  const rankOf = (p) => 1 + s.players.filter((q) => q.score > p.score).length;

  // ---------- Dibujo del plano ----------
  function board(ghost, ghostColor, fit) {
    const { min, max } = s.bounds, N = max - min + 1;
    const X = (x) => x - min, Y = (y) => max - y;
    const cell = (c, cls, extra = '') => `<rect class="${cls}" x="${X(c[0]) + 0.05}" y="${Y(c[1]) + 0.05}" width="0.9" height="0.9" rx="0.14" ${extra}/>`;
    let h = `<svg class="tb" viewBox="-1.6 -0.4 ${N + 2} ${N + 1.9}" role="img" aria-label="Plano cartesiano con la pieza y su hueco">`;
    for (let i = 0; i <= N; i++) {
      h += `<line class="g${i === -min ? ' ax' : ''}" x1="${i}" y1="0" x2="${i}" y2="${N}"/><line class="g${i === max + 1 ? ' ax' : ''}" x1="0" y1="${i}" x2="${N}" y2="${i}"/>`;
      h += `<text class="tl" x="${i}" y="${N + 0.75}" text-anchor="middle">${min + i}</text><text class="tl" x="-0.2" y="${i + 0.17}" text-anchor="end">${max + 1 - i}</text>`;
    }
    const solved = s.phase === 'result' || s.phase === 'end';
    s.target.forEach((c) => { h += cell(c, `t-target${solved ? ' solved' : ''}`); });
    s.start.forEach((c) => { h += cell(c, 't-start'); });
    if (ghost && !sameCells(ghost, s.start)) ghost.forEach((c) => { h += cell(c, `t-ghost${fit ? ' fit' : ''}`, `style="--c:${esc(ghostColor)}"`); });
    return `${h}</svg>`;
  }

  function timerBlock() { return '<div class="tbar"><span id="ttf"></span></div><div class="tsec" id="tts"></div>'; }
  function tick() {
    if (!s) return;
    const left = Math.max(0, (s.endsAt - (Date.now() + offset)) / 1000);
    const total = Math.max(1, s.durationMs / 1000);
    const f = document.getElementById('ttf'), t = document.getElementById('tts');
    if (f) f.style.width = `${Math.min(100, (left / total) * 100)}%`;
    if (t) t.textContent = s.phase === 'end' ? '' : `${Math.ceil(left)} s`;
  }

  // ---------- Proyector ----------
  function hostView() {
    const ranking = [...s.players].sort((a, b) => b.score - a.score);
    const solvedList = s.players.filter((p) => p.solved).sort((a, b) => a.order - b.order);
    const titles = { intro: '¡Prepárense!', play: '¡Encajen la pieza!', result: 'Fin de la ronda', end: 'Resultado final' };
    const chip = (p, extra = '') => `<span class="gchip" style="--c:${esc(p.color)}">${extra}${esc(p.name)}</span>`;
    const victims = s.hit.map((id) => s.players.find((p) => p.id === id)).filter(Boolean);
    let side = '';
    if (s.phase === 'intro') {
      side = `<p class="rule">En tu teléfono arma una secuencia de pasos que lleve la <strong>pieza gris</strong> hasta el <strong>hueco dorado</strong>.<br>Giros y reflexiones se hacen respecto al origen (0, 0). El orden de los pasos cambia el resultado.<br>Los primeros en encajar ganan más puntos. Son ${s.rounds} rondas.</p>`;
    } else if (s.phase === 'play') {
      side = `<p class="rule">Ronda <strong>${s.round} de ${s.rounds}</strong>. Se resuelve con <strong>${s.steps}</strong> ${s.steps === 1 ? 'paso' : 'pasos'} (máximo ${s.maxSteps}).</p>`
        + (victims.length ? `<div class="t-hit">🌀 Sabotaje: giros horario y antihorario invertidos para ${victims.map((p) => esc(p.name)).join(', ')}</div>` : '')
        + `<h3>Ya encajaron</h3><div class="gchips">${solvedList.length ? solvedList.map((p) => chip(p, `#${p.order} `)).join('') : '<span class="t-muted">Todavía nadie</span>'}</div>`;
    } else if (s.phase === 'result') {
      side = `<p class="rule">Una solución posible:</p><ol class="t-sol">${(s.solution || []).map((o) => `<li>${esc(long(o))}</li>`).join('')}</ol>`
        + `<p class="t-muted">${s.players.some((p) => p.hasItem) ? '🎁 Quien encajó primero puede sabotear a un rival desde su teléfono.' : ''}${s.pendingHits ? ` Sabotajes listos para la próxima ronda: ${s.pendingHits}.` : ''}</p>`;
    } else {
      const top = ranking.slice(0, 3);
      side = `<div class="winner">🏆<h2>${top[0] ? esc(top[0].name) : ''}</h2></div><ol class="t-sol">${top.map((p, i) => `<li>${['🥇', '🥈', '🥉'][i]} ${esc(p.name)}: ${p.score} puntos</li>`).join('')}</ol>`;
    }
    const board8 = ranking.slice(0, 8).map((p, i) => `<li><span class="t-pos">${i + 1}</span><span class="t-dotc" style="--c:${esc(p.color)}"></span><span class="t-nm">${esc(p.name)}${p.hasItem ? ' 🎁' : ''}</span><span class="t-pts">${p.score}${p.gain && s.phase !== 'intro' ? ` <small>+${p.gain}</small>` : ''}</span></li>`).join('');
    return `
      <div class="lobby-heading"><div><span class="eyebrow">ENCAJE VECTORIAL · RONDA ${Math.max(s.round, 1)} DE ${s.rounds}</span><h1>${titles[s.phase]}</h1></div><span class="state-pill">${s.players.length} JUGADORES</span></div>
      <div class="gm-layout">
        <section class="panel gm-board">${s.phase === 'intro' ? board(null) : board(null)}${s.phase === 'end' ? '' : timerBlock()}</section>
        <aside class="panel gm-side">${side}<h3>Puntajes</h3><ul class="t-rank">${board8}</ul></aside>
      </div>
      ${s.phase === 'end' ? TP.switchPicker('tetris') : ''}
      <section class="host-controls panel"><div class="control-copy"><strong>Controles del profesor</strong><span>Las rondas avanzan solas. Cada ronda exige más pasos y da más tiempo.</span></div>
        <div class="control-buttons">${s.phase === 'end' ? '<button class="button" id="gRestart" type="button">Jugar otra vez</button>' : ''}<button class="button secondary" id="gLobby" type="button">↶ Volver al lobby</button><button class="button danger" id="gEnd" type="button">Terminar sala</button></div></section>`;
  }

  // ---------- Teléfono ----------
  function targetsMarkup() {
    const others = [...s.players].filter((p) => p.id !== me().id).sort((a, b) => b.score - a.score);
    return `<div class="t-targets">${others.map((p) => `<button type="button" class="t-target-btn" data-target="${esc(p.id)}" style="--c:${esc(p.color)}">${esc(p.name)} <small>${p.score}</small></button>`).join('')}</div>`;
  }

  function playerView() {
    const m = me();
    if (!m) return '<section class="started-card panel"><h1>Mira el proyector.</h1></section>';
    const head = `<div class="t-top"><span class="room-badge" style="--c:${esc(m.color)}">● ${esc(m.name)}</span><span class="t-score">⭐ ${m.score}</span></div>`;
    let body = '';
    if (s.phase === 'intro') {
      body = `<h1>¡Prepárate!</h1><p>Vas a armar una secuencia de giros, reflexiones y traslaciones para encajar la pieza en su hueco. Son ${s.rounds} rondas. El orden de los pasos importa.</p>`;
    } else if (s.phase === 'end') {
      const r = rankOf(m);
      body = `<h1>${r === 1 ? '🏆 ¡Ganaste!' : `Quedaste en el lugar ${r}`}</h1><p>Puntaje final: <strong>${m.score}</strong>. Mira el proyector para ver el podio.</p><p>${esc(TP.sessionLine(m.id))}</p>`;
    } else if (s.phase === 'result') {
      body = `<h1>${m.solved ? `✅ +${m.gain} puntos` : '⏱️ No alcanzaste a encajar'}</h1><p>Vas en el lugar <strong>${rankOf(m)}</strong> con ${m.score} puntos. La próxima ronda empieza pronto.</p>`
        + (m.hasItem ? `<div class="t-item"><strong>🎁 Ítem de sabotaje</strong><span>Elige a un rival. En la próxima ronda sus giros horario y antihorario quedan invertidos.</span>${targetsMarkup()}</div>` : '');
    } else if (m.solved) {
      body = `<h1>✅ ¡Encajó!</h1><p>Llegaste en el lugar <strong>${m.order}</strong> y sumaste <strong>${m.gain}</strong> puntos. Espera a que termine la ronda.</p>${m.hasItem ? '<p class="t-muted">🎁 Ganaste un ítem de sabotaje. Podrás usarlo al terminar la ronda.</p>' : ''}`;
    } else {
      const ghost = preview();
      const fit = sameCells(ghost, s.target);
      const full = seq.length >= s.maxSteps;
      const chips = seq.length ? seq.map((o, i) => `<span class="sq"><b>${i + 1}</b>${esc(short(o))}</span>`).join('') : '<span class="t-muted">Agrega pasos con los botones</span>';
      body = `<div class="t-info">Ronda ${s.round} de ${s.rounds} · se resuelve con ${s.steps} ${s.steps === 1 ? 'paso' : 'pasos'} (máx. ${s.maxSteps})</div>`
        + (amVictim() ? '<div class="t-hit">🌀 Te cambiaron el eje: tus giros horario y antihorario salen al revés. La vista previa muestra lo que realmente pasa.</div>' : '')
        + board(ghost, m.color, fit) + timerBlock()
        + `<div class="t-seq">${chips}</div>`
        + `<div class="t-ops">${[['r90', '↺ Girar 90° antihorario'], ['r-90', '↻ Girar 90° horario'], ['r180', '↻ Girar 180°'], ['mx', '⇅ Reflejar en eje X'], ['my', '⇄ Reflejar en eje Y']].map(([k, l]) => `<button type="button" class="opbtn" data-op="${k}" ${full ? 'disabled' : ''}>${l}</button>`).join('')}</div>`
        + `<div class="t-tr"><div class="stp"><span>a (horizontal)</span><div><button type="button" data-k="dx" data-d="-1">−</button><output>${tdx}</output><button type="button" data-k="dx" data-d="1">+</button></div></div><div class="stp"><span>b (vertical)</span><div><button type="button" data-k="dy" data-d="-1">−</button><output>${tdy}</output><button type="button" data-k="dy" data-d="1">+</button></div></div></div>`
        + `<button type="button" class="opbtn wide" id="tAddTr" ${full || (tdx === 0 && tdy === 0) ? 'disabled' : ''}>→ Trasladar (${tdx}, ${tdy})</button>`
        + `<div class="t-status${fit ? ' ok' : ''}">${fit ? '✅ ¡Encaja! Envíalo ahora.' : esc(msg)}</div>`
        + `<div class="t-actions"><button type="button" class="button outline" id="tUndo" ${seq.length ? '' : 'disabled'}>Deshacer</button><button type="button" class="button outline" id="tClear" ${seq.length ? '' : 'disabled'}>Borrar todo</button><button type="button" class="button" id="tSend" ${fit ? '' : 'disabled'}>Enviar</button></div>`;
    }
    return `<section class="gm-phone t-phone panel">${head}${body}</section>`;
  }

  function mySig() {
    const m = me();
    return m ? [s.phase, s.round, m.solved, m.hasItem, m.score, s.hit.join(',')].join('|') : 'x';
  }

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
      TP.bindSwitchPicker(app);
      on('gEnd', () => { if (window.confirm('¿Terminar esta sala?')) TP.hostAction('end'); });
    } else {
      const redo = () => draw();
      app.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => {
        if (seq.length < s.maxSteps) { seq.push({ t: b.dataset.op }); msg = ''; redo(); }
      }));
      app.querySelectorAll('.stp button').forEach((b) => b.addEventListener('click', () => {
        const d = Number(b.dataset.d);
        if (b.dataset.k === 'dx') tdx = Math.max(-12, Math.min(12, tdx + d)); else tdy = Math.max(-12, Math.min(12, tdy + d));
        redo();
      }));
      const click = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      click('tAddTr', () => { if (seq.length < s.maxSteps && (tdx !== 0 || tdy !== 0)) { seq.push({ t: 'tr', dx: tdx, dy: tdy }); msg = ''; tdx = 0; tdy = 0; redo(); } });
      click('tUndo', () => { seq.pop(); msg = ''; redo(); });
      click('tClear', () => { seq = []; msg = ''; redo(); });
      click('tSend', () => { socket.emit('game:action', { code: TP.room.code, type: 'submit', seq }); });
      app.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => {
        socket.emit('game:action', { code: TP.room.code, type: 'item', target: b.dataset.target });
      }));
    }
    timerId = setInterval(tick, 200); tick();
  }

  socket.on('game:feedback', (f) => {
    if (!s || TP.role !== 'player') return;
    msg = f && !f.ok ? (f.msg || 'Todavía no encaja.') : '';
    if (s.phase === 'play' && !(me() && me().solved)) draw();
  });

  window.TPGames.tetris = {
    type: 'tetris',
    onState(next) {
      s = next;
      if (!s) { clearInterval(timerId); sig = ''; round = -1; return; }
      offset = s.now - Date.now();
      if (s.round !== round) { round = s.round; seq = []; tdx = 0; tdy = 0; msg = ''; }
      if (!(TP.room && TP.room.status === 'started' && TP.role)) return;
      if (TP.role === 'player' && mySig() === sig) return;
      draw();
    },
    draw() { draw(); }
  };
})();
