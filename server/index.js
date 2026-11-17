const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game, GameError, TOKENS } = require('./game');
const { BotManager } = require('./bots');
const { SQUARES, GROUPS } = require('./board-data');

const PORT = Number(process.env.PORT) || 3000;

function lanAddress() {
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback/i.test(name)) continue;
      candidates.push({ name, address: a.address });
    }
  }
  const score = a => (a.address.startsWith('192.168.') ? 3 : a.address.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 1 : 0);
  candidates.sort((x, y) => score(y) - score(x));
  return { best: candidates[0]?.address || 'localhost', all: candidates };
}

const lan = lanAddress();
const HOST = process.env.HOST_IP || lan.best;
const joinUrl = `http://${HOST}:${PORT}/play/`;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (_req, res) => res.redirect('/board/'));
app.get('/api/info', async (_req, res) => {
  res.json({ joinUrl, qr: await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 }) });
});

const game = new Game({ onChange: broadcast });
const bots = new BotManager(game, { onChange: broadcast });
const connections = new Map(); // playerId -> numero di socket connessi

function broadcast() {
  for (const p of game.players) p.connected = p.isBot || (connections.get(p.id) || 0) > 0;
  io.emit('state', game.getState());
  bots.kick();
}

function attach(socket, player) {
  socket.data.playerId = player.id;
  connections.set(player.id, (connections.get(player.id) || 0) + 1);
  socket.emit('joined', { playerId: player.id, key: player.key });
}

function guard(socket, fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameError) socket.emit('errorMsg', e.message);
    else { console.error(e); socket.emit('errorMsg', 'Errore interno'); }
  }
  broadcast();
}

io.on('connection', socket => {
  socket.emit('boardData', { squares: SQUARES, groups: GROUPS, tokens: TOKENS });
  socket.emit('state', game.getState());

  // il telefono si ripresenta con la sua chiave salvata
  socket.on('hello', ({ key } = {}) => {
    const p = key && game.byKey(key);
    if (p) { attach(socket, p); broadcast(); } else socket.emit('needJoin');
  });

  socket.on('join', ({ name, token } = {}) => guard(socket, () => {
    if (socket.data.playerId) throw new GameError('Sei già in partita');
    attach(socket, game.join(name, token));
  }));

  socket.on('action', (a = {}) => guard(socket, () => {
    game.act(socket.data.playerId, a);
    if (a.type === 'leave') {
      connections.delete(socket.data.playerId);
      socket.data.playerId = null;
      socket.emit('needJoin');
    }
  }));

  // comandi dal tabellone (PC)
  socket.on('boardAction', (a = {}) => guard(socket, () => {
    if (a.type === 'start') game.start();
    else if (a.type === 'settings') game.setSettings(a.settings);
    else if (a.type === 'addBot') game.addBot(a.difficulty);
    else if (a.type === 'removePlayer') {
      game.leave(a.playerId);
      connections.delete(a.playerId);
      for (const s of io.sockets.sockets.values()) {
        if (s.data.playerId === a.playerId) { s.data.playerId = null; s.emit('needJoin'); }
      }
    }
    else if (a.type === 'reset') {
      game.reset();
      bots.reset();
      connections.clear();
      for (const s of io.sockets.sockets.values()) s.data.playerId = null;
      io.emit('needJoin');
    }
  }));

  socket.on('disconnect', () => {
    const id = socket.data.playerId;
    if (!id) return;
    connections.set(id, Math.max(0, (connections.get(id) || 1) - 1));
    broadcast();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎮  PIXEL EMPIRE è pronto!\n');
  console.log(`   Tabellone (apri sul PC):   http://localhost:${PORT}/board/`);
  console.log(`   Giocatori (dai telefoni):  ${joinUrl}`);
  if (lan.all.length > 1) {
    console.log('\n   Altri indirizzi trovati:', lan.all.map(a => `${a.address} (${a.name})`).join(', '));
    console.log('   Se i telefoni non si collegano, riavvia con:  $env:HOST_IP="x.x.x.x"; npm start');
  }
  console.log('\n   Telefoni e PC devono essere sulla stessa rete Wi-Fi.');
  console.log('   Se Windows chiede il permesso del Firewall, consenti l\'accesso alle reti private.\n');
});
