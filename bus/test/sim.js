// Headless bot-vs-bot simulation: plays full games and checks engine invariants.
// Usage: node bus/test/sim.js [games] [--random]   (--random makes player 1 pick random options)
'use strict';
require('../js/engine.js');
require('../js/ai.js');
const G = globalThis.BUS;

const games = parseInt(process.argv[2] || '5', 10);
const randomOpp = process.argv.includes('--random');

function check(s) {
  let pax = s.paxSupply;
  for (const st of s.stations) { if (s.stationPax[st] < 0) throw new Error('negative station pax'); pax += s.stationPax[st]; }
  for (const x of s.sites) { if (x.pax && !x.b) throw new Error('passenger on empty site'); if (x.pax) pax++; }
  if (pax !== 30) throw new Error('passenger count drifted: ' + pax);
  s.players.forEach((pl, p) => {
    if (pl.markers < 0) throw new Error('negative markers');
    if (pl.buses < 1 || pl.buses > G.MAX_BUSES) throw new Error('bad buses');
    if (new Set(pl.line).size !== pl.line.length) throw new Error('line revisits a node');
    for (let i = 1; i < pl.line.length; i++) {
      const a = pl.line[i - 1], b = pl.line[i];
      const e = s.edges.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
      if (!e || !e.lines.includes(p)) throw new Error('line not contiguous');
    }
    if (pl.lineEdges.length !== Math.max(0, pl.line.length - 1)) throw new Error('edge count mismatch');
  });
}

const t0 = Date.now();
let rounds = 0;
const wins = {};
for (let g = 0; g < games; g++) {
  const n = 3 + (g % 3);
  const players = [...Array(n).keys()].map((i) => ({ name: (randomOpp && i === 1 ? 'Random' : 'Bot ') + i, ai: true }));
  const s = G.newGame({ seed: 500 + g, players });
  let steps = 0;
  while (!s.gameOver) {
    const d = s.decision;
    const i = randomOpp && d.player === 1 ? Math.floor(Math.random() * d.options.length) : G.aiChoose(s);
    G.choose(s, i);
    check(s);
    if (++steps > 20000) throw new Error('game did not end');
  }
  rounds += s.round;
  const r = G.ranking(s);
  wins[r[0].name] = (wins[r[0].name] || 0) + 1;
  console.log('game ' + (g + 1) + ' (' + n + 'p, ' + s.round + ' rounds): ' + r.map((x) => x.name + ' ' + x.total).join(', '));
}
console.log('avg rounds ' + (rounds / games).toFixed(1) + ', ' + (Date.now() - t0) + ' ms; wins ' + JSON.stringify(wins));
