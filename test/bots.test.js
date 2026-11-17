const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../server/game');
const { BotManager } = require('../server/bots');
const { decide, tradeGain, PROFILES } = require('../server/bot-brain');

// generatore pseudo-casuale riproducibile
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function botGame({ seed = 1, rules = 'classic', diffs = ['easy', 'normal', 'hard'] } = {}) {
  const rng = seeded(seed);
  const g = new Game({ autoTimers: false, allowBotsOnly: true, rng, settings: { rules } });
  for (const d of diffs) g.addBot(d);
  g.start();
  const m = new BotManager(g, { rng, log: () => {} });
  return { g, m };
}

// partita con un umano "finto" (A) e un bot (B), per testare le singole decisioni
function duel(difficulty = 'normal') {
  const g = new Game({ autoTimers: false, rng: () => 0 });
  const a = g.join('Umano');
  const b = g.addBot(difficulty);
  g.start(); // rng 0 → parte l'umano
  return { g, a, b };
}

test('non si può avviare una partita di soli bot', () => {
  const g = new Game({ autoTimers: false });
  g.addBot('easy'); g.addBot('hard');
  assert.throws(() => g.start(), /umano/);
  g.join('Diego');
  g.start();
  assert.equal(g.phase, 'playing');
});

test('host = primo umano anche se i bot sono entrati prima', () => {
  const g = new Game({ autoTimers: false });
  g.addBot('easy');
  const h = g.join('Diego');
  assert.equal(g.host().id, h.id);
  g.act(h.id, { type: 'start' });
  assert.equal(g.phase, 'playing');
});

for (const rules of ['classic', 'simple']) {
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`partita completa tra bot (${rules}, seed ${seed}) termina con un vincitore`, () => {
      const { g, m } = botGame({ seed, rules });
      m.runSync(200000);
      assert.equal(g.phase, 'ended', `ancora in corso dopo ${g.turnCount} turni`);
      assert.ok(g.winnerId);
      assert.equal(g.alive().length, 1);
      // coerenza della banca
      const houses = Object.values(g.props).reduce((s, p) => s + (p.houses < 5 ? p.houses : 0), 0);
      const hotels = Object.values(g.props).filter(p => p.houses === 5).length;
      assert.equal(houses + g.housesLeft + g.players.reduce((s, p) => s + p.buildTokens.house, 0), 32);
      assert.equal(hotels + g.hotelsLeft + g.players.reduce((s, p) => s + p.buildTokens.hotel, 0), 12);
    });
  }
}

test('il bot compra se ha soldi, rifiuta se resterebbe sotto la riserva', () => {
  const { g, a, b } = duel('normal');
  g.turn.playerId = b.id; g.turn.phase = 'awaitBuy'; g.turn.pendingBuy = 39;
  assert.deepEqual(decide(g, b.id), { type: 'buy' });
  b.cash = 450; // 450 - 400 < riserva 150
  assert.deepEqual(decide(g, b.id), { type: 'decline' });
});

test('il bot compra anche sotto riserva se completa un gruppo', () => {
  const { g, b } = duel('normal');
  g.props[37].ownerId = b.id;
  b.cash = 420;
  g.turn.playerId = b.id; g.turn.phase = 'awaitBuy'; g.turn.pendingBuy = 39;
  assert.deepEqual(decide(g, b.id), { type: 'buy' });
});

test('il bot in debito vende costruzioni, poi ipoteca, poi va in bancarotta', () => {
  const { g, a, b } = duel('normal');
  g.props[1].ownerId = b.id; g.props[3].ownerId = b.id; g.props[1].houses = 1;
  g.housesLeft = 31;
  b.cash = 0;
  g.debts.push({ id: 'x', playerId: b.id, creditorId: a.id, amount: 5000 });
  assert.deepEqual(decide(g, b.id), { type: 'sell', idx: 1 });
  g.sell(b.id, 1);
  assert.equal(decide(g, b.id).type, 'mortgage');
  g.mortgage(b.id, 1); g.mortgage(b.id, 3);
  assert.deepEqual(decide(g, b.id), { type: 'bankrupt' });
});

