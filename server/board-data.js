// Tabellone originale "Pixel Empire" — 40 caselle a tema videogiochi.
// Tipi: go, street, console, utility, tax, glitch, powerup, jail, parking, gotojail

const GROUPS = {
  arcade:   { name: 'Arcade Anni \'80', color: '#8d5a3b', houseCost: 50 },
  platform: { name: 'Platform 8-bit',   color: '#5ec8f2', houseCost: 50 },
  fighting: { name: 'Picchiaduro',      color: '#e0529c', houseCost: 100 },
  racing:   { name: 'Racing',           color: '#f39b2c', houseCost: 100 },
  horror:   { name: 'Horror Survival',  color: '#e23b3b', houseCost: 150 },
  scifi:    { name: 'Sparatutto Sci-Fi', color: '#f2d43b', houseCost: 150 },
  rpg:      { name: 'RPG Fantasy',      color: '#3bb55a', houseCost: 200 },
  open:     { name: 'Open World',       color: '#3b5ee2', houseCost: 200 },
};

const st = (name, group, price, rent) => ({ type: 'street', name, group, price, rent });

const SQUARES = [
  { type: 'go', name: 'PRESS START' },
  st('Vicolo dei Cabinati', 'arcade', 60, [2, 10, 30, 90, 160, 250]),
  { type: 'powerup', name: 'Power-Up' },
  st('Sala Gettoni', 'arcade', 60, [4, 20, 60, 180, 320, 450]),
  { type: 'tax', name: 'Microtransazione', amount: 200 },
  { type: 'console', name: 'Console Retrò', price: 200 },
  st('Nuvole Saltellanti', 'platform', 100, [6, 30, 90, 270, 400, 550]),
  { type: 'glitch', name: 'Glitch' },
  st('Torre dei Blocchi', 'platform', 100, [6, 30, 90, 270, 400, 550]),
  st('Grotta delle Monete', 'platform', 120, [8, 40, 100, 300, 450, 600]),
  { type: 'jail', name: 'Game Over Zone' },
  st('Dojo Neon', 'fighting', 140, [10, 50, 150, 450, 625, 750]),
  { type: 'utility', name: 'Rete Elettrica', price: 150 },
  st('Arena del Torneo', 'fighting', 140, [10, 50, 150, 450, 625, 750]),
  st('Tetto della Combo', 'fighting', 160, [12, 60, 180, 500, 700, 900]),
  { type: 'console', name: 'Console Portatile', price: 200 },
  st('Pista Neon', 'racing', 180, [14, 70, 200, 550, 750, 950]),
  { type: 'powerup', name: 'Power-Up' },
  st('Circuito Turbo', 'racing', 180, [14, 70, 200, 550, 750, 950]),
  st('Box del Nitro', 'racing', 200, [16, 80, 220, 600, 800, 1000]),
  { type: 'parking', name: 'Pausa' },
  st('Villa Abbandonata', 'horror', 220, [18, 90, 250, 700, 875, 1050]),
  { type: 'glitch', name: 'Glitch' },
  st('Laboratorio Zombie', 'horror', 220, [18, 90, 250, 700, 875, 1050]),
  st('Cimitero dei Salvataggi', 'horror', 240, [20, 100, 300, 750, 925, 1100]),
  { type: 'console', name: 'Console Next-Gen', price: 200 },
  st('Stazione Orbitale', 'scifi', 260, [22, 110, 330, 800, 975, 1150]),
  st('Base Lunare', 'scifi', 260, [22, 110, 330, 800, 975, 1150]),
  { type: 'utility', name: 'Server Farm', price: 150 },
  st('Hangar Plasma', 'scifi', 280, [24, 120, 360, 850, 1025, 1200]),
  { type: 'gotojail', name: 'Ban Hammer' },
  st('Taverna del Respawn', 'rpg', 300, [26, 130, 390, 900, 1100, 1275]),
  st('Foresta degli Elfi', 'rpg', 300, [26, 130, 390, 900, 1100, 1275]),
  { type: 'powerup', name: 'Power-Up' },
  st('Dungeon di Cristallo', 'rpg', 320, [28, 150, 450, 1000, 1200, 1400]),
  { type: 'console', name: 'Visore VR', price: 200 },
  { type: 'glitch', name: 'Glitch' },
  st('Metropoli Infinita', 'open', 350, [35, 175, 500, 1100, 1300, 1500]),
  { type: 'tax', name: 'Abbonamento Premium', amount: 100 },
  st('Isola Leggendaria', 'open', 400, [50, 200, 600, 1400, 1700, 2000]),
];

SQUARES.forEach((s, i) => { s.index = i; });

const BUYABLE = SQUARES.filter(s => s.price).map(s => s.index);
const groupMembers = g => SQUARES.filter(s => s.group === g).map(s => s.index);

module.exports = { SQUARES, GROUPS, BUYABLE, groupMembers };
