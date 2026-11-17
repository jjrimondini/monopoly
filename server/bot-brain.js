// Cervello dei bot: legge lo stato del Game e restituisce UNA azione (formato di game.act) oppure null.
// Nessun effetto collaterale sul gioco: la memoria del bot (proposte fatte ecc.) è passata dal BotManager.
const { SQUARES, GROUPS, BUYABLE, groupMembers } = require('./board-data');

const JAIL_FINE = 50;

const PROFILES = {
  easy: {
    reserve: 40, bidFactor: 0.75, groupBonus: 0.4, blockWeight: 0.2, tradeBlock: 0.1, buildReserve: 500,
    acceptMargin: -20, proposeChance: 0.05, tradeCashFactor: 1.2, unmortgageReserve: 700,
    mortgageToComplete: false, smartJail: false, noise: 0.3,
  },
  normal: {
    reserve: 150, bidFactor: 1.0, groupBonus: 0.8, blockWeight: 0.8, tradeBlock: 0.35, buildReserve: 200,
    acceptMargin: 15, proposeChance: 0.35, tradeCashFactor: 1.5, unmortgageReserve: 500,
    mortgageToComplete: true, smartJail: false, noise: 0.12,
  },
  hard: {
    reserve: 200, bidFactor: 1.15, groupBonus: 1.2, blockWeight: 1.4, tradeBlock: 0.6, buildReserve: 150,
    acceptMargin: 40, proposeChance: 0.6, tradeCashFactor: 1.8, unmortgageReserve: 450,
    mortgageToComplete: true, smartJail: true, noise: 0.05,
  },
};

// chiave di "gruppo" anche per console e utility
const groupKey = sq => sq.group || sq.type;
const membersOf = sq => (sq.group ? groupMembers(sq.group) : SQUARES.filter(s => s.type === sq.type).map(s => s.index));
const groupTotal = sq => membersOf(sq).reduce((s, i) => s + SQUARES[i].price, 0);

// valore di un insieme di proprietà per un giocatore (con bonus per i gruppi completi)
function portfolioValue(game, owned, prof) {
  let v = 0;
  const seen = new Set();
  for (const i of owned) {
    const sq = SQUARES[i];
    const prop = game.props[i];
    v += prop.mortgaged ? sq.price * 0.45 : sq.price;
    v += prop.houses * (GROUPS[sq.group]?.houseCost || 0);
    const key = groupKey(sq);
    if (seen.has(key)) continue;
    seen.add(key);
    const ms = membersOf(sq);
    const n = ms.filter(k => owned.has(k)).length;
    if (sq.type === 'street' && n === ms.length) v += groupTotal(sq) * prof.groupBonus;
    else if (sq.type === 'street' && n === ms.length - 1) v += groupTotal(sq) * prof.groupBonus * 0.15;
    else if (sq.type === 'console') v += [0, 0, 60, 160, 300][n] * prof.groupBonus;
    else if (sq.type === 'utility' && n === 2) v += 80 * prof.groupBonus;
  }
  return v;
}

const completedGroups = owned => Object.keys(GROUPS).filter(g => groupMembers(g).every(i => owned.has(i)));

function ownedSet(game, pid) { return new Set(game.ownedBy(pid)); }

// quanto "guadagna" il bot da uno scambio (positivo = conveniente)
function tradeGain(game, botId, trade, prof) {
  const receiving = trade.toId === botId;
  const mineGive = receiving ? trade.request : trade.offer;
  const mineGet = receiving ? trade.offer : trade.request;
  const otherId = receiving ? trade.fromId : trade.toId;

  const before = ownedSet(game, botId);
  const after = new Set(before);
  for (const i of mineGive.props) after.delete(i);
  for (const i of mineGet.props) after.add(i);
  let gain = portfolioValue(game, after, prof) - portfolioValue(game, before, prof);
  gain += mineGet.cash - mineGive.cash + (mineGet.jailCards - mineGive.jailCards) * 40;
  if (game.classic) gain -= mineGet.props.filter(i => game.props[i].mortgaged).reduce((s, i) => s + SQUARES[i].price * 0.05, 0);

  // pericolo: l'avversario completa nuovi gruppi grazie allo scambio
  // (peso più basso che nelle aste: chi paga il gruppo ha comunque speso soldi per ottenerlo)
  const oBefore = ownedSet(game, otherId);
  const oAfter = new Set(oBefore);
  for (const i of mineGet.props) oAfter.delete(i);
  for (const i of mineGive.props) oAfter.add(i);
  const newGroups = completedGroups(oAfter).filter(g => !completedGroups(oBefore).includes(g));
  for (const g of newGroups) gain -= groupTotal(SQUARES[groupMembers(g)[0]]) * prof.tradeBlock;
  return gain;
}

