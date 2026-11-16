const { money, esc, diceFace, typeIcon } = window.PE;
const socket = io();
const $ = id => document.getElementById(id);

let SQ = [], GR = {};
let state = null;
let cells = [];
const shownPos = {};      // posizione visualizzata di ogni pedina (per animare i passi)
let lastCardId = null, lastRollId = null, cardTimer = null;
let auctionEndsAt = 0, auctionTotal = 1;

// ---------- costruzione tabellone ----------
function gridPos(i) {
  if (i === 0) return [11, 11];
  if (i < 10) return [11, 11 - i];
  if (i === 10) return [11, 1];
  if (i < 20) return [21 - i, 1];
  if (i === 20) return [1, 1];
  if (i < 30) return [1, i - 19];
  if (i === 30) return [1, 11];
  return [i - 29, 11];
}
const side = i => (i < 10 ? 'bottom' : i < 20 ? 'left' : i < 30 ? 'top' : 'right');

function buildBoard() {
  const board = $('board');
  cells = SQ.map((sq, i) => {
    const el = document.createElement('div');
    const [r, c] = gridPos(i);
    el.style.gridRow = r; el.style.gridColumn = c;
    const corner = i % 10 === 0;
    el.className = `cell ${corner ? 'corner' : side(i)} ${sq.type}`;
    if (corner) {
      const sub = { go: `Incassa ${money(200)}`, jail: 'Solo in visita', parking: 'Nessun effetto', gotojail: 'Vai in Game Over' }[sq.type];
      el.innerHTML = `<div class="ic">${typeIcon[sq.type]}</div><div>${esc(sq.name)}</div><div style="font-size:.75em;opacity:.7">${sub}</div>`;
    } else {
      const band = sq.type === 'street' ? `<div class="band" style="background:${GR[sq.group].color}"></div>` : '';
      const icon = sq.type !== 'street' ? `<div class="ic">${typeIcon[sq.type]}</div>` : '';
      const price = sq.price ? money(sq.price) : sq.amount ? `Paga ${money(sq.amount)}` : '';
      el.innerHTML = `${band}<div class="body"><div class="txt"><div class="nm">${esc(sq.name)}</div></div>${icon}<div class="pr">${price}</div></div>`;
    }
    const tokens = document.createElement('div');
    tokens.className = 'tokens';
    el.appendChild(tokens);
    board.appendChild(el);
    return el;
  });
}

// ---------- render ----------
function renderProps() {
  for (const [idx, p] of Object.entries(state.props)) {
    const el = cells[idx];
    el.querySelector('.owner')?.remove();
    el.querySelector('.mort')?.remove();
    el.classList.toggle('mortgaged', p.mortgaged);
    const owner = state.players.find(x => x.id === p.ownerId);
    if (owner) {
      const o = document.createElement('div');
      o.className = 'owner';
      o.style.setProperty('--owner', owner.color);
      el.appendChild(o);
    }
    if (p.mortgaged) el.insertAdjacentHTML('beforeend', '<div class="mort">IPOTECA</div>');
    const band = el.querySelector('.band');
    if (band) {
      band.innerHTML = p.houses === 5 ? '<div class="hotel">B</div>' : '<div class="house"></div>'.repeat(p.houses);
    }
  }
}

function renderTokens() {
  cells.forEach(c => { c.querySelector('.tokens').innerHTML = ''; });
  for (const p of state.players) {
    if (p.bankrupt) continue;
    const pos = shownPos[p.id] ?? p.position;
    const t = document.createElement('div');
    t.className = 'token' + (state.turn?.playerId === p.id && state.phase === 'playing' ? ' active' : '');
    t.style.setProperty('--c', p.color);
    t.title = p.name;
    t.innerHTML = `<span>${p.token}</span>`;
    cells[pos].querySelector('.tokens').appendChild(t);
  }
}

// avanza le pedine una casella alla volta verso la posizione reale
setInterval(() => {
  if (!state) return;
  let moved = false;
  for (const p of state.players) {
    const cur = shownPos[p.id];
    if (cur === undefined) { shownPos[p.id] = p.position; moved = true; continue; }
    if (cur === p.position) continue;
    const dist = (p.position - cur + 40) % 40;
    shownPos[p.id] = dist > 12 ? p.position : (cur + 1) % 40; // salti lunghi (prigione, indietro) = teletrasporto
    moved = true;
  }
  if (moved) renderTokens();
}, 170);

