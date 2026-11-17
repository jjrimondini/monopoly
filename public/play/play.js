const { money, esc, diceFace, rentInfo } = window.PE;
const socket = io();
const $ = id => document.getElementById(id);
const KEY = 'pixelEmpireKey';
const DIFF = { easy: 'Facile', normal: 'Normale', hard: 'Difficile' };

let SQ = [], GR = {}, TOKENS = [];
let state = null;
let myId = null;
let pickedToken = null;
let lastCardId = null, wasMyTurn = false, seenTrades = new Set();
let activeTab = 'props';

const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ignora */ } },
};

// ---------- helpers ----------
const me = () => state?.players.find(p => p.id === myId);
const pName = id => (id ? state.players.find(p => p.id === id)?.name ?? '?' : 'la banca');
const members = g => SQ.filter(s => s.group === g).map(s => s.index);
const ownsGroup = (id, g) => members(g).every(i => state.props[i].ownerId === id);
const groupColor = sq => (sq.type === 'street' ? GR[sq.group].color : sq.type === 'console' ? '#9a96b8' : '#5a5675');

let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast');
  t.className = `toast ${kind}`;
  t.innerHTML = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), kind === 'err' ? 3000 : 5000);
}
const send = a => socket.emit('action', a);

function currentRent(i) {
  const sq = SQ[i], p = state.props[i];
  if (p.mortgaged) return 'ipotecata';
  if (sq.type === 'street') return money(p.houses ? sq.rent[p.houses] : sq.rent[0] * (ownsGroup(p.ownerId, sq.group) ? 2 : 1));
  if (sq.type === 'console') {
    const n = SQ.filter(s => s.type === 'console' && state.props[s.index].ownerId === p.ownerId).length;
    return money(25 * 2 ** (n - 1));
  }
  const both = SQ.filter(s => s.type === 'utility').every(s => state.props[s.index].ownerId === p.ownerId);
  return `${both ? 10 : 4}× dadi`;
}

// ---------- schermata di ingresso ----------
function renderJoin() {
  $('joinScreen').classList.remove('hidden');
  $('gameScreen').classList.add('hidden');
  const used = new Set(state.players.map(p => p.token));
  if (!pickedToken || used.has(pickedToken)) pickedToken = TOKENS.find(t => !used.has(t));
  $('tokenPicker').innerHTML = TOKENS.map(t =>
    `<button data-token="${t}" class="${t === pickedToken ? 'sel' : ''}" ${used.has(t) ? 'disabled' : ''}>${t}</button>`).join('');
  const open = state.phase === 'lobby' && state.players.length < state.maxPlayers;
  $('joinBtn').disabled = !open;
  $('joinNote').textContent = state.phase !== 'lobby'
    ? 'La partita è già in corso. Aspetta la prossima!'
    : !open ? 'Partita piena.' : `${state.players.length}/${state.maxPlayers} giocatori in lobby`;
}

$('tokenPicker').addEventListener('click', e => {
  const b = e.target.closest('button[data-token]');
  if (!b) return;
  pickedToken = b.dataset.token;
  renderJoin();
});
$('joinBtn').onclick = () => {
  const name = $('nameInput').value.trim();
  if (!name) return toast('Inserisci un nome', 'err');
  socket.emit('join', { name, token: pickedToken });
};
try { $('nameInput').value = localStorage.getItem('pixelEmpireName') || ''; } catch { /* ignora */ }
$('nameInput').addEventListener('change', e => { try { localStorage.setItem('pixelEmpireName', e.target.value); } catch { /* ignora */ } });

// ---------- partita ----------
function renderHeader() {
  const p = me();
  document.documentElement.style.setProperty('--me', p.color);
  const owned = Object.values(state.props).filter(x => x.ownerId === p.id).length;
  $('header').innerHTML = `<div class="tk">${p.token}</div>
    <div><div class="nm">${esc(p.name)}</div><div class="sub">${owned} proprietà${p.jailCards ? ` · 🎟 CONTINUA ×${p.jailCards}` : ''}${p.inJail ? ' · 💀 in Game Over' : ''}</div></div>
    <div class="cash">${money(p.cash)}</div>`;
}

