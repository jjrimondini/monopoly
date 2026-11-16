const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError } = require('../server/game');

function setup(n = 2, rules = 'classic') {
  const g = new Game({ autoTimers: false, rng: () => 0, settings: { rules } }); // rng 0 → parte il primo giocatore
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(g.join(`P${i}`));
  g.start();
  return { g, ps };
}

test('movimento, acquisto e passaggio dal via', () => {
  const { g, ps: [a] } = setup();
  g.diceQueue.push([1, 2]);
  g.roll(a.id);
  assert.equal(a.position, 3);
  assert.equal(g.turn.phase, 'awaitBuy');
  g.buy(a.id);
  assert.equal(g.props[3].ownerId, a.id);
  assert.equal(a.cash, 1500 - 60);
  assert.equal(g.turn.phase, 'postRoll');
});

test('affitto base, raddoppiato col gruppo completo e con livelli', () => {
  const { g, ps: [a, b] } = setup();
  g.props[1].ownerId = a.id;
  assert.equal(g.rentFor(1), 2);
  g.props[3].ownerId = a.id;
  assert.equal(g.rentFor(1), 4);
  g.build(a.id, 1);
  assert.throws(() => g.build(a.id, 1), GameError); // costruzione uniforme
  g.build(a.id, 3);
  g.build(a.id, 1);
  assert.equal(g.rentFor(1), 30);
  // B atterra su 1 e paga
  g.turn.playerId = b.id;
  g.diceQueue.push([0, 1]);
  g.roll(b.id);
  assert.equal(b.cash, 1500 - 30);
});

test('tre doppi mandano nella Game Over Zone', () => {
  const { g, ps: [a] } = setup();
  g.diceQueue.push([1, 1], [2, 2], [3, 3]);
  g.roll(a.id); if (g.turn.phase === 'awaitBuy') g.decline(a.id), g.finishAuction();
  g.roll(a.id); if (g.turn.phase === 'awaitBuy') g.decline(a.id), g.finishAuction();
  g.roll(a.id);
  assert.equal(a.inJail, true);
  assert.equal(a.position, 10);
  assert.equal(g.turn.phase, 'postRoll');
});

test('asta: vince il miglior offerente', () => {
  const { g, ps: [a, b] } = setup();
  g.diceQueue.push([1, 2]);
  g.roll(a.id);
  g.decline(a.id);
  g.bid(b.id, 10);
  g.bid(a.id, 20);
  g.bid(b.id, 45);
  g.passAuction(a.id);
  assert.equal(g.auction, null);
  assert.equal(g.props[3].ownerId, b.id);
  assert.equal(b.cash, 1455);
  assert.equal(g.turn.phase, 'postRoll');
});

test('debito e bancarotta verso un giocatore', () => {
  const { g, ps: [a, b] } = setup();
  g.props[39].ownerId = b.id;
  g.props[37].ownerId = b.id;
  b.cash = 10000;
  for (let i = 0; i < 5; i++) { g.build(b.id, 37); g.build(b.id, 39); }
  a.cash = 100;
  a.position = 35;
  g.diceQueue.push([1, 3]);
  g.roll(a.id);
  assert.equal(g.debts.length, 1);
  assert.throws(() => g.endTurn(a.id), GameError);
  g.bankrupt(a.id);
  assert.equal(g.phase, 'ended');
  assert.equal(g.winnerId, b.id);
});

test('scambio tra giocatori', () => {
  const { g, ps: [a, b] } = setup();
  g.props[5].ownerId = a.id;
  const t = g.proposeTrade(a.id, { toId: b.id, offer: { props: [5] }, request: { cash: 300 } });
  g.respondTrade(b.id, t.id, true);
  assert.equal(g.props[5].ownerId, b.id);
  assert.equal(a.cash, 1800);
  assert.equal(b.cash, 1200);
});

test('ipoteca e riscatto', () => {
  const { g, ps: [a] } = setup();
  g.props[39].ownerId = a.id;
  g.mortgage(a.id, 39);
  assert.equal(a.cash, 1700);
  assert.equal(g.rentFor(39), 0);
  g.unmortgage(a.id, 39);
  assert.equal(a.cash, 1700 - 220);
});

