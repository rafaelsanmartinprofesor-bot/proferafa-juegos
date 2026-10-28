'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const bombs = require('./games/bombs');
const tetris = require('./games/tetris');
const memory = require('./games/memory');
const orbit = require('./games/orbit');

// Registro de minijuegos. Para sumar uno nuevo basta crear su archivo en /games y agregarlo aquí.
const games = { bombs, tetris, memory, orbit };

// Ranking acumulado de la sala: cada juego reparte puntos de clase según el lugar final.
const SESSION_POINTS = [10, 7, 5, 4, 3, 2]; // del 7° lugar en adelante se suma 1 por participar
function awardSession(room, entries) {
  const g = room.game;
  if (!g || g.awarded || !Array.isArray(entries) || !entries.length) return;
  g.awarded = true;
  for (const e of entries) {
    const rank = 1 + entries.filter((o) => o.key > e.key).length;
    let t = room.totals.get(e.id);
    if (!t) { t = { id: e.id, name: e.name, color: e.color, points: 0, wins: 0, played: 0 }; room.totals.set(e.id, t); }
    t.name = e.name; t.color = e.color;
    t.points += SESSION_POINTS[rank - 1] || 1;
    t.wins += rank === 1 ? 1 : 0;
    t.played += 1;
  }
  broadcastRoom(room);
}
function sessionList(room) {
  return [...room.totals.values()]
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name, 'es'))
    .map((t) => ({ id: t.id, name: t.name, color: t.color, points: t.points, wins: t.wins, played: t.played }));
}
function stopGame(room) {
  const m = room.game && games[room.game.type];
  if (m) m.stop(room); else room.game = null;
}
function gameState(room) {
  const m = room.game && games[room.game.type];
  return m ? m.publicState(room.game) : null;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 20000
});

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PALETTE = new Set(['#35C9A5', '#FF6B6B', '#FFD166', '#6C7CFF', '#B77BFF', '#FF9F43', '#45B7E8', '#F06CB4', '#A3D977', '#F3F4F6']);
const MAX_PLAYERS = 40;

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

function createCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function safeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    allowJoining: room.allowJoining,
    createdAt: room.createdAt,
    hostConnected: Boolean(room.hostSocketId),
    session: sessionList(room),
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      joinedAt: p.joinedAt
    })).sort((a, b) => a.joinedAt - b.joinedAt)
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', safeRoom(room));
}

function emitError(socket, message) {
  socket.emit('app:error', { message });
}

function findRoom(code) {
  const room = rooms.get(cleanCode(code));
  if (!room) throw new Error('No encontramos esa sala. Revisa el código con tu profesor.');
  if (room.status === 'closed') throw new Error('Esta sala ya terminó. Pide al profesor que cree otra.');
  return room;
}