// ---------- helper per le decisioni ----------
function wouldComplete(game, pid, idx) {
  const sq = SQUARES[idx];
  if (sq.type !== 'street') return false;
  return groupMembers(sq.group).every(i => i === idx || game.props[i].ownerId === pid);
}
function blocksOpponent(game, pid, idx) {
  const sq = SQUARES[idx];
  if (sq.type !== 'street') return false;
  const others = groupMembers(sq.group).filter(i => i !== idx).map(i => game.props[i].ownerId);
  return others.length > 0 && others[0] && others[0] !== pid && others.every(o => o === others[0]);
}

function sellCandidate(game, pid) {
  // vende prima sui gruppi più economici, rispettando l'uniformità
  const spots = game.ownedBy(pid).filter(i => {
    const p = game.props[i];
    if (!p.houses) return false;
    const ms = groupMembers(SQUARES[i].group);
    return p.houses === Math.max(...ms.map(k => game.props[k].houses));
  });
  spots.sort((a, b) => GROUPS[SQUARES[a].group].houseCost - GROUPS[SQUARES[b].group].houseCost);
  return spots[0];
}

function mortgageCandidate(game, pid, { avoidFullGroups = true, exclude = null } = {}) {
  const list = game.ownedBy(pid).filter(i => {
    const p = game.props[i], sq = SQUARES[i];
    if (p.mortgaged || i === exclude) return false;
    if (sq.type === 'street' && game.groupHasBuildings(sq.group)) return false;
    return true;
  });
  const score = i => {
    const sq = SQUARES[i];
    const full = sq.type === 'street' && game.ownsGroup(pid, sq.group);
    return (full ? 1000 : 0) + sq.price; // prima le proprietà fuori dai gruppi completi e più economiche
  };
  list.sort((a, b) => score(a) - score(b));
  const pick = list[0];
  if (pick === undefined) return undefined;
  if (avoidFullGroups && score(pick) >= 1000) return undefined;
  return pick;
}

function opponentHouses(game, pid) {
  return BUYABLE.filter(i => game.props[i].ownerId && game.props[i].ownerId !== pid)
    .reduce((s, i) => s + game.props[i].houses, 0);
}

// ---------- decisioni ----------
function raiseMoney(game, pid) {
  const s = sellCandidate(game, pid);
  if (s !== undefined) return { type: 'sell', idx: s };
  const m = mortgageCandidate(game, pid, { avoidFullGroups: false });
  if (m !== undefined) return { type: 'mortgage', idx: m };
  return null;
}

function decideAuction(game, me, prof, rng) {
  const a = game.auction;
  if (!a.participants.includes(me.id) || a.passed.includes(me.id) || a.highBidderId === me.id) return null;
  let limit, step;
  if (a.kind === 'building') {
    const spots = game.buildSpots(me.id, a.building);
    if (!spots.length) return { type: 'pass' };
    const cost = Math.min(...spots.map(i => GROUPS[SQUARES[i].group].houseCost));
    limit = cost * (1 + 0.5 * prof.bidFactor);
    step = 10;
  } else {
    const sq = SQUARES[a.propertyIdx];
    limit = sq.price * prof.bidFactor;
    if (wouldComplete(game, me.id, a.propertyIdx)) limit *= 1 + prof.groupBonus;
    else if (blocksOpponent(game, me.id, a.propertyIdx)) limit *= 1 + 0.4 * prof.blockWeight;
    step = Math.max(5, Math.round(sq.price * 0.05));
  }
  limit *= 1 + (rng() - 0.5) * prof.noise;
  const next = a.highBid + step;
  const affordable = me.cash - prof.reserve * 0.5;
  if (next <= limit && next <= affordable) return { type: 'bid', amount: Math.max(next, a.highBid + 1) };
  if (a.highBid + 1 <= limit && a.highBid + 1 <= affordable) return { type: 'bid', amount: a.highBid + 1 };
  return { type: 'pass' };
}