test('prigione: uscita pagando', () => {
  const { g, ps: [a] } = setup();
  g.sendToJail(a);
  g.payJail(a.id);
  assert.equal(a.inJail, false);
  assert.equal(a.cash, 1450);
});

// ---------- regole classiche vs semplificate ----------

test('classiche: ricevere una proprietà ipotecata costa il 10% di interessi', () => {
  const { g, ps: [a, b] } = setup();
  g.props[39].ownerId = a.id;
  g.mortgage(a.id, 39); // a: 1700
  const t = g.proposeTrade(a.id, { toId: b.id, offer: { props: [39] } });
  g.respondTrade(b.id, t.id, true);
  assert.equal(b.cash, 1500 - 20);
});

test('semplificate: nessun interesse sulle ipoteche ricevute', () => {
  const { g, ps: [a, b] } = setup(2, 'simple');
  g.props[39].ownerId = a.id;
  g.mortgage(a.id, 39);
  const t = g.proposeTrade(a.id, { toId: b.id, offer: { props: [39] } });
  g.respondTrade(b.id, t.id, true);
  assert.equal(b.cash, 1500);
});

test('classiche: bancarotta verso la banca manda le proprietà all\'asta, poi il turno riprende', () => {
  const { g, ps: [a, b, c] } = setup(3);
  g.props[1].ownerId = b.id;
  g.props[3].ownerId = b.id;
  g.mortgage(b.id, 3);
  g.bankrupt(b.id); // non è il turno di b: a è in preRoll
  assert.equal(g.auction.propertyIdx, 1);
  assert.equal(g.auction.fromBank, true);
  g.bid(a.id, 5);
  g.passAuction(c.id);
  assert.equal(g.props[1].ownerId, a.id);
  assert.equal(g.auction.propertyIdx, 3);
  assert.equal(g.props[3].mortgaged, false);
  g.passAuction(a.id); g.passAuction(c.id);
  assert.equal(g.auction, null);
  assert.equal(g.props[3].ownerId, null);
  assert.equal(g.turn.playerId, a.id);
  assert.equal(g.turn.phase, 'preRoll');
});

test('classiche: bancarotta del giocatore di turno, dopo le aste tocca al successivo', () => {
  const { g, ps: [a, b, c] } = setup(3);
  g.props[1].ownerId = a.id;
  g.bankrupt(a.id);
  g.passAuction(b.id); g.passAuction(c.id);
  assert.equal(g.turn.playerId, b.id);
  assert.equal(g.turn.phase, 'preRoll');
});

test('semplificate: bancarotta verso la banca libera le proprietà senza asta', () => {
  const { g, ps: [a, b, c] } = setup(3, 'simple');
  g.props[1].ownerId = b.id;
  g.bankrupt(b.id);
  assert.equal(g.auction, null);
  assert.equal(g.props[1].ownerId, null);
});

test('classiche: la carta utility fa ritirare i dadi', () => {
  const { g, ps: [a, b] } = setup();
  g.props[12].ownerId = b.id;
  g.dice = { values: [6, 6], id: 0 };
  a.position = 7;
  g.diceQueue.push([1, 2]);
  g.moveTo(a, 12, { utilityTen: true });
  assert.equal(b.cash, 1500 + 30);
});

test('impostazioni modificabili solo in lobby', () => {
  const g = new Game({ autoTimers: false });
  g.join('A'); g.join('B');
  g.setSettings({ rules: 'simple', startCash: 2000 });
  g.start();
  assert.equal(g.players[0].cash, 2000);
  assert.throws(() => g.setSettings({ rules: 'classic' }), GameError);
});

// ---------- regole ufficiali aggiuntive ----------

test('classiche: proprietà ipotecata ricevuta e riscattata subito → niente secondo 10%', () => {
  const { g, ps: [a, b] } = setup();
  g.props[39].ownerId = a.id;
  g.mortgage(a.id, 39);
  const t = g.proposeTrade(a.id, { toId: b.id, offer: { props: [39] } });
  g.respondTrade(b.id, t.id, true); // b paga 20 di interessi
  g.unmortgage(b.id, 39); // paga solo i 200 di capitale
  assert.equal(b.cash, 1500 - 20 - 200);
});

