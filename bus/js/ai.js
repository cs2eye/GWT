// Automated opponents. Each decision type has a heuristic: placement weighs every open action
// area by its expected payoff in VP (deliveries now, a better network later) against the cost of
// spending one of the 20 markers; the follow-up choices (where to extend, build, drop passengers)
// greedily favour the bot's own line and avoid feeding its rivals' lines.
(function (G) {
  'use strict';

  const nextType = (s) => G.TYPES[(s.clock + 1) % 3];

  function onLineSets(s) { return s.players.map((pl) => new Set(pl.line)); }

  // how attractive an intersection is to have on player p's line
  function nodeValue(s, p, node, lines) {
    let v = 0;
    const n = s.nodes[node];
    if (n.station) v += 1.6 + 0.35 * s.stationPax[node];
    for (const x of s.sites) {
      if (x.node !== node) continue;
      if (x.b) {
        v += 1.0;
        if (x.pax) v += 0.3;
        const mine = s.sites.filter((y) => y.b === x.b && lines[p].has(y.node)).length;
        if (mine === 0) v += 0.6;
      } else {
        v += [0, 0.7, 0.45, 0.25][x.zone];
      }
    }
    return v;
  }

  function deliverable(s, p, type) {
    const pl = s.players[p];
    return Math.min(pl.buses, G.sources(s, p, type).length, G.destinations(s, p, type).length);
  }

  function lineGain(s, p, k) {
    // greedy look at the best k sections from the current ends
    const pl = s.players[p];
    const lines = onLineSets(s);
    const used = new Set(pl.line);
    let ends = G.lineEnds(pl).slice(), total = 0;
    for (let i = 0; i < k; i++) {
      let best = null;
      for (const end of ends) for (const eid of s.adj[end]) {
        const to = G.other(s.edges[eid], end);
        if (used.has(to)) continue;
        const v = nodeValue(s, p, to, lines) - (s.edges[eid].lines.length ? 0.3 : 0);
        if (!best || v > best.v) best = { v, to, end };
      }
      if (!best) break;
      total += best.v;
      used.add(best.to);
      ends = ends.map((e) => (e === best.end ? best.to : e));
    }
    return total;
  }

  function placementValue(s, p, o) {
    const pl = s.players[p];
    const sp = s.spaces;
    const clockTaken = sp.clock[0] !== null;
    const vType = clockTaken ? nextType(s) : G.deliverType(s);
    const progress = 1 - s.stones / G.TIME_STONES;
    switch (o.area) {
      case 'vroom': {
        const mine = sp.vroom.filter((x) => x === p).length;
        const others = sp.vroom.filter((x) => x !== null && x !== p).length;
        const src = G.sources(s, p, vType).length - mine * pl.buses;
        const dst = G.destinations(s, p, vType).length - mine * pl.buses;
        const d = Math.min(pl.buses, src, dst);
        return Math.max(0, d - 0.35 * others * Math.min(1, d));
      }
      case 'line': {
        const counts = s.players.map(() => 0);
        sp.line.forEach((x) => { if (x !== null) counts[x]++; });
        const k = Math.max(...counts);
        if (counts[p] > 0) {
          if (counts[p] + 1 <= k) return 0;
          return 0.18 * (lineGain(s, p, k + 1) - lineGain(s, p, k)) * (1 - 0.5 * progress);
        }
        return (0.25 * lineGain(s, p, Math.max(1, k)) + (pl.line.length < 6 ? 0.4 : 0)) * (1 - 0.5 * progress);
      }
      case 'buses': {
        const potential = Math.min(G.sources(s, p).length + G.sources(s, p, nextType(s)).length,
          G.destinations(s, p).length + G.destinations(s, p, nextType(s)).length);
        const want = potential > pl.buses ? 0.8 : 0.25;
        return want * (1 - 0.7 * progress) + (pl.buses < 2 ? 0.3 : 0);
      }
      case 'pax': {
        const v = G.AREAS.find((a) => a.id === 'pax').values[o.slot];
        const hasStation = s.stations.some((st) => pl.line.includes(st));
        if (!hasStation) return 0.05 * v;
        // passengers only help if there is somewhere to take them
        const room = G.destinations(s, p, vType).length + G.destinations(s, p, nextType(s)).length;
        const waiting = G.sources(s, p, vType).length;
        return Math.min(v, Math.max(0, room - waiting + 1)) * 0.3;
      }
      case 'build': {
        const v = G.AREAS.find((a) => a.id === 'build').values[o.slot];
        const lines = onLineSets(s);
        const good = G.buildableSites(s).filter((x) => lines[p].has(x.node)).length;
        let demand = 0;
        for (const t of G.TYPES) demand = Math.max(demand, G.sources(s, p, t).length - G.destinations(s, p, t).length);
        return Math.min(v, good) * (0.3 + 0.2 * Math.min(2, Math.max(0, demand))) + 0.05 * v;
      }
      case 'clock': {
        const now = deliverable(s, p, G.deliverType(s));
        const next = deliverable(s, p, nextType(s));
        const myVroom = sp.vroom.some((x) => x === p) ? 1.2 : 0.8;
        let v = (next - now) * myVroom - 0.8;
        // close out the game when ahead
        const rank = G.ranking(s);
        if (s.stones === 1) v += rank[0].p === p ? 3 : -3;
        else if (rank[0].p === p && progress > 0.4) v += 0.4;
        return v;
      }
      case 'start':
        return 0.15;
    }
    return 0;
  }

  function choosePlacement(s, d) {
    const p = d.player, pl = s.players[p];
    let best = -1, bestV = -Infinity, passIdx = -1;
    d.options.forEach((o, i) => {
      if (o.pass) { passIdx = i; return; }
      const v = placementValue(s, p, o) + Math.random() * 0.2;
      if (v > bestV) { bestV = v; best = i; }
    });
    if (passIdx >= 0) {
      const roundsLeft = Math.max(2, s.stones + 1);
      const budget = Math.ceil(pl.markers / roundsLeft) + 1;
      const threshold = s.placed[p] >= budget ? 0.9 : 0.3;
      if (bestV < threshold) return passIdx;
    }
    return best;
  }

  function chooseExtend(s, d) {
    const p = d.player;
    const lines = onLineSets(s);
    let best = 0, bestV = -Infinity;
    d.options.forEach((o, i) => {
      if (o.stop) return;
      let v;
      if (o.from === undefined || !s.players[p].line.length) {
        v = nodeValue(s, p, o.from, lines) + nodeValue(s, p, o.to, lines);
      } else {
        v = nodeValue(s, p, o.to, lines);
        // one step of look-ahead
        let la = 0;
        for (const eid of s.adj[o.to]) {
          const nx = G.other(s.edges[eid], o.to);
          if (!lines[p].has(nx) && nx !== o.from) la = Math.max(la, nodeValue(s, p, nx, lines));
        }
        v += 0.5 * la;
      }
      if (s.edges[o.edge].lines.length) v -= 0.4;
      v += Math.random() * 0.1;
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  }

  function choosePax(s, d) {
    const pl = s.players[d.player];
    const lines = onLineSets(s);
    let best = 0, bestV = -Infinity;
    d.options.forEach((o, i) => {
      let v = pl.line.includes(o.station) ? 2 : 0;
      v -= lines.filter((l, q) => q !== d.player && l.has(o.station)).length * 0.6;
      v -= s.stationPax[o.station] * 0.1;
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  }

  function siteValue(s, p, site, type, lines) {
    let v = lines[p].has(site.node) ? 2 : 0;
    for (const end of G.lineEnds(s.players[p])) for (const eid of s.adj[end]) {
      if (G.other(s.edges[eid], end) === site.node) v += 0.8;
    }
    lines.forEach((l, q) => { if (q !== p && l.has(site.node)) v -= 0.7; });
    const have = s.sites.filter((x) => x.b === type && lines[p].has(x.node)).length;
    v += Math.max(0, 1.2 - 0.4 * have);
    if (type === nextType(s)) v += 0.5;
    if (type === G.deliverType(s) && G.sources(s, p).length > G.destinations(s, p).length) v += 0.6;
    return v;
  }

  function chooseBuildType(s, d) {
    const p = d.player, lines = onLineSets(s);
    const sites = G.buildableSites(s);
    let best = 0, bestV = -Infinity;
    d.options.forEach((o, i) => {
      for (const x of sites) {
        const v = siteValue(s, p, x, o.btype, lines) + Math.random() * 0.1;
        if (v > bestV) { bestV = v; best = i; }
      }
    });
    return best;
  }

  function chooseBuildSite(s, d) {
    const p = d.player, lines = onLineSets(s);
    let best = 0, bestV = -Infinity;
    d.options.forEach((o, i) => {
      const v = siteValue(s, p, s.sites[o.site], d.btype, lines) + Math.random() * 0.1;
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  }

  function chooseVroomPick(s, d) {
    // prefer passengers that rivals could also reach, so they don't get them first
    const lines = onLineSets(s);
    let best = 0, bestV = -Infinity;
    d.options.forEach((o, i) => {
      if (o.stop) return;
      let v = o.station !== undefined ? 0.5 : 0;
      v += lines.filter((l, q) => q !== d.player && l.has(o.node)).length;
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  }

  function chooseVroomDest(s, d) {
    // drop passengers where rivals can't pick them up next time
    const lines = onLineSets(s);
    let best = 0, bestV = -Infinity;
    d.options.forEach((o, i) => {
      const v = -lines.filter((l, q) => q !== d.player && l.has(o.node)).length + Math.random() * 0.1;
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  }

  const CHOOSERS = {
    place: choosePlacement, extend: chooseExtend, pax: choosePax, buildType: chooseBuildType,
    buildSite: chooseBuildSite, vroomPick: chooseVroomPick, vroomDest: chooseVroomDest,
  };

  G.aiChoose = function (s) {
    const d = s.decision;
    return CHOOSERS[d.type](s, d);
  };
})(typeof window !== 'undefined' ? (window.BUS = window.BUS || {}) : (globalThis.BUS = globalThis.BUS || {}));