function renderPlayers() {
  const turnId = state.turn?.playerId;
  $('players').innerHTML = state.players.map(p => {
    const owned = Object.entries(state.props).filter(([, x]) => x.ownerId === p.id);
    const chips = owned.map(([i]) => {
      const sq = SQ[i];
      const col = sq.type === 'street' ? GR[sq.group].color : sq.type === 'console' ? '#bbb' : '#666';
      return `<span class="chip" style="background:${col}" title="${esc(sq.name)}"></span>`;
    }).join('');
    const debt = state.debts.find(d => d.playerId === p.id);
    const badges = [
      p.inJail && '<span class="badge warn">💀 Game Over Zone</span>',
      p.jailCards && `<span class="badge">CONTINUA ×${p.jailCards}</span>`,
      !p.connected && !p.bankrupt && '<span class="badge warn">offline</span>',
      debt && `<span class="badge warn">deve ${money(debt.amount)}</span>`,
      (p.buildTokens.house || p.buildTokens.hotel) && '<span class="badge">🏗 costruzione da piazzare</span>',
      p.bankrupt && '<span class="badge">bancarotta</span>',
    ].filter(Boolean).join('');
    return `<div class="pl ${p.id === turnId && state.phase === 'playing' ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}" style="--c:${p.color}">
      <div class="tk">${p.token}</div>
      <div><div class="nm">${esc(p.name)}</div><div class="sub">${badges}</div><div class="chips">${chips}</div></div>
      <div class="cash">${money(p.cash)}</div>
    </div>`;
  }).join('');
  $('bank').textContent = `Regole ${state.settings.rules === 'classic' ? 'classiche' : 'semplificate'} · Banca: ${state.housesLeft} livelli, ${state.hotelsLeft} boss level disponibili`;
}

function renderCenter() {
  const cur = state.players.find(p => p.id === state.turn?.playerId);
  const label = { preRoll: 'tira i dadi', awaitBuy: 'decide se comprare', auction: 'asta in corso', postRoll: 'fine turno' };
  let text = cur && state.phase === 'playing' ? `${cur.token} ${esc(cur.name)} · ${label[state.turn.phase] || ''}` : '';
  if (state.debts.length) {
    const d = state.debts[0];
    text = `💸 ${esc(state.players.find(p => p.id === d.playerId)?.name)} deve raccogliere ${money(d.amount)}`;
  }
  $('turnLabel').innerHTML = text;

  if (state.dice) {
    const diceEl = $('dice');
    diceEl.innerHTML = state.dice.values.map(diceFace).join('');
    if (state.dice.id !== lastRollId) {
      if (lastRollId !== null) { diceEl.classList.remove('rolling'); void diceEl.offsetWidth; diceEl.classList.add('rolling'); }
      lastRollId = state.dice.id;
    }
  } else $('dice').innerHTML = '';

  const a = state.auction;
  const box = $('auction');
  if (a) {
    const bidder = state.players.find(p => p.id === a.highBidderId);
    auctionEndsAt = Date.now() + a.remainingMs;
    auctionTotal = Math.max(auctionTotal, a.remainingMs, 1);
    box.classList.remove('hidden');
    let lot;
    if (a.kind === 'building') {
      const who = a.participants.map(id => state.players.find(p => p.id === id)?.token).join(' ');
      lot = `<div class="prop">${a.building === 'hotel' ? '🟥 1 Boss Level' : '🟩 1 Livello'}</div><div>Costruzioni quasi esaurite · partecipano ${who}</div>`;
    } else {
      const sq = SQ[a.propertyIdx];
      lot = `<div class="prop" style="color:${sq.type === 'street' ? GR[sq.group].color : '#fff'}">${esc(sq.name)}</div>`;
    }
    box.innerHTML = `<h3>🔨 ${a.fromBank ? 'ASTA DELLA BANCA' : 'ASTA'}</h3>
      ${lot}
      <div class="bid">${bidder ? money(a.highBid) : a.minBid > 1 ? `base ${money(a.minBid)}` : '—'}</div>
      <div>${bidder ? `${bidder.token} ${esc(bidder.name)}` : 'Nessuna offerta'} · offri dal telefono!</div>
      <div class="timer"><div id="auctionBar"></div></div>`;
  } else {
    box.classList.add('hidden');
    auctionTotal = 1;
  }
}

setInterval(() => {
  const bar = $('auctionBar');
  if (bar) bar.style.width = `${Math.max(0, (auctionEndsAt - Date.now()) / auctionTotal) * 100}%`;
}, 250);

