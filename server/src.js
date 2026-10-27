import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';

const PORT = process.env.PORT || 4000;
const configuredOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',').map(origin => origin.trim()).filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (for example health checks) are allowed.
    if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  }
};
const app = express();
app.disable('x-powered-by');
app.use(cors(corsOptions));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'undercover-server' }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { ...corsOptions, methods: ['GET', 'POST'] } });
const rooms = new Map();
const socketPlayers = new Map();

const WORD_PAIRS = [
  { mainWord: 'Orange', imposterWord: 'Apple', category: 'Food' },
  { mainWord: 'Dog', imposterWord: 'Wolf', category: 'Animals' },
  { mainWord: 'Coffee', imposterWord: 'Tea', category: 'Drinks' },
  { mainWord: 'Beach', imposterWord: 'Desert', category: 'Places' },
  { mainWord: 'Cat', imposterWord: 'Tiger', category: 'Animals' },
  { mainWord: 'Pizza', imposterWord: 'Burger', category: 'Food' },
  { mainWord: 'Rain', imposterWord: 'Snow', category: 'Weather' },
  { mainWord: 'Moon', imposterWord: 'Sun', category: 'Space' },
  { mainWord: 'Car', imposterWord: 'Bus', category: 'Transport' },
  { mainWord: 'Pancake', imposterWord: 'Waffle', category: 'Food' }
];
const normalize = (value) => value.trim().normalize('NFKC').toLocaleLowerCase('en');
const makeCode = () => randomBytes(3).toString('hex').toUpperCase();
const publicPlayer = (p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected });

