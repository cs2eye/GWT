// Headless AI-vs-AI simulation: plays full games and checks engine invariants.
// Usage: node test/sim.js [games] [--random]   (--random makes player 2 pick random options)
'use strict';
globalThis.window = {};
require('../js/data.js');
require('../js/engine.js');
require('../js/ai.js');
const G = window.GWT;

const games = parseInt(process.argv[2] || '3', 10);
const randomOpp = process.argv.includes('--random');

function check(s) {
  for (const pl of s.players) {
    if (pl.money < 0) throw new Error('negative money ' + pl.name + ' ' + pl.money);
    if (pl.certs < 0 || pl.certs > G.certMax(pl)) throw new Error('bad certs ' + pl.certs);
    const n = pl.deck.length + pl.hand.length + pl.discard.length;
    if (n <= 0) throw new Error('no cards');
  }
}

let wins = [0, 0], totalTurns = 0;
const t0 = Date.now();
let decisions = 0, aiTime = 0;
for (let g = 0; g < games; g++) {
  const s = G.newGame({ seed: 1000 + g, players: [{ name: 'AI-1', ai: true }, { name: randomOpp ? 'Random' : 'AI-2', ai: true }] });
  while (!s.gameOver) {
    const d = s.decision;
    let i;
    const a = Date.now();
    if (randomOpp && d.player === 1) i = Math.floor(Math.random() * d.options.length);
    else i = G.aiChoose(s);
    aiTime += Date.now() - a;
    decisions++;
    G.choose(s, i);
    check(s);
  }
  const sc = s.players.map((_, p) => G.score(s, p));
  totalTurns += s.turnCount;
  if (sc[0].total >= sc[1].total) wins[0]++; else wins[1]++;
  console.log('game', g, 'turns', s.turnCount, 'scores', sc.map((x) => x.total).join(' vs '));
  if (g === 0) {
    console.log(JSON.stringify(sc));
    for (const pl of s.players) console.log(pl.name, 'cities', JSON.stringify(pl.cities), 'workers', JSON.stringify(pl.workers), 'engine', pl.engine, 'unlocks', Object.keys(pl.unlocks).join(','), 'money', pl.money);
  }
}
console.log('wins', wins, 'avg turns', (totalTurns / games).toFixed(1), 'ms/decision', (aiTime / decisions).toFixed(1), 'total s', ((Date.now() - t0) / 1000).toFixed(1));
if (randomOpp && wins[0] < games) { console.error('FAIL: AI lost to a random player'); process.exit(1); }