function renderCard() {
  const c = state.lastCard;
  if (!c || c.id === lastCardId) return;
  const first = lastCardId === null;
  lastCardId = c.id;
  if (first) return;
  const who = state.players.find(p => p.id === c.playerId);
  const pop = $('cardPopup');
  pop.className = `card-popup ${c.deck}`;
  pop.innerHTML = `<h2>${c.deck === 'glitch' ? '⚡ GLITCH' : '⭐ POWER-UP'}</h2><p>${esc(c.text)}</p><div class="who">${who ? `${who.token} ${esc(who.name)}` : ''}</div>`;
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => pop.classList.add('hidden'), 4500);
}

function renderLog() {
  const log = $('log');
  log.innerHTML = state.log.map(l => `<div>${esc(l.text)}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}

function renderLobby() {
  const lobby = state.phase === 'lobby';
  $('lobby').classList.toggle('hidden', !lobby);
  $('joinBox').classList.toggle('hidden', lobby);
  if (!lobby) return;
  $('lobbyPlayers').innerHTML = state.players.length
    ? state.players.map(p => `<div class="lp" style="--c:${p.color}">${p.token} ${esc(p.name)}</div>`).join('')
    : `<div class="empty">In attesa dei giocatori (${state.minPlayers}–${state.maxPlayers})…</div>`;
  $('startBtn').disabled = state.players.length < state.minPlayers;
  document.querySelectorAll('.seg').forEach(seg => {
    const cur = String(state.settings[seg.dataset.key]);
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.val === cur));
  });
  $('rulesInfo').innerHTML = RULES_INFO[state.settings.rules];
}

const RULES_INFO = {
  classic: 'Regole ufficiali complete: in bancarotta verso la banca le proprietà vanno all\'asta; chi riceve proprietà ipotecate paga subito il 10% (e se le riscatta entro il turno non lo ripaga); quando i livelli scarseggiano vanno all\'asta tra chi può costruire; un Boss Level venduto senza abbastanza livelli in banca si scompone in quelli disponibili; la carta "utility più vicina" fa ritirare i dadi.',
  simple: 'Più veloci: in bancarotta verso la banca le proprietà tornano libere, le ipoteche passano di mano senza interessi, i livelli si costruiscono finché ce ne sono, un Boss Level venduto senza livelli in banca viene smontato del tutto, la carta "utility più vicina" usa il tiro appena fatto.',
};

document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = seg.dataset.key === 'rules' ? b.dataset.val : Number(b.dataset.val);
    socket.emit('boardAction', { type: 'settings', settings: { [seg.dataset.key]: v } });
  });
});

function renderWinner() {
  const w = state.players.find(p => p.id === state.winnerId);
  const el = $('winner');
  el.classList.toggle('hidden', state.phase !== 'ended');
  if (state.phase === 'ended') {
    el.innerHTML = `<div class="win-card"><div class="crown">🏆</div><h1>${w ? `${w.token} ${esc(w.name)}` : 'Fine'}</h1>
      <p>ha conquistato l'impero dei videogiochi!</p><button class="btn primary" id="againBtn">↺ Nuova partita</button></div>`;
    $('againBtn').onclick = () => socket.emit('boardAction', { type: 'reset' });
  }
}

function render() {
  if (!state || !SQ.length) return;
  renderLobby();
  renderProps();
  renderTokens();
  renderPlayers();
  renderCenter();
  renderCard();
  renderLog();
  renderWinner();
}

// ---------- socket ----------
socket.on('boardData', d => {
  if (!SQ.length) { SQ = d.squares; GR = d.groups; buildBoard(); }
  render();
});
socket.on('state', s => {
  // dopo un reset le posizioni visualizzate ripartono da zero
  if (s.phase === 'lobby') for (const k of Object.keys(shownPos)) delete shownPos[k];
  state = s;
  render();
});
socket.on('errorMsg', m => alert(m));

fetch('/api/info').then(r => r.json()).then(info => {
  $('qr').src = $('qrBig').src = info.qr;
  $('joinUrl').textContent = $('joinUrlBig').textContent = info.joinUrl;
});

$('startBtn').onclick = () => socket.emit('boardAction', { type: 'start' });
$('resetBtn').onclick = () => { if (confirm('Ricominciare da capo? La partita in corso andrà persa.')) socket.emit('boardAction', { type: 'reset' }); };
$('fullscreenBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