function propCardHtml(i) {
  const sq = SQ[i];
  const rows = sq.type === 'street'
    ? sq.rent.map((r, k) => `<span>${['Base', '1 livello', '2 livelli', '3 livelli', '4 livelli', 'Boss Level'][k]}</span><span>${money(r)}</span>`).join('')
    : `<span>${rentInfo(sq, GR)}</span><span></span>`;
  return `<div class="card prop-card" style="--gc:${groupColor(sq)}">
    <div class="t">${esc(sq.name)}</div>
    <div class="g">${sq.type === 'street' ? esc(GR[sq.group].name) : sq.type === 'console' ? 'Console' : 'Infrastruttura'}</div>
    <div class="price">${money(sq.price)}</div>
    <div class="rent-table">${rows}</div>
  </div>`;
}

function renderActions() {
  const p = me();
  const t = state.turn;
  const myTurn = state.phase === 'playing' && t?.playerId === myId;
  const status = $('status');
  const parts = [];

  if (state.phase === 'lobby') {
    status.className = 'status';
    status.textContent = `In lobby: ${state.players.length} giocatori`;
    const host = state.players.find(x => !x.isBot)?.id === myId;
    const bots = state.players.filter(x => x.isBot);
    if (bots.length) parts.push(`<div class="note">In partita anche: ${bots.map(b => `${b.token} ${esc(b.name)} (🤖 ${DIFF[b.difficulty]})`).join(', ')}</div>`);
    if (host) parts.push(`<button class="btn primary big" data-act="start" ${state.players.length < state.minPlayers ? 'disabled' : ''}>▶ AVVIA PARTITA</button>`);
    if (host && state.players.length < state.minPlayers) parts.push('<div class="note">Serve almeno un altro giocatore: aggiungi un bot dal tabellone sul PC.</div>');
    else parts.push('<div class="empty">Aspetta che la partita venga avviata dal tabellone o dal primo giocatore…</div>');
    const s = state.settings;
    parts.push(`<div class="card"><b>⚙ Impostazioni</b><div class="note" style="text-align:left;margin-top:6px">
      Regole <b>${s.rules === 'classic' ? 'classiche' : 'semplificate'}</b> · ${money(s.startCash)} iniziali · aste da ${s.auctionSeconds} s<br>
      Si cambiano dal tabellone sul PC.</div></div>`);
    parts.push('<button class="btn danger" data-act="leave">Esci dalla lobby</button>');
    $('actions').innerHTML = parts.join('');
    return;
  }

  if (state.phase === 'ended') {
    const w = state.players.find(x => x.id === state.winnerId);
    status.textContent = '';
    $('actions').innerHTML = `<div class="winner"><div class="crown">${w?.id === myId ? '🏆' : '🎮'}</div>
      <h2>${w?.id === myId ? 'HAI VINTO!' : `Ha vinto ${esc(w?.name ?? '')}`}</h2><p class="note">Nuova partita dal tabellone.</p></div>`;
    return;
  }

  if (p.bankrupt) {
    status.className = 'status';
    status.textContent = 'Sei in bancarotta: guarda la partita sul tabellone.';
    $('actions').innerHTML = '';
    return;
  }

  // stato
  const cur = state.players.find(x => x.id === t.playerId);
  status.className = myTurn ? 'status mine' : 'status';
  status.textContent = myTurn ? '★ È IL TUO TURNO ★' : `Turno di ${cur.token} ${cur.name}`;

  if (state.dice) parts.push(`<div class="mini-dice">${state.dice.values.map(diceFace).join('')}</div>`);

  // debiti
  const debt = state.debts.find(d => d.playerId === myId);
  if (debt) {
    const missing = debt.amount - p.cash;
    parts.push(`<div class="banner debt">💸 Devi <b>${money(debt.amount)}</b> a ${esc(pName(debt.creditorId))}${debt.reason ? ` (${esc(debt.reason)})` : ''}.
      ${missing > 0 ? `<br>Ti mancano <b>${money(missing)}</b>: vendi livelli o ipoteca proprietà qui sotto, oppure proponi uno scambio.` : ''}
      <div class="row"><button class="btn primary" data-act="payDebt" ${missing > 0 ? 'disabled' : ''}>Paga</button>
      <button class="btn danger" data-act="bankrupt" data-confirm="Sicuro? Uscirai dalla partita.">Bancarotta</button></div></div>`);
  } else if (state.debts.length) {
    parts.push(`<div class="banner">⏳ ${esc(pName(state.debts[0].playerId))} sta raccogliendo i soldi per pagare…</div>`);
  }

  // asta
  const a = state.auction;
  if (a) {
    const lot = a.kind === 'building'
      ? (a.building === 'hotel' ? '🟥 1 Boss Level' : '🟩 1 Livello')
      : esc(SQ[a.propertyIdx].name);
    const inIt = a.participants.includes(myId);
    const passed = a.passed.includes(myId);
    const leading = a.highBidderId === myId;
    const btns = [1, 10, 50, 100].map(n => {
      const v = a.highBid + n;
      return `<button class="btn pink small" data-act="bid" data-amount="${v}" ${v > p.cash || passed ? 'disabled' : ''}>+${n}<br>${v}</button>`;
    }).join('');
    const controls = !inIt ? '<div class="note">Non partecipi: solo chi può costruire su quel tipo di casella.</div>'
      : passed ? '<div class="note">Hai passato.</div>'
      : `<div class="bid-grid">${btns}</div><div class="row"><button class="btn" data-act="pass" ${leading ? 'disabled' : ''}>Passo</button></div>`;
    parts.push(`<div class="banner auction">🔨 ${a.fromBank ? 'ASTA DELLA BANCA' : 'ASTA'}: <b>${lot}</b>
      ${a.kind === 'building' ? '<div class="note">Costruzioni quasi esaurite: chi vince paga l\'offerta al posto del prezzo normale e piazza la costruzione entro fine turno.</div>' : ''}
      <div class="big-num">${a.highBidderId ? money(a.highBid) : a.minBid > 1 ? `base ${money(a.minBid)}` : '—'}</div>
      <div>${leading ? '👑 Sei in testa!' : a.highBidderId ? `In testa: ${esc(pName(a.highBidderId))}` : 'Nessuna offerta'}</div>
      ${controls}
    </div>`);
    if (a.kind !== 'building') parts.push(propCardHtml(a.propertyIdx));
  }

  if (p.buildTokens.house || p.buildTokens.hotel) {
    parts.push(`<div class="banner">🏗 Hai ${p.buildTokens.hotel ? 'un Boss Level' : 'un livello'} vinto all'asta: piazzalo dalla scheda <b>Proprietà</b> (pulsante "Piazza") prima della fine del turno.</div>`);
  }

  if (myTurn && !debt && !a) {
    if (t.phase === 'preRoll') {
      if (p.inJail) {
        parts.push(`<div class="banner">💀 Sei nella Game Over Zone (tentativo ${p.jailTurns + 1}/3). Tira un doppio, paga ${money(50)} o usa una carta.</div>`);
        parts.push('<button class="btn primary big" data-act="roll">🎲 TIRA PER UN DOPPIO</button>');
        parts.push(`<div class="row"><button class="btn" data-act="payJail" ${p.cash < 50 ? 'disabled' : ''}>Paga ${money(50)}</button>
          <button class="btn" data-act="useJailCard" ${p.jailCards ? '' : 'disabled'}>🎟 Usa CONTINUA</button></div>`);
      } else {
        parts.push(`<button class="btn primary big" data-act="roll" ${state.debts.length ? 'disabled' : ''}>🎲 ${t.doubles ? 'DOPPIO! TIRA ANCORA' : 'TIRA I DADI'}</button>`);
      }
    } else if (t.phase === 'awaitBuy') {
      const sq = SQ[t.pendingBuy];
      parts.push(propCardHtml(t.pendingBuy));
      parts.push(`<div class="row"><button class="btn primary" data-act="buy" ${p.cash < sq.price ? 'disabled' : ''}>Compra ${money(sq.price)}</button>
        <button class="btn pink" data-act="decline">Asta 🔨</button></div>`);
      if (p.cash < sq.price) parts.push('<div class="note">Non hai abbastanza ₵: puoi ipotecare qualcosa o mandarla all\'asta.</div>');
    } else if (t.phase === 'postRoll') {
      parts.push(`<button class="btn primary big" data-act="endTurn" ${state.debts.length ? 'disabled' : ''}>FINE TURNO ▶</button>`);
    }
  }

  $('actions').innerHTML = parts.join('');
}