test('il bot paga il debito quando può', () => {
  const { g, a, b } = duel();
  g.debts.push({ id: 'x', playerId: b.id, creditorId: a.id, amount: 100 });
  assert.deepEqual(decide(g, b.id), { type: 'payDebt' });
});

test('scambi: il bot accetta un\'offerta vantaggiosa e rifiuta se completa un gruppo all\'avversario', () => {
  const { g, a, b } = duel('normal');
  g.props[5].ownerId = b.id;
  const good = g.proposeTrade(a.id, { toId: b.id, offer: { cash: 400 }, request: { props: [5] } });
  assert.ok(tradeGain(g, b.id, good, PROFILES.normal) > 0);
  assert.deepEqual(decide(g, b.id), { type: 'respondTrade', tradeId: good.id, accept: true });
  g.cancelTrade(a.id, good.id);

  g.props[37].ownerId = a.id; g.props[39].ownerId = b.id;
  const bad = g.proposeTrade(a.id, { toId: b.id, offer: { cash: 450 }, request: { props: [39] } });
  const no = decide(g, b.id);
  assert.equal(no.accept, false);
  assert.match(no.note, /in più/);
  g.act(b.id, no);
  assert.equal(g.tradeResults.at(-1).accepted, false);
  assert.match(g.tradeResults.at(-1).note, /in più/);
});

test('scambi: il bot accetta un prezzo alto per completarti un gruppo e gli scambi alla pari tra gruppi', () => {
  for (const d of ['normal', 'hard']) {
    const { g, a, b } = duel(d);
    g.props[16].ownerId = a.id; g.props[18].ownerId = a.id; g.props[19].ownerId = b.id;
    const t = g.proposeTrade(a.id, { toId: b.id, offer: { cash: 650 }, request: { props: [19] } });
    assert.equal(decide(g, b.id).accept, true, `${d}: 650 per l'ultimo pezzo`);
    g.cancelTrade(a.id, t.id);
    g.props[21].ownerId = b.id; g.props[23].ownerId = b.id; g.props[24].ownerId = a.id;
    g.proposeTrade(a.id, { toId: b.id, offer: { props: [24] }, request: { props: [19] } });
    assert.equal(decide(g, b.id).accept, true, `${d}: scambio alla pari`);
  }
});

test('il bot propone uno scambio per completare un gruppo', () => {
  const { g, a, b } = duel('hard');
  g.props[37].ownerId = b.id; g.props[39].ownerId = a.id;
  g.turn.playerId = b.id; g.turn.phase = 'postRoll';
  const action = decide(g, b.id, {}, () => 0); // rng 0 → propone sempre
  assert.equal(action.type, 'proposeTrade');
  assert.equal(action.toId, a.id);
  assert.deepEqual(action.request.props, [39]);
  assert.ok(action.offer.cash >= 400);
  g.act(b.id, action); // la proposta è valida per il gioco
  assert.equal(g.trades.length, 1);
});

test('il bot partecipa all\'asta e passa oltre il suo limite', () => {
  const { g, a, b } = duel('normal');
  g.diceQueue.push([1, 2]);
  g.roll(a.id); g.decline(a.id); // asta per Sala Gettoni (60)
  const first = decide(g, b.id, {}, () => 0.5);
  assert.equal(first.type, 'bid');
  g.bid(a.id, 200);
  assert.deepEqual(decide(g, b.id, {}, () => 0.5), { type: 'pass' });
});

test('in Game Over Zone il bot usa la carta solo se ce l\'ha', () => {
  const { g, b } = duel('normal');
  g.turn.playerId = b.id; g.turn.phase = 'preRoll';
  g.sendToJail(b);
  b.cash = 100; // poco: non paga, tira
  assert.deepEqual(decide(g, b.id, {}, () => 0.5), { type: 'roll' });
  b.jailCards.push('glitch');
  assert.deepEqual(decide(g, b.id, {}, () => 0.5), { type: 'useJailCard' });
});