function decideBuild(game, me, prof, mem) {
  for (const building of ['house', 'hotel']) {
    if (me.buildTokens[building] > 0) {
      const spot = game.buildSpots(me.id, building)[0];
      if (spot !== undefined) return { type: 'build', idx: spot };
    }
  }
  if (game.auction) return null;
  // evita catene infinite di aste per i livelli nello stesso turno
  if (mem.buildAuctionTurn === game.turnCount && mem.buildAuctions >= 3) return null;
  const spots = [...game.buildSpots(me.id, 'house'), ...game.buildSpots(me.id, 'hotel')]
    .filter(i => me.cash - GROUPS[SQUARES[i].group].houseCost >= prof.buildReserve);
  // sui gruppi più redditizi (costo livello maggiore) e sulle caselle con meno costruzioni
  spots.sort((a, b) => game.props[a].houses - game.props[b].houses
    || GROUPS[SQUARES[b].group].houseCost - GROUPS[SQUARES[a].group].houseCost);
  return spots.length ? { type: 'build', idx: spots[0] } : null;
}

function decideUnmortgage(game, me, prof) {
  const list = game.ownedBy(me.id).filter(i => game.props[i].mortgaged);
  const full = i => (SQUARES[i].type === 'street' && game.ownsGroup(me.id, SQUARES[i].group) ? 1 : 0);
  list.sort((a, b) => full(b) - full(a));
  for (const i of list) {
    const cost = game.unmortgageCost(i);
    if (me.cash - cost >= prof.unmortgageReserve || (game.props[i].interestPaid && me.cash - cost >= prof.reserve)) {
      return { type: 'unmortgage', idx: i };
    }
  }
  return null;
}

// proposta: compra la proprietà che manca per completare un gruppo
function decideProposal(game, me, prof, mem, rng) {
  if (game.trades.some(t => t.fromId === me.id)) return null;
  if (mem.proposedTurn === game.turnCount) return null;
  mem.proposedTurn = game.turnCount; // al massimo un tentativo per turno
  if (rng() > prof.proposeChance) return null;
  mem.recent = mem.recent || {};
  mem.attempts = mem.attempts || {};
  // attesa tra due proposte per la stessa proprietà: ~6 turni del bot
  const cooldown = 6 * game.alive().length;
  for (const g of Object.keys(GROUPS)) {
    const ms = groupMembers(g);
    const missing = ms.filter(i => game.props[i].ownerId !== me.id);
    if (missing.length !== 1) continue;
    const idx = missing[0];
    const ownerId = game.props[idx].ownerId;
    if (!ownerId || game.groupHasBuildings(g)) continue;
    const owner = game.player(ownerId);
    if (!owner || owner.bankrupt) continue;
    const key = `${ownerId}:${idx}`;
    if (mem.recent[key] && game.turnCount - mem.recent[key] < cooldown) continue;
    const attempt = mem.attempts[key] || 0;

    const price = SQUARES[idx].price;
    const offer = { cash: 0, props: [], jailCards: 0 };
    const budget = Math.max(0, me.cash - prof.reserve);

    // 1) scambio alla pari: gli do la proprietà che manca a LUI per completare un suo gruppo
    const swap = game.ownedBy(me.id).find(i => {
      const sq = SQUARES[i];
      return sq.type === 'street' && sq.group !== g && !game.props[i].mortgaged
        && !game.groupHasBuildings(sq.group) && wouldComplete(game, ownerId, i);
    });
    if (swap !== undefined) {
      offer.props.push(swap);
      const diff = price - SQUARES[swap].price;
      offer.cash = Math.min(budget, Math.max(0, diff) + Math.round(price * 0.1 * (1 + attempt)));
      mem.recent[key] = game.turnCount;
      mem.attempts[key] = attempt + 1;
      return { type: 'proposeTrade', toId: ownerId, offer, request: { cash: 0, props: [idx], jailCards: 0 } };
    }

    // 2) offerta in denaro, più generosa a ogni tentativo
    const cash = Math.round(price * (prof.tradeCashFactor + 0.3 * Math.min(attempt, 3)) / 10) * 10;
    if (budget >= cash) offer.cash = cash;
    else {
      // aggiunge una proprietà "inutile" (non vicina a un gruppo per nessuno dei due)
      const sweetener = game.ownedBy(me.id).find(i => {
        const sq = SQUARES[i];
        if (sq.type !== 'street' || game.props[i].mortgaged || game.groupHasBuildings(sq.group)) return false;
        if (wouldComplete(game, ownerId, i)) return false;
        return groupMembers(sq.group).filter(k => game.props[k].ownerId === me.id).length === 1;
      });
      if (sweetener === undefined && budget < price * 0.8) continue;
      offer.cash = Math.min(budget, cash);
      if (sweetener !== undefined) offer.props.push(sweetener);
    }
    if (!offer.cash && !offer.props.length) continue;
    mem.recent[key] = game.turnCount;
    mem.attempts[key] = attempt + 1;
    return { type: 'proposeTrade', toId: ownerId, offer, request: { cash: 0, props: [idx], jailCards: 0 } };
  }
  return null;
}

