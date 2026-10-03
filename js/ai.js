// Automated opponent. For every option of the pending decision the AI clones the state,
// re-shuffles hidden information (so it cannot peek at deck order), applies the option and
// plays out the rest of its own turn greedily with a shallow look-ahead. The resulting
// positions are compared with a heuristic evaluation.
(function (G) {
  'use strict';

  let PROGRESS = 0; // game progress (0..1) fixed at the root of a search

  function evaluate(s, p) {
    const pl = s.players[p];
    const prog = PROGRESS;
    const early = 1 - prog;
    const sc = G.score(s, p);
    let v = sc.total - sc.money - sc.objectives;
    v += pl.money * (s.endTrigger !== null ? 0.2 : 0.3);

    for (const o of pl.objectives) {
      const d = G.objDef(o.id);
      const st = G.objectiveStat(s, p, d.stat);
      if (st >= d.n) v += d.vp;
      else v += -d.pen * (0.3 + 0.7 * prog) + d.vp * 0.5 * early * (st / d.n);
    }

    v += pl.certs * (0.5 + 0.3 * early);
    v += pl.permCerts * 1.5 * early;

    for (const w of G.WORKER_TYPES) {
      const n = pl.workers[w];
      for (let k = 2; k <= n; k++) v += (k <= 4 ? 3.2 : 2.0) * early;
    }
    // having 5 of a type makes the 6th (worth 4 VP) reachable
    v += pl.engine * 0.28 * (1 - 0.5 * prog);

    for (const u in pl.unlocks) v += G.UNLOCKS[u].value * (1 - 0.7 * prog);

    // deck quality: bought cattle raise future delivery values
    for (const c of G.allCards(pl)) {
      const b = G.BREEDS[c.breed];
      if (b.vp > 0) v += (b.value - 2) * 0.9 * early;
    }
    v += pl.removed * 0.5 * early;
    v += G.ownBuildings(s, p).length * 1.0 * early;

    // keep a strong hand when close to Kansas City
    if (pl.location !== 'start') {
      const frac = G.TRAIL_ORDER.indexOf(pl.location) / G.TRAIL_ORDER.length;
      v += G.handValue(pl.hand) * 0.45 * frac;
    }
    return v;
  }
  G.aiEvaluate = evaluate;

  function scramble(s, p) {
    // Hide information the AI should not know: deck orders, market deck, foresight stacks.
    s.seed = (Math.random() * 2 ** 31) | 0;
    for (const pl of s.players) G.shuffle(s, pl.deck);
    G.shuffle(s, s.marketDeck);
    for (const st of s.stacks) G.shuffle(s, st);
    G.shuffle(s, s.objDeck);
  }

  function apply(s, i) {
    const c = G.clone(s);
    G.choose(c, i);
    return c;
  }

  // Value of a state where `p` may still have decisions pending, looking `depth` choices ahead.
  function lookahead(s, p, depth) {
    if (depth <= 0 || !s.decision || s.halted || s.gameOver || s.decision.player !== p) return evaluate(s, p);
    let best = -Infinity;
    const n = Math.min(s.decision.options.length, 14);
    for (let i = 0; i < n; i++) best = Math.max(best, lookahead(apply(s, i), p, depth - 1));
    return best;
  }

  function greedyIndex(s, p, depth) {
    const opts = s.decision.options;
    if (opts.length === 1) return 0;
    let best = -Infinity, bi = 0;
    for (let i = 0; i < opts.length; i++) {
      const v = lookahead(apply(s, i), p, depth - 1);
      if (v > best + 1e-9) { best = v; bi = i; }
    }
    return bi;
  }

  function rollout(s, p) {
    let steps = 0;
    while (s.decision && !s.halted && !s.gameOver && s.decision.player === p && steps++ < 30) {
      G.choose(s, greedyIndex(s, p, 2));
    }
    return evaluate(s, p);
  }

  G.aiChoose = function (state) {
    const d = state.decision;
    const p = d.player;
    if (d.options.length === 1) return 0;
    PROGRESS = state.job.placed / state.job.slots.length;
    const base = G.clone(state);
    base.log = [];
    base.simHalt = true;
    scramble(base, p);
    let best = -Infinity, bi = 0;
    for (let i = 0; i < d.options.length; i++) {
      const c = apply(base, i);
      const v = rollout(c, p) + Math.random() * 0.01; // tiny noise to break ties
      if (v > best) { best = v; bi = i; }
    }
    return bi;
  };
})(typeof window !== 'undefined' ? window.GWT : module.exports);