function renderProps() {
  const p = me();
  const owned = Object.keys(state.props).map(Number).filter(i => state.props[i].ownerId === myId);
  if (!owned.length) { $('tab-props').innerHTML = '<div class="empty">Non possiedi ancora nulla.</div>'; return; }
  const playing = state.phase === 'playing' && !p.bankrupt;
  $('tab-props').innerHTML = owned.map(i => {
    const sq = SQ[i], pr = state.props[i];
    let btns = '';
    if (playing) {
      if (sq.type === 'street') {
        const ms = members(sq.group);
        const hs = ms.map(k => state.props[k].houses);
        const cost = GR[sq.group].houseCost;
        const token = p.buildTokens[pr.houses === 4 ? 'hotel' : 'house'] > 0;
        const legal = ownsGroup(myId, sq.group) && !ms.some(k => state.props[k].mortgaged) && pr.houses < 5 && pr.houses === Math.min(...hs);
        const canBuild = legal && !state.auction && (token || p.cash >= cost);
        const canSell = pr.houses > 0 && pr.houses === Math.max(...hs);
        btns += token && legal
          ? `<button class="btn small primary" data-act="build" data-idx="${i}" ${canBuild ? '' : 'disabled'}>🏗 Piazza ${pr.houses === 4 ? 'Boss' : 'Livello'}</button>`
          : `<button class="btn small" data-act="build" data-idx="${i}" ${canBuild ? '' : 'disabled'}>＋ ${pr.houses === 4 ? 'Boss' : 'Livello'} (${cost})</button>`;
        btns += `<button class="btn small" data-act="sell" data-idx="${i}" ${canSell ? '' : 'disabled'}>－ Vendi (${cost / 2})</button>`;
      }
      const groupBuilt = sq.type === 'street' && members(sq.group).some(k => state.props[k].houses > 0);
      if (pr.mortgaged) {
        const c = pr.interestPaid ? sq.price / 2 : Math.round(sq.price / 2 * 1.1);
        btns += `<button class="btn small" data-act="unmortgage" data-idx="${i}" ${p.cash >= c ? '' : 'disabled'}>Riscatta (${c})${pr.interestPaid ? ' ⏱' : ''}</button>`;
      } else {
        btns += `<button class="btn small" data-act="mortgage" data-idx="${i}" ${groupBuilt ? 'disabled' : ''}>Ipoteca (+${sq.price / 2})</button>`;
      }
    }
    const houses = pr.houses === 5 ? '🟥 Boss Level' : pr.houses ? '🟩'.repeat(pr.houses) : '';
    return `<div class="own ${pr.mortgaged ? 'mort' : ''}" style="--gc:${groupColor(sq)}">
      <div class="top"><div><div class="t">${esc(sq.name)}</div>
        <div class="meta">${pr.mortgaged ? 'IPOTECATA' : `Affitto: ${currentRent(i)}`}${sq.type === 'street' && ownsGroup(myId, sq.group) ? ' · gruppo completo ✔' : ''}</div></div>
        <div class="houses">${houses}</div></div>
      ${btns ? `<div class="btns">${btns}</div>` : ''}
    </div>`;
  }).join('');
}

