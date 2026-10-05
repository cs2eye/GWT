// Rules engine for Bus. The whole game state is a plain JSON-compatible object. Play proceeds
// through a stack of tasks; whenever a player has to choose something the engine stops with
// `state.decision` = { player, type, prompt, options }. Call BUS.choose(state, optionIndex).
(function (G) {
  'use strict';

  // ------------------------------------------------------------- constants
  const COLS = 9, ROWS = 7, GAP = 80, MARGIN = 50;
  G.WIDTH = MARGIN * 2 + GAP * (COLS - 1);
  G.HEIGHT = MARGIN * 2 + GAP * (ROWS - 1);

  const TYPES = ['H', 'O', 'P'];
  const TYPE_NAME = { H: 'House', O: 'Office', P: 'Pub' };
  const MAX_BUSES = 5;
  const START_MARKERS = 20;
  const TIME_STONES = 5;
  const PAX_SUPPLY = 30;

  // Action areas, in resolution order. Spaces in an area are filled left to right.
  const AREAS = [
    { id: 'line', name: 'Line Expansion', spaces: 6, short: 'Extend your bus line' },
    { id: 'buses', name: 'Buses', spaces: 1, short: '+1 bus (max 5)' },
    { id: 'pax', name: 'Passengers', spaces: 6, values: [3, 3, 2, 2, 1, 1], short: 'Add passengers at train stations' },
    { id: 'build', name: 'Buildings', spaces: 6, values: [2, 2, 2, 1, 1, 1], short: 'Construct buildings' },
    { id: 'clock', name: 'Clock', spaces: 1, short: 'Advance the clock, take a time stone (−1 VP)' },
    { id: 'vroom', name: 'Vroom!', spaces: 6, short: 'Transport passengers (1 per bus)' },
    { id: 'start', name: 'Starting Player', spaces: 1, short: 'Go first next round' },
  ];
  G.AREAS = AREAS; G.TYPES = TYPES; G.TYPE_NAME = TYPE_NAME;
  G.MAX_BUSES = MAX_BUSES; G.TIME_STONES = TIME_STONES;
  const AREA = {};
  for (const a of AREAS) AREA[a.id] = a;

  // ----------------------------------------------------------------- utils
  function rand(s) { // mulberry32
    let t = (s.seed = (s.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(s, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  function clone(s) {
    return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
  }
  G.clone = clone;

  function log(s, msg, p) {
    s.log.push({ p: p === undefined ? -1 : p, msg, round: s.round });
    if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  }
  const pname = (s, p) => s.players[p].name;

  // ------------------------------------------------------------------- map
  function nodeId(c, r) { return r * COLS + c; }

  function connected(nodes, edges) {
    const adj = nodes.map(() => []);
    for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
    const seen = new Set([0]), q = [0];
    while (q.length) for (const n of adj[q.pop()]) if (!seen.has(n)) { seen.add(n); q.push(n); }
    return seen.size === nodes.length;
  }

  function buildMap(s) {
    const nodes = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      nodes.push({ id: nodeId(c, r), c, r, x: MARGIN + c * GAP, y: MARGIN + r * GAP, station: false });
    }
    let edges = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (c < COLS - 1) edges.push({ a: nodeId(c, r), b: nodeId(c + 1, r) });
      if (r < ROWS - 1) edges.push({ a: nodeId(c, r), b: nodeId(c, r + 1) });
    }
    // knock out some streets so the city is less regular, keeping it connected
    const deg = nodes.map(() => 0);
    for (const e of edges) { deg[e.a]++; deg[e.b]++; }
    const order = shuffle(s, edges.map((_, i) => i));
    const removed = new Set();
    let toRemove = Math.round(edges.length * 0.2);
    for (const i of order) {
      if (!toRemove) break;
      const e = edges[i];
      if (deg[e.a] <= 2 || deg[e.b] <= 2) continue;
      removed.add(i);
      if (!connected(nodes, edges.filter((_, k) => !removed.has(k)))) { removed.delete(i); continue; }
      deg[e.a]--; deg[e.b]--; toRemove--;
    }
    edges = edges.filter((_, k) => !removed.has(k)).map((e, i) => ({ id: i, a: e.a, b: e.b, lines: [] }));

    // three train stations: west, east, and north or south
    const pick = (cands) => cands[Math.floor(rand(s) * cands.length)];
    const st = [
      pick([nodeId(0, 2), nodeId(0, 3), nodeId(0, 4), nodeId(1, 1), nodeId(1, 5)]),
      pick([nodeId(8, 2), nodeId(8, 3), nodeId(8, 4), nodeId(7, 1), nodeId(7, 5)]),
      pick([nodeId(4, 0), nodeId(3, 0), nodeId(5, 0), nodeId(4, 6), nodeId(3, 6), nodeId(5, 6)]),
    ];
    for (const id of st) nodes[id].station = true;

    // building sites: one per intersection (not at stations), zone by distance from centre
    const sites = [];
    const cc = (COLS - 1) / 2, cr = (ROWS - 1) / 2;
    for (const n of nodes) {
      if (n.station) continue;
      const d = Math.hypot(n.c - cc, n.r - cr);
      if (d > 1.5 && rand(s) < 0.15) continue;
      const dx = n.c < COLS - 1 ? 1 : -1, dy = n.r < ROWS - 1 ? 1 : -1;
      sites.push({
        id: sites.length, node: n.id,
        x: n.x + dx * GAP * 0.3, y: n.y + dy * GAP * 0.3,
        zone: d <= 1.5 ? 1 : d <= 3.2 ? 2 : 3,
        b: null, pax: false,
      });
    }
    const adj = nodes.map(() => []);
    for (const e of edges) { adj[e.a].push(e.id); adj[e.b].push(e.id); }
    s.nodes = nodes; s.edges = edges; s.adj = adj; s.sites = sites;
    s.stations = st;
    s.stationPax = {};
    for (const id of st) s.stationPax[id] = 0;
  }

  // -------------------------------------------------------------- new game
  G.newGame = function (opts) {
    const s = {
      seed: opts.seed !== undefined ? opts.seed : (Math.random() * 2 ** 31) | 0,
      players: opts.players.map((p, i) => ({
        id: i, name: p.name, ai: !!p.ai, markers: START_MARKERS, buses: 1,
        vp: 0, stones: 0, line: [], lineEdges: [],
      })),
      clock: 0, stones: TIME_STONES, paxSupply: PAX_SUPPLY,
      round: 0, start: 0, current: 0,
      spaces: {}, placed: [], passed: [],
      tasks: [], decision: null, log: [], gameOver: false, phase: 'setup',
    };
    buildMap(s);
    resetSpaces(s);
    const n = s.players.length;
    const fwd = [...Array(n).keys()], rev = fwd.slice().reverse();
    const seqTasks = [];
    for (const p of fwd) seqTasks.push({ t: 'setupHouse', p });
    for (const p of rev) seqTasks.push({ t: 'setupHouse', p });
    for (const p of fwd) seqTasks.push({ t: 'setupLine', p });
    for (const p of rev) seqTasks.push({ t: 'setupLine', p });
    seqTasks.push({ t: 'setupPax' }, { t: 'round' });
    seq(s, seqTasks);
    log(s, 'New game with ' + n + ' players. Place two starting houses each, then your first two line sections.');
    advance(s);
    return s;
  };

  function resetSpaces(s) {
    for (const a of AREAS) s.spaces[a.id] = Array(a.spaces).fill(null);
    s.placed = s.players.map(() => 0);
    s.passed = s.players.map(() => false);
  }

  // ------------------------------------------------------------- task loop
  function ask(s, p, type, prompt, options, extra) {
    s.current = p;
    s.decision = Object.assign({ player: p, type, prompt, options }, extra || {});
  }
  function push(s, t) { s.tasks.push(t); }
  function seq(s, list) { for (let i = list.length - 1; i >= 0; i--) s.tasks.push(list[i]); }

  function advance(s) {
    let guard = 0;
    while (!s.decision && !s.gameOver) {
      if (++guard > 20000) throw new Error('engine loop guard');
      if (!s.tasks.length) { s.tasks.push({ t: 'round' }); continue; }
      const task = s.tasks.pop();
      TASKS[task.t](s, task);
    }
  }
  G.advance = advance;

  G.choose = function (s, idx) {
    const d = s.decision;
    if (!d) throw new Error('no decision pending');
    const opt = d.options[idx];
    if (!opt) throw new Error('bad option ' + idx);
    s.decision = null;
    RESOLVE[d.type](s, d, opt);
    advance(s);
  };

  // --------------------------------------------------------------- helpers
  const other = (e, n) => (e.a === n ? e.b : e.a);
  G.other = other;

  function lineEnds(pl) {
    if (!pl.line.length) return [];
    return pl.line.length === 1 ? [pl.line[0]] : [pl.line[0], pl.line[pl.line.length - 1]];
  }
  G.lineEnds = lineEnds;

  function extensionOptions(s, p) {
    const pl = s.players[p];
    const out = [];
    if (!pl.line.length) {
      let free = s.edges.filter((e) => !e.lines.length);
      if (!free.length) free = s.edges;
      for (const e of free) out.push({ edge: e.id, from: e.a, to: e.b });
      return out;
    }
    const onLine = new Set(pl.line);
    for (const end of lineEnds(pl)) {
      const free = [], used = [];
      for (const eid of s.adj[end]) {
        const e = s.edges[eid];
        const to = other(e, end);
        if (onLine.has(to)) continue;
        (e.lines.length ? used : free).push({ edge: eid, from: end, to });
      }
      // a street already carrying another line may only be used if this end has no free street
      out.push(...(free.length ? free : used));
    }
    return out;
  }
  G.extensionOptions = extensionOptions;

  function extend(s, p, o) {
    const pl = s.players[p], e = s.edges[o.edge];
    if (!pl.line.length) pl.line.push(e.a, e.b);
    else if (o.from === pl.line[0]) pl.line.unshift(o.to);
    else pl.line.push(o.to);
    pl.lineEdges.push(e.id);
    e.lines.push(p);
  }

  function buildableSites(s) {
    const empty = s.sites.filter((x) => !x.b);
    if (!empty.length) return [];
    const z = Math.min(...empty.map((x) => x.zone));
    return empty.filter((x) => x.zone === z);
  }
  G.buildableSites = buildableSites;

  function deliverType(s) { return TYPES[s.clock]; }
  G.deliverType = deliverType;

  // passengers the player can pick up (on their line, not already at the current building type)
  function sources(s, p, type) {
    type = type || deliverType(s);
    const onLine = new Set(s.players[p].line);
    const out = [];
    for (const st of s.stations) if (onLine.has(st) && s.stationPax[st] > 0) out.push({ station: st, node: st });
    for (const x of s.sites) if (x.pax && x.b !== type && onLine.has(x.node)) out.push({ site: x.id, node: x.node });
    return out;
  }
  function destinations(s, p, type) {
    type = type || deliverType(s);
    const onLine = new Set(s.players[p].line);
    return s.sites.filter((x) => x.b === type && !x.pax && onLine.has(x.node));
  }
  G.sources = sources; G.destinations = destinations;

  function minMarkers(s) { return Math.max(...s.players.map((pl) => pl.buses)); }
  G.minMarkers = minMarkers;

  function nextFree(s, area) { return s.spaces[area].indexOf(null); }

  function canPlace(s, p, area) {
    const pl = s.players[p];
    if (pl.markers <= 0 || nextFree(s, area) < 0) return false;
    if (area === 'buses' && pl.buses >= MAX_BUSES) return false;
    if (area === 'clock' && s.stones <= 0) return false;
    if (area === 'pax' && s.paxSupply <= 0) return false;
    if (area === 'build' && !buildableSites(s).length) return false;
    return true;
  }
  G.canPlace = canPlace;

  function canPass(s, p) {
    const pl = s.players[p];
    return pl.markers === 0 || s.placed[p] >= minMarkers(s);
  }
  G.canPass = canPass;

  function placementOptions(s, p) {
    const opts = [];
    for (const a of AREAS) if (canPlace(s, p, a.id)) {
      const i = nextFree(s, a.id);
      let label = a.name;
      if (a.values) label += ' (' + a.values[i] + ')';
      opts.push({ area: a.id, slot: i, label });
    }
    if (opts.length && canPass(s, p)) opts.push({ pass: true, label: 'Pass (done placing this round)' });
    return opts;
  }

  // ----------------------------------------------------------------- tasks
  const TASKS = {
    setupHouse(s, t) {
      const sites = buildableSites(s);
      if (!sites.length) return;
      ask(s, t.p, 'buildSite', 'Setup: place a starting House on a highlighted site', siteOpts(sites), { btype: 'H', setup: true });
    },
    setupLine(s, t) {
      const pl = s.players[t.p];
      const opts = extensionOptions(s, t.p).map((o) => Object.assign(o, { label: 'Street ' + o.from + '–' + o.to }));
      if (!opts.length) return;
      ask(s, t.p, 'extend', pl.line.length ? 'Setup: add a second section to your line (click a highlighted street)'
        : 'Setup: place the first section of your bus line (click a street)', opts, { setup: true });
    },
    setupPax(s) {
      for (const st of s.stations) { s.stationPax[st] = 1; s.paxSupply--; }
      log(s, 'One passenger waits at each train station.');
      s.phase = 'play';
    },
    round(s) {
      if (s.gameOver) return;
      s.round++;
      resetSpaces(s);
      s.current = s.start;
      s.phase = 'place';
      log(s, '— Round ' + s.round + ' — ' + pname(s, s.start) + ' starts. Clock shows ' + TYPE_NAME[deliverType(s)] +
        '. Everyone must place at least ' + minMarkers(s) + ' marker(s).');
      seq(s, [{ t: 'place', p: s.start }, { t: 'resolve' }]);
    },
    place(s, t) {
      const n = s.players.length;
      if (s.passed.every(Boolean)) return;
      let p = t.p;
      for (let k = 0; k < n && s.passed[p]; k++) p = (p + 1) % n;
      if (s.passed[p]) return;
      const opts = placementOptions(s, p);
      if (!opts.length) {
        s.passed[p] = true;
        push(s, { t: 'place', p: (p + 1) % n });
        return;
      }
      const need = Math.max(0, Math.min(minMarkers(s), s.players[p].markers + s.placed[p]) - s.placed[p]);
      ask(s, p, 'place', 'Place an action marker' + (need ? ' (' + need + ' more required)' : ' or pass'), opts);
    },
    resolve(s) {
      s.phase = 'resolve';
      const list = [];
      // Line expansion: everyone who placed extends by the highest marker count any one player has there
      const counts = s.players.map(() => 0);
      s.spaces.line.forEach((p) => { if (p !== null) counts[p]++; });
      const k = Math.max(...counts);
      const done = new Set();
      s.spaces.line.forEach((p) => {
        if (p === null || done.has(p)) return;
        done.add(p);
        list.push({ t: 'logMsg', p, msg: pname(s, p) + ' may extend their line by ' + k + ' section(s).' });
        list.push({ t: 'extend', p, left: k });
      });
      if (s.spaces.buses[0] !== null) list.push({ t: 'bus', p: s.spaces.buses[0] });
      s.spaces.pax.forEach((p, i) => { if (p !== null) list.push({ t: 'pax', p, left: AREA.pax.values[i], total: AREA.pax.values[i] }); });
      s.spaces.build.forEach((p, i) => { if (p !== null) list.push({ t: 'build', p, left: AREA.build.values[i] }); });
      if (s.spaces.clock[0] !== null) list.push({ t: 'clock', p: s.spaces.clock[0] });
      s.spaces.vroom.forEach((p) => { if (p !== null) list.push({ t: 'vroomStart', p }); });
      if (s.spaces.start[0] !== null) list.push({ t: 'startPlayer', p: s.spaces.start[0] });
      list.push({ t: 'endRound' });
      seq(s, list);
    },
    logMsg(s, t) { log(s, t.msg, t.p); },
    extend(s, t) {
      if (t.left <= 0) return;
      const opts = extensionOptions(s, t.p).map((o) => Object.assign(o, { label: 'Street ' + o.from + '–' + o.to }));
      if (!opts.length) { log(s, pname(s, t.p) + "'s line cannot be extended.", t.p); return; }
      opts.push({ stop: true, label: 'Stop extending' });
      ask(s, t.p, 'extend', 'Extend your line: ' + t.left + ' section(s) left (click a highlighted street)', opts, { left: t.left });
    },
    bus(s, t) {
      const pl = s.players[t.p];
      if (pl.buses < MAX_BUSES) pl.buses++;
      log(s, pname(s, t.p) + ' gets a bus (now ' + pl.buses + ').', t.p);
    },
    pax(s, t) {
      if (t.left <= 0) return;
      if (s.paxSupply <= 0) { log(s, 'No passengers left in the supply.'); return; }
      const opts = s.stations.map((st) => ({ station: st, node: st, label: 'Station ' + stationName(s, st) + ' (' + s.stationPax[st] + ' waiting)' }));
      ask(s, t.p, 'pax', 'Place a passenger at a train station (' + t.left + ' left)', opts, { left: t.left, total: t.total });
    },
    build(s, t) {
      if (t.left <= 0) return;
      if (!buildableSites(s).length) { log(s, 'No building sites left.'); return; }
      const opts = TYPES.map((b) => ({ btype: b, label: TYPE_NAME[b] }));
      ask(s, t.p, 'buildType', 'Choose a building type to construct (' + t.left + ' left)', opts, { left: t.left });
    },
    buildSite(s, t) {
      const sites = buildableSites(s);
      if (!sites.length) return;
      ask(s, t.p, 'buildSite', 'Place the ' + TYPE_NAME[t.btype] + ' on a highlighted site', siteOpts(sites), { btype: t.btype, left: t.left });
    },
    clock(s, t) {
      s.clock = (s.clock + 1) % 3;
      s.stones--;
      s.players[t.p].stones++;
      log(s, pname(s, t.p) + ' advances the clock to ' + TYPE_NAME[deliverType(s)] + ' and takes a time stone (' + s.stones + ' left).', t.p);
    },
    vroomStart(s, t) {
      push(s, { t: 'vroom', p: t.p, left: s.players[t.p].buses });
    },
    vroom(s, t) {
      if (t.left <= 0) return;
      const src = sources(s, t.p), dst = destinations(s, t.p);
      if (!src.length || !dst.length) {
        if (t.left === s.players[t.p].buses) log(s, pname(s, t.p) + ' has no passengers to transport to a ' + TYPE_NAME[deliverType(s)] + '.', t.p);
        return;
      }
      const opts = src.map((o) => Object.assign(o, { label: o.station !== undefined ? 'Passenger at station ' + stationName(s, o.station) : 'Passenger at ' + TYPE_NAME[s.sites[o.site].b] + ' #' + o.site }));
      opts.push({ stop: true, label: 'Stop transporting' });
      ask(s, t.p, 'vroomPick', 'Vroom! Pick a passenger to take to a ' + TYPE_NAME[deliverType(s)] + ' (' + t.left + ' bus(es) left)', opts, { left: t.left });
    },
    vroomDest(s, t) {
      const dst = destinations(s, t.p);
      ask(s, t.p, 'vroomDest', 'Choose the ' + TYPE_NAME[deliverType(s)] + ' to drop the passenger at', siteOpts(dst), { left: t.left, src: t.src });
    },
    startPlayer(s, t) {
      s.start = t.p;
      log(s, pname(s, t.p) + ' will start the next round.', t.p);
    },
    endRound(s) {
      const withMarkers = s.players.filter((pl) => pl.markers > 0).length;
      if (s.stones <= 0) { endGame(s, 'The last time stone has been taken.'); return; }
      if (withMarkers <= 1) { endGame(s, 'At most one player has action markers left.'); return; }
      if (!buildableSites(s).length && s.paxSupply <= 0 && s.players.every((pl, p) => !extensionOptions(s, p).length)) {
        endGame(s, 'The city is complete.'); return;
      }
    },
  };

  function siteOpts(sites) {
    return sites.map((x) => ({ site: x.id, node: x.node, label: 'Site #' + x.id + ' (zone ' + x.zone + ')' }));
  }

  function stationName(s, st) { return String.fromCharCode(65 + s.stations.indexOf(st)); }
  G.stationName = stationName;

  function endGame(s, why) {
    s.gameOver = true;
    s.phase = 'over';
    log(s, 'Game over: ' + why);
    const sc = G.ranking(s);
    log(s, sc[0].name + ' win' + (sc[0].name === 'You' ? '' : 's') + ' with ' + sc[0].total + ' VP.');
  }

  // --------------------------------------------------------------- resolve
  const RESOLVE = {
    place(s, d, o) {
      const p = d.player, n = s.players.length;
      if (o.pass) {
        s.passed[p] = true;
        log(s, pname(s, p) + ' passes.', p);
      } else {
        s.spaces[o.area][o.slot] = p;
        s.players[p].markers--;
        s.placed[p]++;
        log(s, pname(s, p) + ' → ' + o.label, p);
      }
      push(s, { t: 'place', p: (p + 1) % n });
    },
    extend(s, d, o) {
      if (o.stop) return;
      extend(s, d.player, o);
      if (!d.setup && d.left > 1) push(s, { t: 'extend', p: d.player, left: d.left - 1 });
      if (d.setup) log(s, pname(s, d.player) + ' builds a line section.', d.player);
    },
    pax(s, d, o) {
      s.stationPax[o.station]++;
      s.paxSupply--;
      if (d.left === d.total) log(s, pname(s, d.player) + ' adds ' + d.total + ' passenger(s).', d.player);
      push(s, { t: 'pax', p: d.player, left: d.left - 1, total: d.total });
    },
    buildType(s, d, o) {
      push(s, { t: 'buildSite', p: d.player, btype: o.btype, left: d.left });
    },
    buildSite(s, d, o) {
      s.sites[o.site].b = d.btype;
      log(s, pname(s, d.player) + ' builds a ' + TYPE_NAME[d.btype] + ' (zone ' + s.sites[o.site].zone + ').', d.player);
      if (!d.setup) push(s, { t: 'build', p: d.player, left: d.left - 1 });
    },
    vroomPick(s, d, o) {
      if (o.stop) return;
      push(s, { t: 'vroomDest', p: d.player, left: d.left, src: o });
    },
    vroomDest(s, d, o) {
      const src = d.src;
      if (src.station !== undefined) s.stationPax[src.station]--;
      else s.sites[src.site].pax = false;
      s.sites[o.site].pax = true;
      s.players[d.player].vp++;
      log(s, pname(s, d.player) + ' delivers a passenger to a ' + TYPE_NAME[s.sites[o.site].b] + ' (+1 VP).', d.player);
      push(s, { t: 'vroom', p: d.player, left: d.left - 1 });
    },
  };

  // --------------------------------------------------------------- scoring
  G.score = function (s, p) {
    const pl = s.players[p];
    return { name: pl.name, p, delivered: pl.vp, stones: pl.stones, total: pl.vp - pl.stones, markers: pl.markers };
  };
  // ties: fewer time stones, then more markers left
  G.ranking = function (s) {
    return s.players.map((_, p) => G.score(s, p))
      .sort((a, b) => b.total - a.total || a.stones - b.stones || b.markers - a.markers);
  };
})(typeof window !== 'undefined' ? (window.BUS = window.BUS || {}) : (globalThis.BUS = globalThis.BUS || {}));
