// Mazzi originali: "Glitch" (eventi casuali) e "Power-Up" (bonus/malus della community).
// Azioni:
//  advance {to}            vai alla casella (incassi PRESS START se la passi)
//  nearest {kind}          vai alla console/utility più vicina (affitto speciale)
//  back {steps}            torna indietro
//  money {amount}          +incassi / -paghi alla banca
//  jail                    vai nella Game Over Zone
//  jailCard                carta "Continua" (esci gratis)
//  repairs {house, hotel}  paga per ogni livello / boss level
//  each {amount}           +ricevi da ogni giocatore / -paghi a ogni giocatore

const GLITCH = [
  { text: 'Speedrun! Vai direttamente a PRESS START.', action: { type: 'advance', to: 0 } },
  { text: 'Teletrasporto glitchato: vai a Cimitero dei Salvataggi.', action: { type: 'advance', to: 24 } },
  { text: 'Warp zone: vai al Dojo Neon.', action: { type: 'advance', to: 11 } },
  { text: 'Sei attratto dal router: vai alla utility più vicina. Se è di un altro giocatore paghi 10× i dadi.', action: { type: 'nearest', kind: 'utility' } },
  { text: 'Lag di rete: vai alla console più vicina. Se è di un altro giocatore paghi il doppio.', action: { type: 'nearest', kind: 'console' } },
  { text: 'Lag di rete: vai alla console più vicina. Se è di un altro giocatore paghi il doppio.', action: { type: 'nearest', kind: 'console' } },
  { text: 'Bug di duplicazione monete: ricevi 50 ₵.', action: { type: 'money', amount: 50 } },
  { text: 'Checkpoint segreto: carta CONTINUA, esci gratis dalla Game Over Zone.', action: { type: 'jailCard' } },
  { text: 'Rollback del server: torna indietro di 3 caselle.', action: { type: 'back', steps: 3 } },
  { text: 'Segnalato per cheating! Vai nella Game Over Zone senza passare da PRESS START.', action: { type: 'jail' } },
  { text: 'Patch obbligatoria: paga 25 ₵ per ogni livello e 100 ₵ per ogni Boss Level.', action: { type: 'repairs', house: 25, hotel: 100 } },
  { text: 'Hai rotto il controller per la rabbia: paga 15 ₵.', action: { type: 'money', amount: -15 } },
  { text: 'Nostalgia: vai a Console Retrò.', action: { type: 'advance', to: 5 } },
  { text: 'Fast travel: vai a Isola Leggendaria.', action: { type: 'advance', to: 39 } },
  { text: 'Sei il capitano del clan: paga 50 ₵ a ogni giocatore.', action: { type: 'each', amount: -50 } },
  { text: 'Il tuo mod è diventato virale: ricevi 150 ₵.', action: { type: 'money', amount: 150 } },
];

const POWERUP = [
  { text: 'Turbo! Vai a PRESS START.', action: { type: 'advance', to: 0 } },
  { text: 'Errore della banca a tuo favore: ricevi 200 ₵.', action: { type: 'money', amount: 200 } },
  { text: 'Pozioni di cura per tutto il party: paga 50 ₵.', action: { type: 'money', amount: -50 } },
  { text: 'Hai venduto skin rare: ricevi 50 ₵.', action: { type: 'money', amount: 50 } },
  { text: 'Vita extra: carta CONTINUA, esci gratis dalla Game Over Zone.', action: { type: 'jailCard' } },
  { text: 'Ban per linguaggio tossico: vai nella Game Over Zone.', action: { type: 'jail' } },
  { text: 'Hai vinto un torneo locale: ricevi 100 ₵.', action: { type: 'money', amount: 100 } },
  { text: 'Rimborso di un DLC: ricevi 20 ₵.', action: { type: 'money', amount: 20 } },
  { text: 'È il tuo compleanno in gilda: ricevi 10 ₵ da ogni giocatore.', action: { type: 'each', amount: 10 } },
  { text: 'Bonus fedeltà: ricevi 100 ₵.', action: { type: 'money', amount: 100 } },
  { text: 'Bolletta della connessione in fibra: paga 100 ₵.', action: { type: 'money', amount: -100 } },
  { text: 'Abbonamento al cloud saving: paga 50 ₵.', action: { type: 'money', amount: -50 } },
  { text: 'Consulenza come beta tester: ricevi 25 ₵.', action: { type: 'money', amount: 25 } },
  { text: 'Manutenzione server: paga 40 ₵ per livello e 115 ₵ per Boss Level.', action: { type: 'repairs', house: 40, hotel: 115 } },
  { text: 'Secondo posto in classifica: ricevi 10 ₵.', action: { type: 'money', amount: 10 } },
  { text: 'Achievement sbloccato: ricevi 100 ₵.', action: { type: 'money', amount: 100 } },
];

module.exports = { DECKS: { glitch: GLITCH, powerup: POWERUP } };