function sideHtml(side) {
  const items = side.props.map(i => `<div style="color:${groupColor(SQ[i])}">■ <span style="color:var(--text)">${esc(SQ[i].name)}</span></div>`);
  if (side.cash) items.push(`<div>💰 ${money(side.cash)}</div>`);
  if (side.jailCards) items.push(`<div>🎟 CONTINUA ×${side.jailCards}</div>`);
  return items.join('') || '<div class="note">niente</div>';
}

function renderTrades() {
  const playing = state.phase === 'playing' && !me().bankrupt;
  const mine = state.trades.filter(t => t.fromId === myId || t.toId === myId);
  const html = [];
  if (playing) html.push('<button class="btn primary" data-act="openTrade">＋ Nuovo scambio</button>');
  for (const t of mine) {
    const incoming = t.toId === myId;
    const other = pName(incoming ? t.fromId : t.toId);
    html.push(`<div class="trade"><h4>${incoming ? `📩 Da ${esc(other)}` : `📤 A ${esc(other)}`}</h4>
      <div class="cols">
        <div><b>${incoming ? 'Ricevi' : 'Dai'}</b>${sideHtml(t.offer)}</div>
        <div><b>${incoming ? 'Dai' : 'Ricevi'}</b>${sideHtml(t.request)}</div>
      </div>
      <div class="row">${incoming
        ? `<button class="btn" data-act="respondTrade" data-trade="${t.id}" data-accept="0">Rifiuta</button><button class="btn primary" data-act="respondTrade" data-trade="${t.id}" data-accept="1">Accetta</button>`
        : `<button class="btn danger" data-act="cancelTrade" data-trade="${t.id}">Ritira proposta</button>`}</div>
    </div>`);
  }
  if (!mine.length) html.push('<div class="empty">Nessuno scambio in corso.</div>');
  $('tab-trades').innerHTML = html.join('');
  const pending = mine.filter(t => t.toId === myId);
  $('tradeBadge').classList.toggle('hidden', !pending.length);
  for (const t of pending) {
    if (!seenTrades.has(t.id)) { seenTrades.add(t.id); toast(`🤝 ${esc(pName(t.fromId))} ti propone uno scambio! Apri la scheda Scambi.`); navigator.vibrate?.(150); }
  }
}

