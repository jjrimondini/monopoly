// Utilità condivise tra tabellone e controller
window.PE = {
  money: n => `${n} ₵`,
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  diceFace(n) {
    const pips = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[n] || [];
    let html = '<div class="die">';
    for (let i = 1; i <= 9; i++) html += `<span class="${pips.includes(i) ? 'pip' : ''}"></span>`;
    return html + '</div>';
  },
  typeIcon: { go: '▶', console: '🎮', utility: '⚡', tax: '💳', glitch: '⚡', powerup: '⭐', jail: '💀', parking: '⏸', gotojail: '🔨' },
  // descrizione breve dell'affitto di una casella
  rentInfo(sq, groups) {
    if (sq.type === 'street') return `Affitto ${sq.rent[0]} · Livello ${groups[sq.group].houseCost}`;
    if (sq.type === 'console') return 'Affitto 25/50/100/200 in base alle console possedute';
    if (sq.type === 'utility') return 'Affitto 4× i dadi (10× se possiedi entrambe)';
    return '';
  },
};
