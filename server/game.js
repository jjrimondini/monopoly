const crypto = require('crypto');
const { SQUARES, GROUPS, BUYABLE, groupMembers } = require('./board-data');
const { DECKS } = require('./cards');

const START_CASH = 1500;
const GO_SALARY = 200;
const JAIL_FINE = 50;
const JAIL_POS = 10;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const TOTAL_HOUSES = 32;
const TOTAL_HOTELS = 12;
// sotto queste soglie (regole classiche) le costruzioni contese vanno all'asta
const SHORTAGE_HOUSES = 4;
const SHORTAGE_HOTELS = 2;

const TOKENS = ['🎮', '👾', '🕹️', '💾', '🚀', '🤖', '🐉', '⚔️'];
const COLORS = ['#ff4d6d', '#4dd2ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f43'];
const BOT_NAMES = ['CPU Glitchy', 'CPU Byte', 'CPU Pixel', 'CPU Turbo', 'CPU Lag', 'CPU Combo', 'CPU Boss', 'CPU Respawn'];
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const BOT_SPEEDS = ['slow', 'normal', 'fast'];

class GameError extends Error {}
const fail = msg => { throw new GameError(msg); };
const money = n => `${n} ₵`;

class Game {
  constructor(opts = {}) {
    this.autoTimers = opts.autoTimers ?? true;
    this.onChange = opts.onChange || (() => {});
    this.rng = opts.rng || Math.random;
    this.allowBotsOnly = !!opts.allowBotsOnly; // solo per test/simulazioni
    this.settings = {
      rules: 'classic',
      startCash: START_CASH,
      auctionSeconds: (opts.auctionMs ?? 12000) / 1000,
      botSpeed: 'normal',
      ...opts.settings,
    };
    this.reset();
  }

  get auctionMs() { return this.settings.auctionSeconds * 1000; }
  get classic() { return this.settings.rules === 'classic'; }

  // impostazioni modificabili solo in lobby; restano valide anche per le partite successive
  setSettings(s = {}) {
    if (this.phase !== 'lobby') fail('Le impostazioni si cambiano solo prima di iniziare');
    const next = { ...this.settings };
    if (s.rules !== undefined) {
      if (!['classic', 'simple'].includes(s.rules)) fail('Modalità regole non valida');
      next.rules = s.rules;
    }
    if (s.startCash !== undefined) {
      const v = Math.floor(Number(s.startCash));
      if (!(v >= 500 && v <= 5000)) fail('Soldi iniziali tra 500 e 5000');
      next.startCash = v;
    }
    if (s.auctionSeconds !== undefined) {
      const v = Math.floor(Number(s.auctionSeconds));
      if (!(v >= 5 && v <= 60)) fail('Durata asta tra 5 e 60 secondi');
      next.auctionSeconds = v;
    }
    if (s.botSpeed !== undefined) {
      if (!BOT_SPEEDS.includes(s.botSpeed)) fail('Velocità bot non valida');
      next.botSpeed = s.botSpeed;
    }
    this.settings = next;
    for (const p of this.players) p.cash = next.startCash;
  }

  reset() {
    if (this.auctionTimer) clearTimeout(this.auctionTimer);
    this.auctionTimer = null;
    this.auctionQueue = [];
    this.phase = 'lobby';
    this.players = [];
    this.props = {};
    for (const i of BUYABLE) this.props[i] = { ownerId: null, houses: 0, mortgaged: false };
    this.housesLeft = TOTAL_HOUSES;
    this.hotelsLeft = TOTAL_HOTELS;
    this.turn = null;
    this.turnCount = 0;
    this.auction = null;
    this.trades = [];
    this.debts = [];
    this.log = [];
    this.logSeq = 0;
    this.lastCard = null;
    this.cardSeq = 0;
    this.dice = null;
    this.rollSeq = 0;
    this.winnerId = null;
    this.diceQueue = []; // per i test: tiri predefiniti
    this.decks = {
      glitch: this.shuffle(DECKS.glitch.map((_, i) => i)),
      powerup: this.shuffle(DECKS.powerup.map((_, i) => i)),
    };
  }

