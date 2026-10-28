'use strict';
// Minijuego 4: Órbita Cero (El gran giro).
// Un sector del plano va a girar. Cada jugador debe ubicarse en la casilla donde quedará el sector.
// Las casillas que no pertenecen a la nueva posición se desmoronan. Sobrevive quien anticipó bien el giro.

const MIN = -6, MAX = 5;           // celdas con esquina inferior izquierda entre -6 y 5 (tablero de 12 x 12)
const TOTAL_ROUNDS = 10;
const SIZES = [6, 6, 5, 5, 5, 4, 4, 4, 4, 4];
const SCALE = Number(process.env.TP_TIME_SCALE) || 1; // solo para pruebas automáticas
const INTRO_MS = 6000 * SCALE, REVEAL_MS = 7500 * SCALE;
const playMs = (round) => Math.max(10, 26 - 2 * (round - 1)) * 1000 * SCALE;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (list) => list[rnd(list.length)];

// Celdas como centros en coordenadas dobles: la celda (x, y) tiene centro (2x+1, 2y+1).
// El centro de giro es un vértice de la cuadrícula (cx, cy), que en coordenadas dobles es (2cx, 2cy).
const toC = ([x, y]) => [2 * x + 1, 2 * y + 1];
const fromC = ([a, b]) => [(a - 1) / 2, (b - 1) / 2];
function rotate(cells, ccwDeg, [cx, cy]) {
  const k = ((ccwDeg % 360) + 360) % 360;
  return cells.map((cell) => {
    const [a, b] = toC(cell);
    const ra = a - 2 * cx, rb = b - 2 * cy;
    const [na, nb] = k === 90 ? [-rb, ra] : k === 180 ? [-ra, -rb] : k === 270 ? [rb, -ra] : [ra, rb];
    return fromC([na + 2 * cx, nb + 2 * cy]);
  });
}
const keyOf = (cells) => cells.map((c) => c.join(',')).sort().join('|');
const inside = (cells) => cells.every(([x, y]) => x >= MIN && x <= MAX && y >= MIN && y <= MAX);

// Rotación que se anuncia en cada ronda: la dificultad sube con el sentido, el ángulo y el centro de giro.
function makeOrder(round) {
  let mag, dir, center = [0, 0];
  const anyCenter = () => [rnd(7) - 3, rnd(7) - 3];
  if (round === 1) { mag = 180; dir = null; }
  else if (round === 2) { mag = 90; dir = 'horario'; }
  else if (round === 3) { mag = 90; dir = 'antihorario'; }
  else if (round === 4) { [mag, dir] = pick([[90, 'horario'], [90, 'antihorario'], [270, 'horario'], [270, 'antihorario'], [180, null]]); }
  else if (round === 5) { mag = 180; dir = null; center = anyCenter(); }
  else if (round === 6) { mag = 90; dir = 'horario'; center = anyCenter(); }
  else { [mag, dir] = pick([[90, 'horario'], [90, 'antihorario'], [270, 'horario'], [270, 'antihorario'], [180, null]]); center = anyCenter(); }
  if (center[0] === 0 && center[1] === 0 && round >= 5) center = [pick([-3, -2, -1, 1, 2, 3]), pick([-3, -2, -1, 1, 2, 3])];
  const ccw = mag === 180 ? 180 : (dir === 'antihorario' ? mag : 360 - mag);
  const origin = center[0] === 0 && center[1] === 0;
  const where = origin ? 'al origen (0, 0)' : `al punto (${center[0]}, ${center[1]})`;
  const label = mag === 180 ? `Rotación de 180° respecto ${where}` : `Rotación de ${mag}° en sentido ${dir} respecto ${where}`;
  return { mag, dir, center, ccw, origin, label };
}

function makeSector(size) {
  const cells = [pick([...Array(MAX - MIN + 1).keys()]) + MIN, pick([...Array(MAX - MIN + 1).keys()]) + MIN];
  const set = new Map([[cells.join(','), cells]]);
  while (set.size < size) {
    const [bx, by] = pick([...set.values()]);
    const [dx, dy] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    const c = [bx + dx, by + dy];
    if (c[0] >= MIN && c[0] <= MAX && c[1] >= MIN && c[1] <= MAX) set.set(c.join(','), c);
  }
  return [...set.values()];
}

function makeRound(round) {
  const size = SIZES[Math.min(round, TOTAL_ROUNDS) - 1];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const order = makeOrder(round);
    const sector = makeSector(size);
    const target = rotate(sector, order.ccw, order.center);
    if (inside(target) && keyOf(target) !== keyOf(sector)) return { order, sector, target };
  }
  const order = { mag: 180, dir: null, center: [0, 0], ccw: 180, origin: true, label: 'Rotación de 180° respecto al origen (0, 0)' };
  const sector = [[1, 1], [2, 1], [1, 2], [2, 2]];
  return { order, sector, target: rotate(sector, 180, [0, 0]) };
}

const award = (room, g, keyFn) => room.awardSession && room.awardSession([...g.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, key: keyFn(p) })));
const aliveList = (g) => [...g.players.values()].filter((p) => p.alive);

