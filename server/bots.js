// Esegue le mosse dei bot: un'azione alla volta, con un piccolo ritardo per renderle visibili sul tabellone.
const { GameError } = require('./game');
const { decide, fallback } = require('./bot-brain');

const DELAYS = { slow: 1600, normal: 900, fast: 350 };

class BotManager {
  constructor(game, { onChange = () => {}, rng = Math.random, log = console.warn } = {}) {
    this.game = game;
    this.onChange = onChange;
    this.rng = rng;
    this.log = log;
    this.timer = null;
    this.memory = new Map();
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.memory.clear();
  }

  mem(id) {
    if (!this.memory.has(id)) this.memory.set(id, {});
    return this.memory.get(id);
  }

  bots() { return this.game.players.filter(p => p.isBot && !p.bankrupt); }

  // da chiamare dopo ogni cambiamento di stato
  kick() {
    if (this.timer || this.game.phase !== 'playing' || !this.bots().length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.step()) this.onChange(); // onChange → broadcast → kick() di nuovo
    }, DELAYS[this.game.settings.botSpeed] ?? DELAYS.normal);
  }

  // fa agire al massimo un bot; true se qualcosa è cambiato
  step() {
    const g = this.game;
    if (g.phase !== 'playing') return false;
    for (const bot of this.bots()) {
      const mem = this.mem(bot.id);
      if (mem.failedTurn !== g.turnCount) { mem.failedTurn = g.turnCount; mem.failed = new Set(); }
      let action = decide(g, bot.id, mem, this.rng);
      if (!action) continue;
      if (mem.failed.has(JSON.stringify(action))) action = fallback(g, bot.id);
      if (!action) continue;
      try {
        g.act(bot.id, action);
        if (action.type === 'build' && g.auction?.kind === 'building') {
          if (mem.buildAuctionTurn !== g.turnCount) { mem.buildAuctionTurn = g.turnCount; mem.buildAuctions = 0; }
          mem.buildAuctions++;
        }
        return true;
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
        mem.failed.add(JSON.stringify(action));
        this.log(`[bot ${bot.name}] azione ${action.type} rifiutata: ${e.message}`);
        const fb = fallback(g, bot.id);
        if (fb && JSON.stringify(fb) !== JSON.stringify(action)) {
          try { g.act(bot.id, fb); return true; } catch (e2) {
            if (!(e2 instanceof GameError)) throw e2;
            mem.failed.add(JSON.stringify(fb));
          }
        }
      }
    }
    return false;
  }

  // per i test: gioca senza timer finché i bot hanno qualcosa da fare
  runSync(maxSteps = 100000) {
    let steps = 0;
    while (steps < maxSteps && this.game.phase === 'playing') {
      if (!this.step()) {
        // nessun bot ha agito: se c'è un'asta in attesa del timer, chiudila
        if (this.game.auction) { this.game.finishAuction(); continue; }
        break;
      }
      steps++;
    }
    return steps;
  }
}

module.exports = { BotManager, DELAYS };