  // ---------- utilità ----------
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  addLog(text) {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > 80) this.log.shift();
  }
  player(id) { return this.players.find(p => p.id === id); }
  mustPlayer(id) { return this.player(id) || fail('Giocatore sconosciuto'); }
  alive() { return this.players.filter(p => !p.bankrupt); }
  current() { return this.turn ? this.player(this.turn.playerId) : null; }
  name(id) { return id ? this.player(id)?.name ?? '?' : 'la banca'; }
  ownedBy(id) { return BUYABLE.filter(i => this.props[i].ownerId === id); }
  ownsGroup(id, group) { return groupMembers(group).every(i => this.props[i].ownerId === id); }
  groupHasBuildings(group) { return groupMembers(group).some(i => this.props[i].houses > 0); }

  requirePlaying() { if (this.phase !== 'playing') fail('La partita non è in corso'); }
  requireTurn(playerId, ...phases) {
    this.requirePlaying();
    if (this.turn.playerId !== playerId) fail('Non è il tuo turno');
    if (phases.length && !phases.includes(this.turn.phase)) fail('Azione non disponibile ora');
  }
  requireNoDebts() { if (this.debts.length) fail('Ci sono debiti da saldare prima di continuare'); }
  requireNoAuction() { if (this.auction) fail('C\'è un\'asta in corso'); }

  // ---------- lobby ----------
  join(name, token, bot = null) {
    if (this.phase !== 'lobby') fail('La partita è già iniziata');
    if (this.players.length >= MAX_PLAYERS) fail(`Massimo ${MAX_PLAYERS} giocatori`);
    name = String(name || '').trim().slice(0, 16);
    if (!name) fail('Inserisci un nome');
    if (this.players.some(p => p.name.toLowerCase() === name.toLowerCase())) fail('Nome già usato');
    if (!bot && /^cpu\b/i.test(name)) fail('I nomi "CPU…" sono riservati ai bot');
    const used = new Set(this.players.map(p => p.token));
    if (!TOKENS.includes(token) || used.has(token)) token = TOKENS.find(t => !used.has(t));
    const usedColors = new Set(this.players.map(p => p.color));
    const p = {
      id: crypto.randomUUID().slice(0, 8),
      key: crypto.randomUUID(),
      name, token,
      color: COLORS.find(c => !usedColors.has(c)),
      cash: this.settings.startCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      buildTokens: { house: 0, hotel: 0 }, // costruzioni vinte all'asta, da piazzare
      bankrupt: false,
      connected: true,
      isBot: !!bot,
      difficulty: bot ? bot.difficulty : null,
    };
    this.players.push(p);
    this.addLog(`${p.token} ${p.name} è entrato in partita`);
    return p;
  }

  addBot(difficulty = 'normal') {
    if (!DIFFICULTIES.includes(difficulty)) fail('Difficoltà non valida');
    const used = new Set(this.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || fail('Nomi dei bot esauriti');
    return this.join(name, null, { difficulty });
  }

  byKey(key) { return this.players.find(p => p.key === key); }
  host() { return this.players.find(p => !p.isBot); }

  leave(playerId) {
    if (this.phase !== 'lobby') fail('Durante la partita puoi solo dichiarare bancarotta');
    const p = this.mustPlayer(playerId);
    this.players = this.players.filter(x => x !== p);
    this.addLog(`${p.name} ha lasciato la lobby`);
  }

  start() {
    if (this.phase !== 'lobby') fail('Partita già iniziata');
    if (this.players.length < MIN_PLAYERS) fail(`Servono almeno ${MIN_PLAYERS} giocatori (bot compresi)`);
    if (!this.allowBotsOnly && !this.host()) fail('Serve almeno un giocatore umano');
    this.phase = 'playing';
    for (const p of this.players) p.cash = this.settings.startCash;
    const first = Math.floor(this.rng() * this.players.length);
    this.addLog(`🎮 La partita è iniziata! Regole ${this.classic ? 'classiche' : 'semplificate'}, ${money(this.settings.startCash)} a testa`);
    this.beginTurn(this.players[first]);
  }

  beginTurn(p) {
    // il riscatto agevolato delle ipoteche ricevute vale solo "subito", cioè entro il turno
    for (const i of BUYABLE) delete this.props[i].interestPaid;
    for (const o of this.players) this.returnBuildTokens(o);
    this.turnCount++;
    this.turn = { playerId: p.id, phase: 'preRoll', doubles: 0, canReroll: false, pendingBuy: null };
    this.addLog(`Turno di ${p.token} ${p.name}`);
  }

  nextTurn() {
    const alive = this.alive();
    if (alive.length <= 1) return this.finish();
    const idx = this.players.findIndex(p => p.id === this.turn.playerId);
    for (let k = 1; k <= this.players.length; k++) {
      const p = this.players[(idx + k) % this.players.length];
      if (!p.bankrupt) return this.beginTurn(p);
    }
  }

  finish() {
    const alive = this.alive();
    this.phase = 'ended';
    this.winnerId = alive[0]?.id ?? null;
    if (this.auctionTimer) clearTimeout(this.auctionTimer);
    this.auction = null;
    this.auctionQueue = [];
    this.addLog(`🏆 ${alive[0]?.name ?? 'Nessuno'} ha vinto la partita!`);
  }

  // ---------- dadi e movimento ----------
  rollDice() {
    const d = this.diceQueue.length
      ? this.diceQueue.shift()
      : [1 + Math.floor(this.rng() * 6), 1 + Math.floor(this.rng() * 6)];
    this.dice = { values: d, id: ++this.rollSeq };
    return d;
  }

  roll(playerId) {
    this.requireTurn(playerId, 'preRoll');
    this.requireNoDebts();
    this.requireNoAuction();
    const p = this.current();
    const [a, b] = this.rollDice();
    const isDouble = a === b;
    this.addLog(`${p.name} tira ${a} + ${b}${isDouble ? ' (doppio!)' : ''}`);

    if (p.inJail) {
      if (isDouble) {
        p.inJail = false; p.jailTurns = 0;
        this.addLog(`${p.name} esce dalla Game Over Zone con un doppio`);
        this.turn.canReroll = false;
        this.moveBy(p, a + b);
      } else {
        p.jailTurns++;
        if (p.jailTurns >= 3) {
          this.addLog(`${p.name} deve pagare ${money(JAIL_FINE)} per uscire`);
          this.pay(p, null, JAIL_FINE, 'uscita dalla Game Over Zone');
          p.inJail = false; p.jailTurns = 0;
          this.turn.canReroll = false;
          this.moveBy(p, a + b);
        } else {
          this.turn.canReroll = false;
          this.turn.phase = 'postRoll';
          return;
        }
      }
    } else {
      if (isDouble) {
        this.turn.doubles++;
        if (this.turn.doubles >= 3) {
          this.addLog(`Tre doppi di fila: ${p.name} viene bannato!`);
          this.sendToJail(p);
          this.turn.canReroll = false;
          this.turn.phase = 'postRoll';
          return;
        }
      }
      this.turn.canReroll = isDouble;
      this.moveBy(p, a + b);
    }
    this.continueTurn();
  }

  continueTurn() {
    if (this.phase !== 'playing' || this.auction) return;
    const p = this.current();
    if (!p || p.bankrupt) return this.nextTurn();
    if (this.turn.pendingBuy != null) { this.turn.phase = 'awaitBuy'; return; }
    this.turn.phase = this.turn.canReroll && !p.inJail ? 'preRoll' : 'postRoll';
  }

  moveBy(p, steps) {
    const target = (p.position + steps + 40) % 40;
    if (steps > 0 && p.position + steps >= 40) this.passGo(p);
    p.position = target;
    this.land(p);
  }

  moveTo(p, target, opts = {}) {
    if (target < p.position) this.passGo(p);
    p.position = target;
    this.land(p, opts);
  }

  passGo(p) {
    p.cash += GO_SALARY;
    this.addLog(`${p.name} passa da PRESS START e incassa ${money(GO_SALARY)}`);
  }

  sendToJail(p) {
    p.position = JAIL_POS;
    p.inJail = true;
    p.jailTurns = 0;
    this.turn.canReroll = false;
    this.addLog(`🔨 ${p.name} finisce nella Game Over Zone`);
  }

  land(p, opts = {}) {
    const sq = SQUARES[p.position];
    switch (sq.type) {
      case 'gotojail': return this.sendToJail(p);
      case 'tax':
        this.addLog(`${p.name} paga ${sq.name}: ${money(sq.amount)}`);
        return this.pay(p, null, sq.amount, sq.name);
      case 'glitch':
      case 'powerup':
        return this.drawCard(p, sq.type);
      case 'street':
      case 'console':
      case 'utility': {
        const prop = this.props[p.position];
        if (!prop.ownerId) { this.turn.pendingBuy = p.position; return; }
        if (prop.ownerId === p.id) return;
        if (prop.mortgaged) { this.addLog(`${sq.name} è ipotecata: niente affitto`); return; }
        if (sq.type === 'utility' && opts.utilityTen && this.classic) {
          // regola classica: si tirano di nuovo i dadi e si paga 10× il risultato
          const [a, b] = this.rollDice();
          this.addLog(`${p.name} ritira i dadi per l'affitto: ${a} + ${b}`);
        }
        const rent = this.rentFor(p.position, opts);
        this.addLog(`${p.name} paga ${money(rent)} di affitto a ${this.name(prop.ownerId)} per ${sq.name}`);
        return this.pay(p, this.player(prop.ownerId), rent, `affitto ${sq.name}`);
      }
      default:
    }
  }

  rentFor(idx, opts = {}) {
    const sq = SQUARES[idx];
    const prop = this.props[idx];
    if (!prop.ownerId || prop.mortgaged) return 0;
    if (sq.type === 'street') {
      if (prop.houses > 0) return sq.rent[prop.houses];
      return sq.rent[0] * (this.ownsGroup(prop.ownerId, sq.group) ? 2 : 1);
    }
    if (sq.type === 'console') {
      const n = SQUARES.filter(s => s.type === 'console' && this.props[s.index].ownerId === prop.ownerId).length;
      return 25 * 2 ** (n - 1) * (opts.consoleDouble ? 2 : 1);
    }
    if (sq.type === 'utility') {
      const sum = this.dice ? this.dice.values[0] + this.dice.values[1] : 7;
      const both = SQUARES.filter(s => s.type === 'utility').every(s => this.props[s.index].ownerId === prop.ownerId);
      return sum * (opts.utilityTen || both ? 10 : 4);
    }
    return 0;
  }

  // ---------- carte ----------
  drawCard(p, deck) {
    const idx = this.decks[deck].shift();
    const card = DECKS[deck][idx];
    this.lastCard = { id: ++this.cardSeq, deck, text: card.text, playerId: p.id };
    this.addLog(`${deck === 'glitch' ? '⚡ Glitch' : '⭐ Power-Up'} per ${p.name}: ${card.text}`);
    const a = card.action;
    if (a.type === 'jailCard') p.jailCards.push(deck);
    else this.decks[deck].push(idx);

    switch (a.type) {
      case 'advance': return this.moveTo(p, a.to);
      case 'nearest': {
        let i = p.position;
        do { i = (i + 1) % 40; } while (SQUARES[i].type !== a.kind);
        return this.moveTo(p, i, a.kind === 'console' ? { consoleDouble: true } : { utilityTen: true });
      }
      case 'back': p.position = (p.position - a.steps + 40) % 40; return this.land(p);
      case 'money':
        if (a.amount >= 0) p.cash += a.amount;
        else this.pay(p, null, -a.amount, 'carta');
        return;
      case 'jail': return this.sendToJail(p);
      case 'repairs': {
        let total = 0;
        for (const i of this.ownedBy(p.id)) {
          const h = this.props[i].houses;
          total += h === 5 ? a.hotel : h * a.house;
        }
        if (total) { this.addLog(`${p.name} paga ${money(total)} di manutenzione`); this.pay(p, null, total, 'manutenzione'); }
        return;
      }
      case 'each':
        for (const o of this.alive()) {
          if (o.id === p.id) continue;
          if (a.amount > 0) this.pay(o, p, a.amount, 'carta');
          else this.pay(p, o, -a.amount, 'carta');
        }
        return;
      default:
    }
  }

  // ---------- pagamenti e debiti ----------
  pay(from, to, amount, reason) {
    if (amount <= 0) return;
    if (from.cash >= amount) {
      from.cash -= amount;
      if (to) to.cash += amount;
    } else {
      this.debts.push({ id: crypto.randomUUID().slice(0, 8), playerId: from.id, creditorId: to ? to.id : null, amount, reason });
      this.addLog(`💸 ${from.name} non ha abbastanza ${'₵'}: deve ${money(amount)} a ${to ? to.name : 'la banca'}`);
    }
  }

  payDebt(playerId) {
    this.requirePlaying();
    const debt = this.debts.find(d => d.playerId === playerId) || fail('Non hai debiti');
    const p = this.mustPlayer(playerId);
    if (p.cash < debt.amount) fail(`Ti mancano ${money(debt.amount - p.cash)}: vendi livelli o ipoteca proprietà`);
    p.cash -= debt.amount;
    if (debt.creditorId) this.player(debt.creditorId).cash += debt.amount;
    this.debts = this.debts.filter(d => d !== debt);
    this.addLog(`${p.name} salda il debito di ${money(debt.amount)}`);
  }

  bankrupt(playerId) {
    this.requirePlaying();
    const p = this.mustPlayer(playerId);
    if (p.bankrupt) fail('Sei già fuori');
    const debt = this.debts.find(d => d.playerId === playerId);
    const creditor = debt?.creditorId ? this.player(debt.creditorId) : null;

    // vendi tutte le costruzioni alla banca
    for (const i of this.ownedBy(p.id)) {
      const prop = this.props[i];
      if (prop.houses > 0) {
        const cost = GROUPS[SQUARES[i].group].houseCost;
        p.cash += Math.floor(cost / 2) * prop.houses;
        if (prop.houses === 5) this.hotelsLeft++; else this.housesLeft += prop.houses;
        prop.houses = 0;
      }
    }
    const owned = this.ownedBy(p.id);
    let toAuction = [];
    if (creditor && !creditor.bankrupt) {
      creditor.cash += p.cash;
      for (const i of owned) this.props[i].ownerId = creditor.id;
      creditor.jailCards.push(...p.jailCards);
      this.addLog(`☠️ ${p.name} va in bancarotta: tutto passa a ${creditor.name}`);
    } else {
      for (const i of owned) Object.assign(this.props[i], { ownerId: null, mortgaged: false });
      for (const d of p.jailCards) this.decks[d].push(DECKS[d].findIndex(c => c.action.type === 'jailCard'));
      if (this.classic && owned.length) {
        toAuction = owned;
        this.addLog(`☠️ ${p.name} va in bancarotta: la banca mette all'asta ${owned.length} proprietà`);
      } else {
        this.addLog(`☠️ ${p.name} va in bancarotta: le proprietà tornano alla banca`);
      }
    }
    this.returnBuildTokens(p);
    p.cash = 0;
    p.jailCards = [];
    p.bankrupt = true;
    p.inJail = false;
    this.debts = this.debts.filter(d => d.playerId !== p.id);
    for (const d of this.debts) if (d.creditorId === p.id) d.creditorId = null;
    this.trades = this.trades.filter(t => t.fromId !== p.id && t.toId !== p.id);

    if (this.alive().length <= 1) return this.finish();
    // regola classica: chi riceve proprietà ipotecate paga subito il 10% di interessi
    if (creditor && !creditor.bankrupt) this.chargeMortgageInterest(creditor, owned);

    if (this.auction) {
      if (this.auction.highBidderId === p.id) { this.auction.highBidderId = null; this.auction.highBid = this.auction.minBid - 1; }
      if (!this.auction.passed.includes(p.id)) this.auction.passed.push(p.id);
    }
    this.auctionQueue.push(...toAuction);
    if (this.auction) this.checkAuctionEnd();
    else if (this.auctionQueue.length) this.startAuction(this.auctionQueue.shift(), true);
    else if (this.turn.playerId === p.id) this.nextTurn();
  }

  chargeMortgageInterest(receiver, idxs) {
    if (!this.classic) return;
    const mortgaged = idxs.filter(i => this.props[i].mortgaged);
    const fee = mortgaged.reduce((s, i) => s + Math.round(SQUARES[i].price / 2 * 0.1), 0);
    if (!fee) return;
    // se le riscatta subito (entro questo turno) paga solo il capitale: il 10% è già stato pagato
    for (const i of mortgaged) this.props[i].interestPaid = true;
    this.addLog(`${receiver.name} paga ${money(fee)} di interessi sulle ipoteche ricevute (riscatto senza interessi fino a fine turno)`);
    this.pay(receiver, null, fee, 'interessi ipoteca');
  }

  unmortgageCost(idx) {
    const half = SQUARES[idx].price / 2;
    return this.props[idx].interestPaid ? half : Math.round(half * 1.1);
  }

  returnBuildTokens(p) {
    const { house, hotel } = p.buildTokens;
    if (!house && !hotel) return;
    this.housesLeft += house;
    this.hotelsLeft += hotel;
    p.buildTokens = { house: 0, hotel: 0 };
    this.addLog(`${p.name} non ha piazzato le costruzioni vinte all'asta: tornano alla banca`);
  }

  // ---------- acquisto e aste ----------
  buy(playerId) {
    this.requireTurn(playerId, 'awaitBuy');
    this.requireNoDebts();
    const p = this.current();
    const idx = this.turn.pendingBuy;
    const sq = SQUARES[idx];
    if (p.cash < sq.price) fail('Non hai abbastanza ₵: rifiuta per mandarla all\'asta');
    p.cash -= sq.price;
    this.props[idx].ownerId = p.id;
    this.turn.pendingBuy = null;
    this.addLog(`🏠 ${p.name} compra ${sq.name} per ${money(sq.price)}`);
    this.continueTurn();
  }

  decline(playerId) {
    this.requireTurn(playerId, 'awaitBuy');
    this.requireNoDebts();
    const idx = this.turn.pendingBuy;
    this.turn.pendingBuy = null;
    this.startAuction(idx, false);
  }

  // fromBank: asta della banca (bancarotta) → al termine il turno riprende dov'era
  startAuction(idx, fromBank) {
    if (fromBank && this.turn.phase !== 'auction' && this.turn.resumePhase == null) this.turn.resumePhase = this.turn.phase;
    this.turn.phase = 'auction';
    this.auction = {
      kind: 'property', propertyIdx: idx, fromBank,
      participants: this.alive().map(p => p.id),
      minBid: 1, highBid: 0, highBidderId: null, passed: [], endsAt: Date.now() + this.auctionMs * 2,
    };
    this.addLog(`🔨 Asta${fromBank ? ' della banca' : ''} per ${SQUARES[idx].name}!`);
    this.scheduleAuction();
  }

  // regola classica sulla scarsità: un livello / Boss Level conteso va all'asta tra chi può costruire
  startBuildingAuction(building, minBid, participants) {
    if (this.turn.phase !== 'auction' && this.turn.resumePhase == null) this.turn.resumePhase = this.turn.phase;
    this.turn.phase = 'auction';
    this.auction = {
      kind: 'building', building, propertyIdx: null, fromBank: true,
      participants, minBid, highBid: minBid - 1, highBidderId: null, passed: [], endsAt: Date.now() + this.auctionMs * 2,
    };
    const left = building === 'hotel' ? this.hotelsLeft : this.housesLeft;
    this.addLog(`🔨 ${building === 'hotel' ? 'Boss Level' : 'Livelli'} quasi esauriti (${left} in banca): asta per ${building === 'hotel' ? 'un Boss Level' : 'un livello'} da ${money(minBid)}!`);
    this.scheduleAuction();
  }

  // dove il giocatore può piazzare ora un livello ('house') o un Boss Level ('hotel'), ignorando la banca
  buildSpots(playerId, building) {
    return BUYABLE.filter(i => {
      const sq = SQUARES[i], prop = this.props[i];
      if (sq.type !== 'street' || prop.ownerId !== playerId || !this.ownsGroup(playerId, sq.group)) return false;
      const ms = groupMembers(sq.group);
      if (ms.some(k => this.props[k].mortgaged)) return false;
      if (prop.houses !== Math.min(...ms.map(k => this.props[k].houses))) return false;
      return building === 'hotel' ? prop.houses === 4 : prop.houses < 4;
    });
  }

  canBuildSomewhere(p, building) {
    if (p.bankrupt) return false;
    if (p.buildTokens[building] > 0) return false; // ha già una costruzione da piazzare
    return this.buildSpots(p.id, building).some(i => p.cash >= GROUPS[SQUARES[i].group].houseCost);
  }

  scheduleAuction() {
    if (!this.autoTimers) return;
    if (this.auctionTimer) clearTimeout(this.auctionTimer);
    const ms = Math.max(0, this.auction.endsAt - Date.now());
    this.auctionTimer = setTimeout(() => {
      this.auctionTimer = null;
      if (this.auction) { this.finishAuction(); this.onChange(); }
    }, ms);
  }

  bid(playerId, amount) {
    if (!this.auction) fail('Nessuna asta in corso');
    const p = this.mustPlayer(playerId);
    if (p.bankrupt) fail('Sei fuori dalla partita');
    if (!this.auction.participants.includes(p.id)) fail('Non partecipi a questa asta');
    if (this.auction.passed.includes(p.id)) fail('Hai già passato');
    amount = Math.floor(Number(amount));
    if (!(amount > this.auction.highBid)) fail(`L'offerta deve superare ${money(this.auction.highBid)}`);
    if (amount > p.cash) fail('Non hai abbastanza ₵');
    this.auction.highBid = amount;
    this.auction.highBidderId = p.id;
    this.auction.endsAt = Math.max(this.auction.endsAt, Date.now() + this.auctionMs);
    this.addLog(`${p.name} offre ${money(amount)}`);
    this.checkAuctionEnd() || this.scheduleAuction();
  }

  passAuction(playerId) {
    if (!this.auction) fail('Nessuna asta in corso');
    const p = this.mustPlayer(playerId);
    if (!this.auction.participants.includes(p.id)) fail('Non partecipi a questa asta');
    if (this.auction.passed.includes(p.id)) return;
    if (this.auction.highBidderId === p.id) fail('Sei il miglior offerente: aspetta la fine');
    this.auction.passed.push(p.id);
    this.addLog(`${p.name} passa`);
    this.checkAuctionEnd();
  }

  checkAuctionEnd() {
    const a = this.auction;
    const active = this.alive().filter(p => a.participants.includes(p.id) && !a.passed.includes(p.id));
    if (active.length === 0 || (active.length === 1 && active[0].id === a.highBidderId)) {
      this.finishAuction();
      return true;
    }
    return false;
  }

  finishAuction() {
    const a = this.auction;
    if (!a) return;
    if (this.auctionTimer) clearTimeout(this.auctionTimer);
    this.auctionTimer = null;
    this.auction = null;
    const sq = SQUARES[a.propertyIdx];
    const winner = a.highBidderId && this.player(a.highBidderId);
    if (a.kind === 'building') {
      const what = a.building === 'hotel' ? 'il Boss Level' : 'il livello';
      const left = a.building === 'hotel' ? this.hotelsLeft : this.housesLeft;
      if (winner && !winner.bankrupt && left > 0) {
        if (a.building === 'hotel') this.hotelsLeft--; else this.housesLeft--;
        winner.buildTokens[a.building]++;
        this.addLog(`🔨 ${winner.name} vince ${what} con ${money(a.highBid)}: piazzalo dalla scheda Proprietà entro fine turno`);
        this.pay(winner, null, a.highBid, `asta ${what}`);
      } else {
        this.addLog(`Nessuna offerta per ${what}`);
      }
    } else if (winner && !winner.bankrupt) {
      this.props[a.propertyIdx].ownerId = winner.id;
      this.addLog(`🔨 ${winner.name} vince l'asta per ${sq.name} con ${money(a.highBid)}`);
      this.pay(winner, null, a.highBid, `asta ${sq.name}`);
    } else {
      this.addLog(`Nessuna offerta: ${sq.name} resta alla banca`);
    }
    if (this.auctionQueue.length) return this.startAuction(this.auctionQueue.shift(), true);
    const resume = this.turn.resumePhase;
    delete this.turn.resumePhase;
    const cur = this.current();
    if (resume && resume !== 'auction' && cur && !cur.bankrupt) { this.turn.phase = resume; return; }
    this.continueTurn();
  }

  // ---------- prigione ----------
  payJail(playerId) {
    this.requireTurn(playerId, 'preRoll');
    const p = this.current();
    if (!p.inJail) fail('Non sei nella Game Over Zone');
    if (p.cash < JAIL_FINE) fail('Non hai abbastanza ₵');
    p.cash -= JAIL_FINE;
    p.inJail = false; p.jailTurns = 0;
    this.addLog(`${p.name} paga ${money(JAIL_FINE)} ed esce dalla Game Over Zone`);
  }

  useJailCard(playerId) {
    this.requireTurn(playerId, 'preRoll');
    const p = this.current();
    if (!p.inJail) fail('Non sei nella Game Over Zone');
    if (!p.jailCards.length) fail('Non hai carte CONTINUA');
    const deck = p.jailCards.pop();
    this.decks[deck].push(DECKS[deck].findIndex(c => c.action.type === 'jailCard'));
    p.inJail = false; p.jailTurns = 0;
    this.addLog(`${p.name} usa una carta CONTINUA ed esce`);
  }

  endTurn(playerId) {
    this.requireTurn(playerId, 'postRoll');
    this.requireNoDebts();
    this.nextTurn();
  }

  // ---------- costruzioni e ipoteche ----------
  ownStreet(playerId, idx) {
    this.requirePlaying();
    const sq = SQUARES[idx];
    if (!sq || !this.props[idx]) fail('Casella non valida');
    if (this.props[idx].ownerId !== playerId) fail('Non è tua');
    return sq;
  }

  build(playerId, idx) {
    const sq = this.ownStreet(playerId, idx);
    if (sq.type !== 'street') fail('Qui non si costruisce');
    if (!this.ownsGroup(playerId, sq.group)) fail('Ti serve tutto il gruppo di colore');
    const members = groupMembers(sq.group);
    if (members.some(i => this.props[i].mortgaged)) fail('Nel gruppo c\'è una proprietà ipotecata');
    const prop = this.props[idx];
    if (prop.houses >= 5) fail('C\'è già un Boss Level');
    if (prop.houses > Math.min(...members.map(i => this.props[i].houses))) fail('Costruisci in modo uniforme sul gruppo');
    this.requireNoAuction();
    const p = this.player(playerId);
    const cost = GROUPS[sq.group].houseCost;
    const building = prop.houses === 4 ? 'hotel' : 'house';
    const what = building === 'hotel' ? 'un Boss Level' : 'un livello';

    if (p.buildTokens[building] > 0) {
      // costruzione già vinta (e pagata) all'asta
      p.buildTokens[building]--;
      if (building === 'hotel') this.housesLeft += 4;
      prop.houses++;
      this.addLog(`${p.name} piazza ${what} vinto all'asta su ${sq.name}`);
      return;
    }

    if (p.cash < cost) fail('Non hai abbastanza ₵');
    const left = building === 'hotel' ? this.hotelsLeft : this.housesLeft;
    if (!left) fail(building === 'hotel' ? 'Boss Level esauriti' : 'Livelli esauriti');

    if (this.classic && left <= (building === 'hotel' ? SHORTAGE_HOTELS : SHORTAGE_HOUSES)) {
      const rivals = this.alive().filter(o => o.id !== p.id && this.canBuildSomewhere(o, building));
      if (rivals.length) return this.startBuildingAuction(building, cost, [p.id, ...rivals.map(o => o.id)]);
    }

    if (building === 'hotel') { this.hotelsLeft--; this.housesLeft += 4; } else this.housesLeft--;
    p.cash -= cost;
    prop.houses++;
    this.addLog(`${p.name} costruisce ${what} su ${sq.name}`);
  }

  sell(playerId, idx) {
    const sq = this.ownStreet(playerId, idx);
    const prop = this.props[idx];
    if (sq.type !== 'street' || prop.houses === 0) fail('Niente da vendere');
    const members = groupMembers(sq.group);
    if (prop.houses < Math.max(...members.map(i => this.props[i].houses))) fail('Vendi in modo uniforme sul gruppo');
    const p = this.player(playerId);
    const half = Math.floor(GROUPS[sq.group].houseCost / 2);
    if (prop.houses === 5) {
      this.hotelsLeft++;
      if (this.housesLeft >= 4) { this.housesLeft -= 4; prop.houses = 4; p.cash += half; }
      else if (this.classic) {
        // regola classica: il Boss Level si scompone in tutti i livelli che la banca ha, il resto si vende
        const k = this.housesLeft;
        this.housesLeft = 0;
        prop.houses = k;
        p.cash += half * (1 + 4 - k);
        this.addLog(`La banca ha solo ${k} livelli: il Boss Level di ${sq.name} diventa ${k} livelli`);
      } else { prop.houses = 0; p.cash += half * 5; }
    } else {
      prop.houses--; this.housesLeft++; p.cash += half;
    }
    this.addLog(`${p.name} vende una costruzione su ${sq.name}`);
  }

  mortgage(playerId, idx) {
    const sq = this.ownStreet(playerId, idx);
    const prop = this.props[idx];
    if (prop.mortgaged) fail('Già ipotecata');
    if (sq.type === 'street' && this.groupHasBuildings(sq.group)) fail('Vendi prima le costruzioni del gruppo');
    prop.mortgaged = true;
    delete prop.interestPaid;
    const p = this.player(playerId);
    p.cash += sq.price / 2;
    this.addLog(`${p.name} ipoteca ${sq.name} (+${money(sq.price / 2)})`);
  }

  unmortgage(playerId, idx) {
    const sq = this.ownStreet(playerId, idx);
    const prop = this.props[idx];
    if (!prop.mortgaged) fail('Non è ipotecata');
    const cost = this.unmortgageCost(idx);
    const p = this.player(playerId);
    if (p.cash < cost) fail(`Servono ${money(cost)}`);
    p.cash -= cost;
    prop.mortgaged = false;
    delete prop.interestPaid;
    this.addLog(`${p.name} riscatta ${sq.name} (−${money(cost)})`);
  }

  // ---------- scambi ----------
  normalizeSide(s = {}) {
    return {
      cash: Math.max(0, Math.floor(Number(s.cash) || 0)),
      props: [...new Set((s.props || []).map(Number))],
      jailCards: Math.max(0, Math.floor(Number(s.jailCards) || 0)),
    };
  }

  validateSide(p, side) {
    if (p.cash < side.cash) fail(`${p.name} non ha ${money(side.cash)}`);
    if (p.jailCards.length < side.jailCards) fail(`${p.name} non ha abbastanza carte CONTINUA`);
    for (const i of side.props) {
      if (!this.props[i] || this.props[i].ownerId !== p.id) fail(`${SQUARES[i]?.name ?? 'Proprietà'} non è di ${p.name}`);
      const sq = SQUARES[i];
      if (sq.type === 'street' && this.groupHasBuildings(sq.group)) fail(`Vendi prima le costruzioni del gruppo ${GROUPS[sq.group].name}`);
    }
  }

  proposeTrade(playerId, { toId, offer, request }) {
    this.requirePlaying();
    const from = this.mustPlayer(playerId);
    const to = this.mustPlayer(toId);
    if (from === to || from.bankrupt || to.bankrupt) fail('Scambio non valido');
    offer = this.normalizeSide(offer);
    request = this.normalizeSide(request);
    const empty = s => !s.cash && !s.props.length && !s.jailCards;
    if (empty(offer) && empty(request)) fail('Lo scambio è vuoto');
    this.validateSide(from, offer);
    this.validateSide(to, request);
    const t = { id: crypto.randomUUID().slice(0, 8), fromId: from.id, toId: to.id, offer, request };
    this.trades.push(t);
    this.addLog(`🤝 ${from.name} propone uno scambio a ${to.name}`);
    return t;
  }

  respondTrade(playerId, tradeId, accept) {
    this.requirePlaying();
    const t = this.trades.find(x => x.id === tradeId) || fail('Scambio non trovato');
    if (t.toId !== playerId) fail('Non puoi rispondere a questo scambio');
    const from = this.player(t.fromId), to = this.player(t.toId);
    if (!accept) {
      this.trades = this.trades.filter(x => x !== t);
      this.addLog(`${to.name} rifiuta lo scambio di ${from.name}`);
      return;
    }
    this.validateSide(from, t.offer);
    this.validateSide(to, t.request);
    const move = (a, b, side) => {
      a.cash -= side.cash; b.cash += side.cash;
      for (const i of side.props) this.props[i].ownerId = b.id;
      for (let k = 0; k < side.jailCards; k++) b.jailCards.push(a.jailCards.pop());
    };
    move(from, to, t.offer);
    move(to, from, t.request);
    this.trades = this.trades.filter(x => x !== t);
    // gli altri scambi potrebbero non essere più validi: verranno controllati all'accettazione
    this.addLog(`🤝 Scambio concluso tra ${from.name} e ${to.name}`);
    this.chargeMortgageInterest(to, t.offer.props);
    this.chargeMortgageInterest(from, t.request.props);
  }

  cancelTrade(playerId, tradeId) {
    const t = this.trades.find(x => x.id === tradeId) || fail('Scambio non trovato');
    if (t.fromId !== playerId) fail('Non è un tuo scambio');
    this.trades = this.trades.filter(x => x !== t);
  }

  // ---------- dispatcher ----------
  act(playerId, a = {}) {
    if (!playerId) fail('Non sei in partita');
    switch (a.type) {
      case 'start':
        if (this.host()?.id !== playerId) fail('Solo il primo giocatore (o il tabellone) può avviare');
        return this.start();
      case 'settings':
        if (this.host()?.id !== playerId) fail('Solo il primo giocatore (o il tabellone) può cambiare le impostazioni');
        return this.setSettings(a.settings);
      case 'leave': return this.leave(playerId);
      case 'roll': return this.roll(playerId);
      case 'buy': return this.buy(playerId);
      case 'decline': return this.decline(playerId);
      case 'bid': return this.bid(playerId, a.amount);
      case 'pass': return this.passAuction(playerId);
      case 'payJail': return this.payJail(playerId);
      case 'useJailCard': return this.useJailCard(playerId);
      case 'endTurn': return this.endTurn(playerId);
      case 'build': return this.build(playerId, a.idx);
      case 'sell': return this.sell(playerId, a.idx);
      case 'mortgage': return this.mortgage(playerId, a.idx);
      case 'unmortgage': return this.unmortgage(playerId, a.idx);
      case 'payDebt': return this.payDebt(playerId);
      case 'bankrupt': return this.bankrupt(playerId);
      case 'proposeTrade': return this.proposeTrade(playerId, a);
      case 'respondTrade': return this.respondTrade(playerId, a.tradeId, !!a.accept);
      case 'cancelTrade': return this.cancelTrade(playerId, a.tradeId);
      default: fail('Azione sconosciuta');
    }
  }

  getState() {
    return {
      phase: this.phase,
      players: this.players.map(({ key, jailCards, ...p }) => ({ ...p, jailCards: jailCards.length })),
      props: this.props,
      turn: this.turn,
      auction: this.auction && { ...this.auction, remainingMs: Math.max(0, this.auction.endsAt - Date.now()) },
      trades: this.trades,
      debts: this.debts,
      log: this.log.slice(-40),
      lastCard: this.lastCard,
      dice: this.dice,
      winnerId: this.winnerId,
      housesLeft: this.housesLeft,
      hotelsLeft: this.hotelsLeft,
      settings: this.settings,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    };
  }
}

module.exports = { Game, GameError, TOKENS, START_CASH, GO_SALARY, JAIL_POS, JAIL_FINE, DIFFICULTIES };