function publicState(game, viewerId) {
  const gameOver = game.phase === 'GAME_OVER';
  return {
    roomCode: game.roomCode,
    phase: game.phase,
    roundNumber: game.roundNumber,
    hostPlayerId: game.hostPlayerId,
    players: game.players.map(publicPlayer),
    clues: { ...game.clues },
    votesSubmitted: Object.keys(game.votes).length,
    lastRoundSummary: game.lastRoundSummary,
    winner: game.winner,
    result: gameOver ? {
      imposterPlayerId: game.imposterPlayerId,
      mainWord: game.wordPair?.mainWord,
      imposterWord: game.wordPair?.imposterWord,
      winner: game.winner
    } : null,
    isHost: viewerId === game.hostPlayerId
  };
}
function emitState(game) {
  for (const p of game.players) {
    const socketId = p.socketId;
    if (socketId && io.sockets.sockets.has(socketId)) {
      io.to(socketId).emit('game:state', publicState(game, p.id));
    }
  }
}
function sendPrivateWord(game, player) {
  if (!player?.socketId || !game.wordPair || !game.imposterPlayerId) return;
  const word = player.id === game.imposterPlayerId ? game.wordPair.imposterWord : game.wordPair.mainWord;
  io.to(player.socketId).emit('word:private', { word, roundNumber: game.roundNumber });
}
function errorTo(socket, message, code = 'INVALID_ACTION') {
  socket.emit('game:error', { message, code });
}
function ensureNotInRoom(socket) {
  if (socketPlayers.has(socket.id)) {
    throw new Error('You are already in a room. Refresh the page to start a new session.');
  }
}
function findGame(socket) {
  const entry = socketPlayers.get(socket.id);
  if (!entry) throw new Error('Please create or join a room first.');
  const game = rooms.get(entry.roomCode);
  const player = game?.players.find(p => p.id === entry.playerId);
  if (!game || !player) throw new Error('Room or player was not found.');
  return { game, player };
}
function startNextRound(game) {
  if (game.phase === 'GAME_OVER') throw new Error('This game has ended.');
  game.roundNumber += 1;
  game.clues = {};
  game.votes = {};
  game.voteCounts = {};
  game.eliminatedPlayerId = null;
  game.phase = 'CLUE_PHASE';
}
function startGame(game) {
  if (game.phase !== 'LOBBY') throw new Error('The game has already started.');
  const connected = game.players.filter(p => p.connected);
  if (connected.length < 3) throw new Error('At least 3 connected players are required.');
  game.wordPair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
  game.imposterPlayerId = connected[Math.floor(Math.random() * connected.length)].id;
  game.usedClues = new Set();
  game.lastRoundSummary = null;
  game.winner = null;
  startNextRound(game);
  connected.forEach(p => sendPrivateWord(game, p));
}
function validateClue(clue, usedClues) {
  if (typeof clue !== 'string') return { ok: false, code: 'INVALID_CLUE', message: 'Enter a one-word clue.' };
  const trimmed = clue.trim();
  const normalized = normalize(trimmed);
  if (!normalized || normalized.length > 30 || /\s/u.test(normalized) || !/[\p{L}\p{N}]/u.test(normalized)) {
    return { ok: false, code: 'INVALID_CLUE', message: 'Clue must be one word, up to 30 characters.' };
  }
  if (usedClues.has(normalized)) return { ok: false, code: 'CLUE_ALREADY_USED', message: 'That clue was used in an earlier round. Choose another word.' };
  return { ok: true, clue: trimmed, normalized };
}
function resolveRound(game) {
  const counts = {};
  for (const targetId of Object.values(game.votes)) counts[targetId] = (counts[targetId] || 0) + 1;
  const maxVotes = Math.max(0, ...Object.values(counts));
  const leaders = Object.entries(counts).filter(([, n]) => n === maxVotes && n > 0).map(([id]) => id);
  const eliminatedPlayerId = leaders.length === 1 ? leaders[0] : null;
  const imposterFound = eliminatedPlayerId === game.imposterPlayerId;
  const message = imposterFound ? 'The Imposter was found!' : eliminatedPlayerId ? 'The Imposter survived the vote.' : 'The vote was tied. Nobody was eliminated.';
  game.voteCounts = counts;
  game.eliminatedPlayerId = eliminatedPlayerId;
  game.lastRoundSummary = {
    roundNumber: game.roundNumber,
    voteCounts: { ...counts },
    eliminatedPlayerId,
    imposterFound,
    message,
    clues: { ...game.clues }
  };
  if (imposterFound) {
    game.phase = 'GAME_OVER';
    game.winner = 'PLAYERS';
    for (const [voterId, targetId] of Object.entries(game.votes)) {
      if (targetId === game.imposterPlayerId) {
        const voter = game.players.find(p => p.id === voterId);
        if (voter) voter.score += 2;
      }
    }
    return;
  }
  const votedPlayer = game.players.find(p => p.id === eliminatedPlayerId);
  if (votedPlayer) votedPlayer.score = Math.max(0, votedPlayer.score);
  // Save the summary, then reset only round-specific state.
  startNextRound(game);
}