function publicState(g) {
  if (!g) return null;
  const reveal = g.phase === 'reveal' || g.phase === 'end';
  return {
    type: 'orbit', phase: g.phase, round: g.round, rounds: TOTAL_ROUNDS, bounds: { min: MIN, max: MAX },
    order: g.order, sector: g.sector, target: reveal ? g.target : null, void: reveal ? g.void : false,
    endsAt: g.endsAt, durationMs: g.durationMs, now: Date.now(),
    players: [...g.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, alive: p.alive, moved: p.moved, score: p.score, outRound: p.outRound,
      x: reveal ? p.x : null, y: reveal ? p.y : null, safe: reveal ? p.safe : null
    }))
  };
}
const emit = (room, io) => io.to(room.code).emit('game:state', publicState(room.game));
function stop(room) {
  if (room.game) { clearTimeout(room.game.timer); clearTimeout(room.game.pending); }
  room.game = null;
}
function privateState(room, playerId) {
  const p = room.game && room.game.players.get(playerId);
  return p ? { x: p.x, y: p.y } : null;
}
function tellPositions(room, io) {
  const g = room.game; if (!g) return;
  for (const p of g.players.values()) {
    const sock = room.players.get(p.id) && room.players.get(p.id).socketId;
    if (sock) io.to(sock).emit('game:self', { x: p.x, y: p.y });
  }
}

function start(room, io) {
  stop(room);
  const players = new Map();
  for (const p of room.players.values()) {
    players.set(p.id, {
      id: p.id, name: p.name, color: p.color, alive: true, outRound: 0, score: 0,
      x: MIN + rnd(MAX - MIN + 1), y: MIN + rnd(MAX - MIN + 1), moved: false, lastMoveAt: 0, safe: null
    });
  }
  room.game = {
    type: 'orbit', phase: 'intro', round: 0, players, order: null, sector: [], target: [], void: false,
    endsAt: Date.now() + INTRO_MS, durationMs: INTRO_MS, timer: null, pending: null
  };
  emit(room, io);
  tellPositions(room, io);
  room.game.timer = setTimeout(() => nextRound(room, io), INTRO_MS);
}

function nextRound(room, io) {
  const g = room.game; if (!g) return;
  g.round += 1;
  Object.assign(g, makeRound(g.round));
  g.void = false;
  g.players.forEach((p) => { p.moved = false; p.safe = null; });
  g.phase = 'play';
  g.durationMs = playMs(g.round);
  g.endsAt = Date.now() + g.durationMs;
  emit(room, io);
  tellPositions(room, io);
  g.timer = setTimeout(() => reveal(room, io), g.durationMs + 600);
}

function reveal(room, io) {
  const g = room.game; if (!g || g.phase !== 'play') return;
  clearTimeout(g.timer); clearTimeout(g.pending);
  const safeCells = new Set(g.target.map((c) => c.join(',')));
  const before = aliveList(g);
  for (const p of before) p.safe = safeCells.has(`${p.x},${p.y}`);
  g.void = before.length > 0 && before.every((p) => !p.safe); // si nadie se salva, la ronda no cuenta
  for (const p of before) {
    if (g.void) continue;
    if (p.safe) {
      const fraction = p.moved ? Math.max(0, (g.endsAt - p.lastMoveAt) / g.durationMs) : 0;
      p.score += 100 + Math.round(100 * fraction);
    } else { p.alive = false; p.outRound = g.round; }
  }
  g.phase = 'reveal';
  g.durationMs = REVEAL_MS;
  g.endsAt = Date.now() + REVEAL_MS;
  emit(room, io);
  g.timer = setTimeout(() => afterReveal(room, io), REVEAL_MS);
}

function afterReveal(room, io) {
  const g = room.game; if (!g) return;
  const left = aliveList(g).length;
  const limit = g.players.size > 1 ? 1 : 0;
  if (g.round >= TOTAL_ROUNDS || left <= limit) {
    g.phase = 'end';
    g.endsAt = Date.now();
    emit(room, io);
    award(room, g, (p) => (p.alive ? 1e9 : 0) + p.outRound * 1e5 + p.score);
  } else nextRound(room, io);
}

// Cuántos ya se movieron se avisa cada tanto, para no saturar la red cuando todos tocan a la vez.
function touch(room, io) {
  const g = room.game; if (!g || g.pending) return;
  g.pending = setTimeout(() => { g.pending = null; if (room.game === g && g.phase === 'play') emit(room, io); }, 400);
}

function move(room, io, playerId, data) {
  const g = room.game;
  if (!g || g.phase !== 'play' || Date.now() > g.endsAt + 400) return;
  const p = g.players.get(playerId);
  if (!p || !p.alive) return;
  const x = Number(data && data.x), y = Number(data && data.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < MIN || x > MAX || y < MIN || y > MAX) return;
  p.x = x; p.y = y; p.moved = true; p.lastMoveAt = Date.now();
  const sock = room.players.get(p.id) && room.players.get(p.id).socketId;
  if (sock) io.to(sock).emit('game:self', { x, y });
  touch(room, io);
}

function action(room, io, playerId, type, data) {
  if (type === 'move') move(room, io, playerId, data);
}

module.exports = { start, stop, publicState, privateState, action, _rotate: rotate };