function isHost(socket, room, token) {
  if (!token || !room.hostToken) return false;
  const candidate = Buffer.from(String(token));
  const expected = Buffer.from(room.hostToken);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function authHost(socket, room, token) {
  if (!isHost(socket, room, token)) throw new Error('No se pudo verificar el acceso del profesor en esta sala.');
  room.hostSocketId = socket.id;
  socket.data.role = 'host';
  socket.data.roomCode = room.code;
  socket.join(room.code);
}

io.on('connection', (socket) => {
  socket.emit('server:ready', { ok: true });

  socket.on('room:create', () => {
    try {
      const code = createCode();
      const hostToken = crypto.randomBytes(32).toString('hex');
      const room = {
        code,
        hostToken,
        hostSocketId: socket.id,
        status: 'lobby',
        allowJoining: true,
        createdAt: Date.now(),
        players: new Map(),
        totals: new Map(),
        closeTimer: null
      };
      room.awardSession = (entries) => awardSession(room, entries);
      rooms.set(code, room);
      socket.data.role = 'host';
      socket.data.roomCode = code;
      socket.join(code);
      socket.emit('room:created', { code, hostToken, room: safeRoom(room) });
      broadcastRoom(room);
    } catch (_error) {
      emitError(socket, 'No se pudo crear la sala. Inténtalo nuevamente.');
    }
  });

  socket.on('host:resume', ({ code, token } = {}) => {
    try {
      const room = findRoom(code);
      authHost(socket, room, token);
      socket.emit('host:authenticated', { room: safeRoom(room), code: room.code });
      if (room.game) socket.emit('game:state', gameState(room));
      broadcastRoom(room);
    } catch (error) {
      emitError(socket, error.message || 'No se pudo recuperar la sala.');
    }
  });

  socket.on('room:join', ({ code, name, color, playerId } = {}) => {
    try {
      const room = findRoom(code);
      if (room.status !== 'lobby') throw new Error('La partida ya comenzó. Espera a la próxima sala.');
      if (!room.allowJoining) throw new Error('El profesor cerró temporalmente el ingreso a la sala.');
      const cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
      if (cleanName.length < 1) throw new Error('Escribe un nombre para entrar.');
      if (!PALETTE.has(String(color || '').toUpperCase())) throw new Error('Elige uno de los colores disponibles.');
      const alreadyExists = Array.from(room.players.values()).some((p) => p.connected && p.name.toLocaleLowerCase('es-CL') === cleanName.toLocaleLowerCase('es-CL') && p.id !== playerId);
      if (alreadyExists) throw new Error('Ese nombre ya está en la sala. Prueba con otro.');

      let player = playerId ? room.players.get(String(playerId)) : null;
      if (player && player.connected && player.socketId !== socket.id) {
        throw new Error('Ese jugador ya está conectado en otro dispositivo.');
      }
      if (!player) {
        if (room.players.size >= MAX_PLAYERS) throw new Error(`La sala alcanzó el máximo de ${MAX_PLAYERS} jugadores.`);
        player = { id: crypto.randomUUID(), socketId: socket.id, name: cleanName, color: String(color).toUpperCase(), connected: true, joinedAt: Date.now() };
        room.players.set(player.id, player);
      } else {
        player.socketId = socket.id;
        player.name = cleanName;
        player.color = String(color).toUpperCase();
        player.connected = true;
      }
      socket.data.role = 'player';
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
      socket.emit('player:joined', { player: { id: player.id, name: player.name, color: player.color }, room: safeRoom(room) });
      broadcastRoom(room);
    } catch (error) {
      emitError(socket, error.message || 'No se pudo entrar a la sala.');
    }
  });

  socket.on('player:resume', ({ code, playerId } = {}) => {
    try {
      const room = findRoom(code);
      const player = room.players.get(String(playerId || ''));
      if (!player) throw new Error('No encontramos tu sesión anterior. Vuelve a entrar con tu nombre.');
      if (player.connected && player.socketId !== socket.id) throw new Error('Este jugador ya está conectado en otro dispositivo.');
      player.socketId = socket.id;
      player.connected = true;
      socket.data.role = 'player';
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
      socket.emit('player:resumed', { player: { id: player.id, name: player.name, color: player.color }, room: safeRoom(room) });
      if (room.game) {
        socket.emit('game:state', gameState(room));
        const m = games[room.game.type];
        const mine = m && m.privateState ? m.privateState(room, player.id) : null;
        if (mine) socket.emit('game:self', mine);
      }
      broadcastRoom(room);
    } catch (error) {
      emitError(socket, error.message || 'No se pudo recuperar tu sesión.');
    }
  });

  socket.on('host:action', ({ code, token, action, game } = {}) => {
    try {
      const room = findRoom(code);
      if (!isHost(socket, room, token)) throw new Error('No tienes permiso para modificar esta sala.');
      if (room.hostSocketId !== socket.id) authHost(socket, room, token);

      if (action === 'toggle-join') {
        if (room.status !== 'lobby') throw new Error('La partida ya comenzó.');
        room.allowJoining = !room.allowJoining;
      } else if (action === 'start') {
        if (room.status !== 'lobby') throw new Error('La partida ya fue iniciada.');
        if (room.players.size === 0) throw new Error('Necesitas al menos un estudiante conectado para comenzar.');
        const chosen = games[game] ? game : 'bombs';
        room.status = 'started';
        room.allowJoining = false;
        room.gameType = chosen;
        games[chosen].start(room, io);
      } else if (action === 'reset-session') {
        room.totals.clear();
      } else if (action === 'switch') {
        if (room.status !== 'started') throw new Error('Primero inicia la partida.');
        const chosen = games[game] ? game : (room.gameType || 'bombs');
        stopGame(room);
        room.gameType = chosen;
        games[chosen].start(room, io);
      } else if (action === 'restart') {
        if (room.status !== 'started') throw new Error('Primero inicia la partida.');
        stopGame(room);
        games[room.gameType || 'bombs'].start(room, io);
      } else if (action === 'reset') {
        stopGame(room);
        io.to(room.code).emit('game:state', null);
        room.status = 'lobby';
        room.allowJoining = true;
      } else if (action === 'end') {
        stopGame(room);
        room.status = 'closed';
        room.allowJoining = false;
        broadcastRoom(room);
        io.to(room.code).emit('room:ended', { message: 'El profesor terminó esta sala.' });
        if (room.closeTimer) clearTimeout(room.closeTimer);
        room.closeTimer = setTimeout(() => rooms.delete(room.code), 8000);
        return;
      } else {
        throw new Error('Acción desconocida.');
      }
      broadcastRoom(room);
    } catch (error) {
      emitError(socket, error.message || 'No se pudo ejecutar esa acción.');
    }
  });

  socket.on('game:submit', ({ code, dx, dy } = {}) => {
    const room = rooms.get(cleanCode(code));
    if (room && socket.data.role === 'player' && socket.data.roomCode === room.code) bombs.submit(room, io, socket.data.playerId, dx, dy);
  });

  socket.on('game:action', ({ code, type, ...data } = {}) => {
    const room = rooms.get(cleanCode(code));
    if (!room || !room.game || socket.data.role !== 'player' || socket.data.roomCode !== room.code) return;
    const m = games[room.game.type];
    if (m && m.action) m.action(room, io, socket.data.playerId, String(type || ''), data);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (socket.data.role === 'host' && room.hostSocketId === socket.id) {
      room.hostSocketId = null;
      broadcastRoom(room);
    }
    if (socket.data.role === 'player' && socket.data.playerId) {
      const player = room.players.get(socket.data.playerId);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        broadcastRoom(room);
        // Los jugadores desconectados se conservan durante un breve periodo para permitir reconexión.
        setTimeout(() => {
          const latestRoom = rooms.get(code);
          const latestPlayer = latestRoom && latestRoom.players.get(socket.data.playerId);
          if (latestRoom && latestPlayer && !latestPlayer.connected) {
            latestRoom.players.delete(socket.data.playerId);
            broadcastRoom(latestRoom);
          }
        }, 90000);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Transforma Party lobby disponible en http://localhost:${PORT}`);
});