io.on('connection', socket => {
  socket.on('room:create', (payload = {}) => {
    try {
      ensureNotInRoom(socket);
      const name = String(payload.name || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 20);
      if (!name) throw new Error('Please enter your name.');
      let roomCode;
      do { roomCode = makeCode(); } while (rooms.has(roomCode));
      const player = { id: randomUUID(), name, score: 0, connected: true, socketId: socket.id };
      const game = {
        roomCode, phase: 'LOBBY', roundNumber: 0, players: [player], hostPlayerId: player.id,
        imposterPlayerId: null, wordPair: null, clues: {}, votes: {}, usedClues: new Set(),
        voteCounts: {}, eliminatedPlayerId: null, winner: null, lastRoundSummary: null
      };
      rooms.set(roomCode, game);
      socketPlayers.set(socket.id, { roomCode, playerId: player.id });
      socket.data.roomCode = roomCode;
      socket.join(roomCode);
      socket.emit('room:created', { roomCode, playerId: player.id });
      emitState(game);
    } catch (e) { errorTo(socket, e.message); }
  });

  socket.on('room:join', (payload = {}) => {
    try {
      ensureNotInRoom(socket);
      const name = String(payload.name || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 20);
      const roomCode = String(payload.roomCode || '').trim().toUpperCase();
      if (!name || !roomCode) throw new Error('Enter your name and room code.');
      const game = rooms.get(roomCode);
      if (!game) throw new Error('Room not found. Check the room code.');
      if (game.phase !== 'LOBBY') throw new Error('This game has already started.');
      if (game.players.length >= 20) throw new Error('This room is full (maximum 20 players).');
      const player = { id: randomUUID(), name, score: 0, connected: true, socketId: socket.id };
      game.players.push(player);
      socketPlayers.set(socket.id, { roomCode, playerId: player.id });
      socket.data.roomCode = roomCode;
      socket.join(roomCode);
      socket.emit('room:joined', { roomCode, playerId: player.id });
      emitState(game);
    } catch (e) { errorTo(socket, e.message); }
  });

  socket.on('game:start', () => {
    try {
      const { game, player } = findGame(socket);
      if (player.id !== game.hostPlayerId) throw new Error('Only the host can start the game.');
      startGame(game);
      io.to(game.roomCode).emit('game:started', { roundNumber: game.roundNumber });
      emitState(game);
    } catch (e) { errorTo(socket, e.message); }
  });

  socket.on('clue:submit', (payload = {}) => {
    try {
      const { game, player } = findGame(socket);
      if (game.phase !== 'CLUE_PHASE') throw new Error('The clue phase is not active.');
      if (!player.connected) throw new Error('You are disconnected.');
      if (Object.hasOwn(game.clues, player.id)) throw new Error('You already submitted a clue this round.');
      const checked = validateClue(payload.clue, game.usedClues);
      if (!checked.ok) return errorTo(socket, checked.message, checked.code);
      game.clues[player.id] = checked.clue;
      game.usedClues.add(checked.normalized);
      const active = game.players.filter(p => p.connected);
      if (active.every(p => Object.hasOwn(game.clues, p.id))) {
        game.phase = 'VOTING';
        io.to(game.roomCode).emit('voting:started', { roundNumber: game.roundNumber });
      }
      socket.emit('clue:accepted', { roundNumber: game.roundNumber });
      emitState(game);
    } catch (e) { errorTo(socket, e.message); }
  });

  socket.on('vote:submit', (payload = {}) => {
    try {
      const { game, player } = findGame(socket);
      if (game.phase !== 'VOTING') throw new Error('Voting is not active.');
      if (Object.hasOwn(game.votes, player.id)) throw new Error('You have already voted.');
      if (player.id === payload.targetPlayerId) throw new Error('You cannot vote for yourself.');
      const target = game.players.find(p => p.id === payload.targetPlayerId && p.connected);
      if (!target) throw new Error('Choose a valid connected player.');
      game.votes[player.id] = target.id;
      const active = game.players.filter(p => p.connected);
      if (active.every(p => Object.hasOwn(game.votes, p.id))) {
        const previousRound = game.roundNumber;
        resolveRound(game);
        io.to(game.roomCode).emit('round:results', {
          summary: game.lastRoundSummary,
          gameOver: game.phase === 'GAME_OVER',
          nextRound: game.phase === 'GAME_OVER' ? null : game.roundNumber
        });
        if (game.phase === 'GAME_OVER') {
          io.to(game.roomCode).emit('game:over', { winner: game.winner, roundNumber: previousRound });
        } else {
          for (const p of game.players) if (p.connected) sendPrivateWord(game, p);
        }
      }
      emitState(game);
    } catch (e) { errorTo(socket, e.message); }
  });

  socket.on('disconnect', () => {
    const entry = socketPlayers.get(socket.id);
    if (!entry) return;
    const game = rooms.get(entry.roomCode);
    const player = game?.players.find(p => p.id === entry.playerId);
    if (player) {
      player.connected = false;
      player.socketId = null;
      if (game.hostPlayerId === player.id) {
        const nextHost = game.players.find(p => p.connected);
        if (nextHost) game.hostPlayerId = nextHost.id;
      }
      emitState(game);
    }
    socketPlayers.delete(socket.id);
  });
});

httpServer.listen(PORT, () => console.log(`Undercover server running at http://localhost:${PORT}`));