function renderPlayers() {
  $('tab-players').innerHTML = state.players.map(p => {
    const owned = Object.keys(state.props).filter(i => state.props[i].ownerId === p.id);
    return `<div class="plrow ${p.bankrupt ? 'out' : ''}" style="--c:${p.color}">
      <div class="tk">${p.token}</div>
      <div class="nm">${esc(p.name)}${p.id === myId ? ' (tu)' : ''}${p.isBot ? ` <span class="bot-tag">🤖 ${DIFF[p.difficulty]}</span>` : ''}<div class="sub">${owned.map(i => esc(SQ[i].name)).join(', ') || 'nessuna proprietà'}</div></div>
      <div class="cash">${p.bankrupt ? '☠️' : money(p.cash)}</div>
    </div>`;
  }).join('');
}

function render() {
  if (!state || !SQ.length) return;
  if (!myId || !me()) { renderJoin(); return; }
  $('joinScreen').classList.add('hidden');
  $('gameScreen').classList.remove('hidden');
  renderHeader();
  renderActions();
  renderProps();
  renderTrades();
  renderPlayers();

  const myTurn = state.phase === 'playing' && state.turn?.playerId === myId;
  if (myTurn && !wasMyTurn) navigator.vibrate?.([80, 60, 80]);
  wasMyTurn = myTurn;

  const c = state.lastCard;
  if (c && c.id !== lastCardId) {
    if (lastCardId !== null && c.playerId === myId) toast(`<b>${c.deck === 'glitch' ? '⚡ GLITCH' : '⭐ POWER-UP'}</b><br>${esc(c.text)}`, c.deck);
    lastCardId = c.id;
  }
}