test('classiche: dopo la fine del turno il riscatto torna a costare il 110%', () => {
  const { g, ps: [a, b] } = setup();
  g.props[39].ownerId = a.id;
  g.mortgage(a.id, 39);
  const t = g.proposeTrade(a.id, { toId: b.id, offer: { props: [39] } });
  g.respondTrade(b.id, t.id, true);
  g.turn.phase = 'postRoll';
  g.endTurn(a.id);
  g.unmortgage(b.id, 39);
  assert.equal(b.cash, 1500 - 20 - 220);
});

function twoBuilders(rules) {
  const { g, ps: [a, b, c] } = setup(3, rules);
  g.props[1].ownerId = a.id; g.props[3].ownerId = a.id;   // arcade ad a
  g.props[6].ownerId = b.id; g.props[8].ownerId = b.id; g.props[9].ownerId = b.id; // platform a b
  return { g, a, b, c };
}

test('classiche: con pochi livelli in banca la costruzione contesa va all\'asta', () => {
  const { g, a, b, c } = twoBuilders('classic');
  g.housesLeft = 3;
  g.build(a.id, 1);
  assert.equal(g.auction.kind, 'building');
  assert.deepEqual(g.auction.participants, [a.id, b.id]);
  assert.throws(() => g.bid(c.id, 60), GameError); // c non può costruire
  assert.throws(() => g.bid(a.id, 40), GameError); // sotto la base (50)
  g.bid(b.id, 50);
  g.bid(a.id, 80);
  g.passAuction(b.id);
  assert.equal(g.auction, null);
  assert.equal(a.cash, 1500 - 80);
  assert.equal(g.housesLeft, 2);
  assert.equal(a.buildTokens.house, 1);
  assert.equal(g.turn.phase, 'preRoll'); // il turno riprende
  g.build(a.id, 3); // piazza gratis
  assert.equal(g.props[3].houses, 1);
  assert.equal(a.cash, 1500 - 80);
  assert.equal(g.housesLeft, 2);
});

test('classiche: livello vinto e non piazzato torna alla banca a fine turno', () => {
  const { g, a, b } = twoBuilders('classic');
  g.housesLeft = 2;
  g.build(b.id, 6);
  g.bid(b.id, 50); g.passAuction(a.id);
  assert.equal(g.housesLeft, 1);
  g.turn.phase = 'postRoll';
  g.endTurn(a.id);
  assert.equal(g.housesLeft, 2);
  assert.equal(b.buildTokens.house, 0);
});

test('semplificate: nessuna asta per i livelli', () => {
  const { g, a } = twoBuilders('simple');
  g.housesLeft = 3;
  g.build(a.id, 1);
  assert.equal(g.auction, null);
  assert.equal(g.props[1].houses, 1);
});

test('classiche: se solo uno può costruire non c\'è asta', () => {
  const { g, a, b } = twoBuilders('classic');
  b.cash = 10;
  g.housesLeft = 3;
  g.build(a.id, 1);
  assert.equal(g.auction, null);
});

function hotelSale(rules) {
  const { g, ps: [a] } = setup(2, rules);
  g.props[1].ownerId = a.id; g.props[3].ownerId = a.id;
  g.props[1].houses = 5; g.props[3].houses = 4;
  g.hotelsLeft = 11;
  g.housesLeft = 2;
  g.sell(a.id, 1);
  return { g, a };
}

test('classiche: Boss Level venduto con 2 livelli in banca diventa 2 livelli', () => {
  const { g, a } = hotelSale('classic');
  assert.equal(g.props[1].houses, 2);
  assert.equal(g.housesLeft, 0);
  assert.equal(g.hotelsLeft, 12);
  assert.equal(a.cash, 1500 + 25 * 3); // boss + 2 livelli non sostituiti
});

test('semplificate: Boss Level venduto senza livelli sufficienti viene smontato', () => {
  const { g, a } = hotelSale('simple');
  assert.equal(g.props[1].houses, 0);
  assert.equal(a.cash, 1500 + 25 * 5);
});