function decideTrades(game, me, prof, mem) {
  // risponde alle proposte ricevute
  const incoming = game.trades.find(t => t.toId === me.id);
  if (incoming) {
    const gain = tradeGain(game, me.id, incoming, prof);
    if (gain >= prof.acceptMargin) return { type: 'respondTrade', tradeId: incoming.id, accept: true };
    // spiega quanto servirebbe in più, arrotondato a 10
    const missing = Math.max(10, Math.ceil((prof.acceptMargin - gain) / 10) * 10);
    return { type: 'respondTrade', tradeId: incoming.id, accept: false, note: `vorrebbe circa ${missing} in più` };
  }
  // ritira le proprie proposte rimaste senza risposta troppo a lungo
  mem.tradeSeen = mem.tradeSeen || {};
  for (const t of game.trades.filter(x => x.fromId === me.id)) {
    mem.tradeSeen[t.id] = mem.tradeSeen[t.id] ?? game.turnCount;
    if (game.turnCount - mem.tradeSeen[t.id] >= 3) return { type: 'cancelTrade', tradeId: t.id };
  }
  return null;
}

function decide(game, botId, mem = {}, rng = Math.random) {
  if (game.phase !== 'playing') return null;
  const me = game.player(botId);
  if (!me || me.bankrupt) return null;
  const prof = PROFILES[me.difficulty] || PROFILES.normal;

  // 1. debiti
  const debt = game.debts.find(d => d.playerId === botId);
  if (debt) {
    if (me.cash >= debt.amount) return { type: 'payDebt' };
    return raiseMoney(game, botId) || { type: 'bankrupt' };
  }

  // 2. aste
  if (game.auction) return decideAuction(game, me, prof, rng);

  // 3. scambi
  const tradeAction = decideTrades(game, me, prof, mem);
  if (tradeAction) return tradeAction;

  // 4. turno
  const t = game.turn;
  if (t.playerId !== botId || game.debts.length) return null;

  if (t.phase === 'preRoll') {
    if (me.inJail) {
      const stayInside = prof.smartJail && opponentHouses(game, botId) >= 8 && me.jailTurns < 2;
      if (!stayInside) {
        if (me.jailCards.length) return { type: 'useJailCard' };
        if (me.cash - JAIL_FINE >= prof.reserve * 2 && rng() > prof.noise) return { type: 'payJail' };
      }
    }
    return { type: 'roll' };
  }

  if (t.phase === 'awaitBuy') {
    const idx = t.pendingBuy;
    const price = SQUARES[idx].price;
    const important = wouldComplete(game, botId, idx) || blocksOpponent(game, botId, idx);
    if (me.cash - price >= prof.reserve || (important && me.cash >= price)) return { type: 'buy' };
    if (important && prof.mortgageToComplete) {
      const m = mortgageCandidate(game, botId, { exclude: idx });
      if (m !== undefined) return { type: 'mortgage', idx: m };
    }
    return { type: 'decline' };
  }

  if (t.phase === 'postRoll') {
    return decideBuild(game, me, prof, mem)
      || decideUnmortgage(game, me, prof)
      || decideProposal(game, me, prof, mem, rng)
      || { type: 'endTurn' };
  }
  return null;
}

// azione "sicura" quando la scelta normale viene rifiutata dal gioco
function fallback(game, botId) {
  const me = game.player(botId);
  if (!me || me.bankrupt || game.phase !== 'playing') return null;
  if (game.debts.find(d => d.playerId === botId)) return { type: 'bankrupt' };
  if (game.auction) {
    const a = game.auction;
    return a.participants.includes(botId) && !a.passed.includes(botId) && a.highBidderId !== botId ? { type: 'pass' } : null;
  }
  const incoming = game.trades.find(x => x.toId === botId);
  if (incoming) return { type: 'respondTrade', tradeId: incoming.id, accept: false };
  if (game.turn.playerId !== botId) return null;
  return { preRoll: { type: 'roll' }, awaitBuy: { type: 'decline' }, postRoll: { type: 'endTurn' } }[game.turn.phase] || null;
}

module.exports = { decide, fallback, tradeGain, PROFILES };