// ---------- click ----------
document.body.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
  if (act === 'openTrade') return openTradeModal();
  const a = { type: act };
  if (b.dataset.idx) a.idx = Number(b.dataset.idx);
  if (b.dataset.amount) a.amount = Number(b.dataset.amount);
  if (b.dataset.trade) a.tradeId = b.dataset.trade;
  if (b.dataset.accept) a.accept = b.dataset.accept === '1';
  send(a);
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
    document.querySelectorAll('.tabpane').forEach(x => x.classList.toggle('hidden', x.id !== `tab-${activeTab}`));
  };
});

// ---------- scambi ----------
function pickList(playerId) {
  const p = state.players.find(x => x.id === playerId);
  const props = Object.keys(state.props).map(Number).filter(i => state.props[i].ownerId === playerId);
  const items = props.map(i => {
    const sq = SQ[i];
    const blocked = sq.type === 'street' && members(sq.group).some(k => state.props[k].houses > 0);
    return `<label class="pick" style="--gc:${groupColor(sq)}"><input type="checkbox" value="${i}" ${blocked ? 'disabled' : ''}>${esc(sq.name)}${state.props[i].mortgaged ? ' (ip.)' : ''}${blocked ? ' 🏗' : ''}</label>`;
  });
  if (p.jailCards) items.push(`<label class="pick" style="--gc:#fff"><input type="checkbox" data-jail="1">🎟 Carta CONTINUA</label>`);
  return items.join('') || '<div class="note">niente</div>';
}

function openTradeModal() {
  const others = state.players.filter(p => p.id !== myId && !p.bankrupt);
  if (!others.length) return;
  $('tradeWith').innerHTML = others.map(p => `<option value="${p.id}">${p.token} ${esc(p.name)}${p.isBot ? ` (🤖 ${DIFF[p.difficulty]})` : ''}</option>`).join('');
  $('tradeGive').innerHTML = pickList(myId);
  $('tradeGet').innerHTML = pickList(others[0].id);
  $('tradeGiveCash').value = 0;
  $('tradeGetCash').value = 0;
  $('tradeNote').textContent = state.settings.rules === 'classic'
    ? 'Regole classiche: chi riceve una proprietà ipotecata paga subito il 10% di interessi alla banca; se la riscatta entro questo turno paga solo il capitale (⏱).'
    : '';
  $('tradeModal').classList.remove('hidden');
}
$('tradeWith').onchange = e => { $('tradeGet').innerHTML = pickList(e.target.value); };
$('tradeCancel').onclick = () => $('tradeModal').classList.add('hidden');
$('tradeModal').addEventListener('click', e => { if (e.target.id === 'tradeModal') $('tradeModal').classList.add('hidden'); });
$('tradeSend').onclick = () => {
  const side = (listId, cashId) => ({
    props: [...$(listId).querySelectorAll('input[value]:checked')].map(x => Number(x.value)),
    jailCards: $(listId).querySelector('input[data-jail]:checked') ? 1 : 0,
    cash: Number($(cashId).value) || 0,
  });
  send({ type: 'proposeTrade', toId: $('tradeWith').value, offer: side('tradeGive', 'tradeGiveCash'), request: side('tradeGet', 'tradeGetCash') });
  $('tradeModal').classList.add('hidden');
};

// ---------- socket ----------
socket.on('connect', () => socket.emit('hello', { key: store.get() }));
socket.on('boardData', d => { SQ = d.squares; GR = d.groups; TOKENS = d.tokens; render(); });
socket.on('state', s => { state = s; render(); });
socket.on('joined', ({ playerId, key }) => { myId = playerId; store.set(key); render(); });
socket.on('needJoin', () => { myId = null; store.set(null); seenTrades = new Set(); render(); });
socket.on('errorMsg', m => toast(`⚠️ ${esc(m)}`, 'err'));
socket.on('disconnect', () => toast('Connessione persa, riconnessione…', 'err'));
