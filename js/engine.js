// Rules engine. The whole game state is a plain JSON-compatible object so it can be cloned
// cheaply for AI look-ahead. Play proceeds through a stack of tasks; whenever a player has to
// choose something the engine stops with `state.decision` = { player, type, prompt, options }.
// Call GWT.choose(state, optionIndex) to resolve it.
(function (G) {
  'use strict';
  const N = G.NODES;

  // ---------------------------------------------------------------- utils
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
  G.shuffle = shuffle;

  function log(s, msg, p) {
    s.log.push({ p: p === undefined ? s.current : p, msg, turn: s.turnCount });
    if (s.log.length > 150) s.log.splice(0, s.log.length - 150);
  }
  function pname(s, p) { return s.players[p].name; }
  function possessive(name) { return name === 'You' ? 'your' : name + "'s"; }
  G.possessive = possessive;

  // ------------------------------------------------------- derived values
  const stepLimit = (pl) => 3 + (pl.unlocks.step4 ? 1 : 0) + (pl.unlocks.step5 ? 1 : 0);
  const handLimit = (pl) => 4 + (pl.unlocks.hand5 ? 1 : 0) + (pl.unlocks.hand6 ? 1 : 0);
  const certMax = (pl) => (pl.unlocks.certmax6 ? 6 : 4);
  G.stepLimit = stepLimit; G.handLimit = handLimit; G.certMax = certMax;

  function handValue(hand) {
    const seen = {};
    let v = 0;
    for (const c of hand) if (!seen[c.breed]) { seen[c.breed] = 1; v += G.BREEDS[c.breed].value; }
    return v;
  }
  G.handValue = handValue;

  function isLocation(s, id) {
    const n = N[id];
    if (n.type === 'neutral' || n.type === 'kc') return true;
    if (n.type === 'start') return false;
    return !!s.board[id];
  }
  G.isLocation = isLocation;

  function tollAt(s, id, p) {
    const c = s.board[id];
    if (!c) return null;
    if (c.kind === 'hazard' || c.kind === 'teepee') return { amt: G.TOLL[c.hand], to: null };
    if (c.kind === 'private' && c.owner !== p) {
      const h = G.PRIVATE[c.b].hand;
      if (h) return { amt: G.TOLL[h], to: c.owner };
    }
    return null;
  }

  function ownBuildings(s, p) {
    const out = [];
    for (const id in s.board) {
      const c = s.board[id];
      if (c && c.kind === 'private' && c.owner === p) out.push(id);
    }
    return out;
  }
  G.ownBuildings = ownBuildings;

  function allCards(pl) { return pl.deck.concat(pl.hand, pl.discard); }
  G.allCards = allCards;

  function enginePosFree(s, pos, p) {
    if (pos === 0) return true;
    return !s.players.some((o, i) => i !== p && o.engine === pos);
  }
  // Move `steps` spaces (occupied spaces are skipped). dir = +1/-1. Returns new position.
  function engineTarget(s, p, steps, dir) {
    let pos = s.players[p].engine;
    let moved = 0;
    while (moved < steps) {
      let next = pos + dir;
      while (next > 0 && next <= G.RAIL_LENGTH && !enginePosFree(s, next, p)) next += dir;
      if (next < 0 || next > G.RAIL_LENGTH) break;
      pos = Math.max(0, next);
      moved++;
      if (pos === 0) break;
    }
    return pos;
  }
  G.engineTarget = engineTarget;

  // --------------------------------------------------------------- setup
  function makeForesightTile(type, s) {
    if (G.WORKER_TYPES.includes(type)) return { kind: 'worker', worker: type };
    if (type === 'teepee_green') return { kind: 'teepee', color: 'green', hand: 'green', vp: 1 };
    if (type === 'teepee_blue') return { kind: 'teepee', color: 'blue', hand: 'black', vp: 2 };
    const vp = G.HAZARD_VP[Math.floor(rand(s) * G.HAZARD_VP.length)];
    return { kind: 'hazard', region: type, vp, hand: vp >= 3 ? 'black' : 'green' };
  }

  G.newGame = function (opts) {
    opts = opts || {};
    const s = {
      seed: (opts.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : opts.seed) | 0,
      nextId: 1,
      players: [],
      board: {},
      market: [], marketDeck: [],
      job: { slots: new Array(G.JOB_ROWS.length * G.JOB_ROW_SIZE).fill(null), placed: 0 },
      foresight: [[], [], []], stacks: [[], [], []],
      objDisplay: [], objDeck: [],
      stations: G.STATIONS.map(() => ({ owners: [], master: null })),
      current: 0, turnCount: 0, tasks: [], decision: null, log: [], ctx: null,
      endTrigger: null, finalLeft: 0, triggeredThisTurn: false, gameOver: false,
    };
    for (const id in N) s.board[id] = N[id].type === 'neutral' ? { kind: 'neutral', id } : null;

    // cattle market
    for (const b in G.BREEDS) for (let i = 0; i < (G.BREEDS[b].market || 0); i++) s.marketDeck.push({ id: s.nextId++, breed: b });
    shuffle(s, s.marketDeck);
    refillMarket(s);

    // foresight stacks
    const pool = [];
    for (const t in G.FORESIGHT_POOL) for (let i = 0; i < G.FORESIGHT_POOL[t]; i++) pool.push(t);
    shuffle(s, pool);
    pool.forEach((t, i) => s.stacks[i % 3].push(makeForesightTile(t, s)));
    for (let c = 0; c < 3; c++) refillForesight(s, c);

    // initial job market (two rows) and initial hazards / teepees
    for (let i = 0; i < 4; i++) placeWorker(s, { kind: 'worker', worker: G.WORKER_TYPES[Math.floor(rand(s) * 3)] }, true);
    for (const t of ['flood', 'drought', 'rockfall', 'teepee_green', 'teepee_blue']) placeTile(s, makeForesightTile(t, s));

    // objectives
    s.objDeck = shuffle(s, G.OBJECTIVES.map((o) => o.id));
    while (s.objDisplay.length < G.OBJECTIVE_DISPLAY && s.objDeck.length) s.objDisplay.push(s.objDeck.pop());
    const starts = shuffle(s, G.START_OBJECTIVES.map((o) => o.id));

    // master tiles on stations
    const masters = shuffle(s, Object.keys(G.STATION_MASTERS));
    G.STATIONS.forEach((st, i) => { if (st.master) s.stations[i].master = masters.pop() || null; });

    const defs = opts.players || [{ name: 'You', ai: false }, { name: 'Rancher Bot', ai: true }];
    defs.forEach((d, i) => {
      const pl = {
        name: d.name, ai: !!d.ai, money: 6 + i,
        workers: { cowboy: 1, craftsman: 1, engineer: 1 },
        deck: [], hand: [], discard: [],
        certs: 0, permCerts: 0, unlocks: {}, disks: 0,
        buildingsLeft: Object.keys(G.PRIVATE).map(Number),
        hazards: [], teepees: [], stations: [], masters: [], cities: {},
        engine: 0, location: 'start', objectives: [{ id: starts[i % starts.length] }],
        jobToken: false, removed: 0,
      };
      for (const b in G.BREEDS) for (let k = 0; k < (G.BREEDS[b].start || 0); k++) pl.deck.push({ id: s.nextId++, breed: b });
      shuffle(s, pl.deck);
      s.players.push(pl);
      draw(s, pl, handLimit(pl));
    });
    log(s, 'Game started. ' + pname(s, 0) + ' goes first.', 0);
    advance(s);
    return s;
  };

  function refillMarket(s) {
    while (s.market.length < G.MARKET_SIZE && s.marketDeck.length) s.market.push(s.marketDeck.pop());
  }
  function refillForesight(s, c) {
    while (s.foresight[c].length < 2) {
      let src = s.stacks[c].length ? s.stacks[c] : s.stacks.find((st) => st.length);
      if (!src) break;
      s.foresight[c].push(src.pop());
    }
  }
  function draw(s, pl, n) {
    for (let i = 0; i < n; i++) {
      if (!pl.deck.length) {
        if (!pl.discard.length) return;
        pl.deck = shuffle(s, pl.discard);
        pl.discard = [];
      }
      pl.hand.push(pl.deck.pop());
    }
  }

  // Place a worker into the job market. Returns false when the market is already full.
  function placeWorker(s, tile, setup) {
    const cap = s.job.slots.length;
    if (s.job.placed >= cap) return false;
    s.job.slots[s.job.placed] = tile.worker;
    s.job.placed++;
    if (!setup && s.job.placed % G.JOB_ROW_SIZE === 0) {
      const row = s.job.placed / G.JOB_ROW_SIZE; // number of completed rows
      if (G.JOB_REFILL_ROWS.includes(row)) { refillMarket(s); log(s, 'The cattle market is refilled.'); }
    }
    if (!setup && s.job.placed >= cap && s.endTrigger === null) {
      s.endTrigger = s.current;
      s.finalLeft = s.players.length - 1;
      s.triggeredThisTurn = true;
      s.players[s.current].jobToken = true;
      log(s, pname(s, s.current) + ' fills the job market: the game end is triggered (+2 VP). Every other player gets one last turn.');
    }
    return true;
  }
  function placeTile(s, tile) {
    if (tile.kind === 'worker') return placeWorker(s, tile);
    const ids = Object.keys(N).filter((id) =>
      tile.kind === 'hazard' ? (N[id].type === 'hazard' && N[id].region === tile.region) : N[id].type === 'teepee');
    for (const id of ids) if (!s.board[id]) { s.board[id] = tile; return id; }
    return null;
  }

  // ---------------------------------------------------------- task loop
  function ask(s, type, prompt, options, extra) {
    s.decision = Object.assign({ player: s.current, type, prompt, options }, extra || {});
  }
  function push(s, ...tasks) { for (const t of tasks) s.tasks.push(t); }

  function advance(s) {
    let guard = 0;
    while (!s.decision && !s.gameOver) {
      if (++guard > 5000) throw new Error('engine loop guard');
      if (!s.tasks.length) { s.tasks.push({ t: 'turnStart' }); continue; }
      const task = s.tasks[s.tasks.length - 1];
      if (task.t === 'endTurn' && s.simHalt) { s.halted = true; return; }
      s.tasks.pop();
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

  // ----------------------------------------------------------- movement
  function moveOptions(s, p, limit) {
    const pl = s.players[p];
    const best = {};
    function dfs(node, steps, toll, payments, path) {
      for (const nx of N[node].next) {
        const occ = isLocation(s, nx);
        const st = steps + (occ ? 1 : 0);
        if (st > limit) continue;
        const t = tollAt(s, nx, p);
        const nt = toll + (t ? t.amt : 0);
        const np = t ? payments.concat([t]) : payments;
        const npath = path.concat([nx]);
        if (occ) {
          const blocked = nx !== 'KC' && s.players.some((o, i) => i !== p && o.location === nx);
          if (!blocked && (!best[nx] || best[nx].toll > nt)) best[nx] = { node: nx, steps: st, toll: nt, payments: np, path: npath };
        }
        if (nx !== 'KC') dfs(nx, st, nt, np, npath);
      }
    }
    dfs(pl.location, 0, 0, [], [pl.location]);
    let opts = Object.values(best);
    const affordable = opts.filter((o) => o.toll <= pl.money);
    if (affordable.length) opts = affordable;
    opts.sort((a, b) => G.TRAIL_ORDER.indexOf(a.node) - G.TRAIL_ORDER.indexOf(b.node));
    return opts;
  }
  G.moveOptions = moveOptions;

  function locationName(s, id) {
    const n = N[id];
    const c = s.board[id];
    if (n.type === 'kc') return 'Kansas City';
    if (n.type === 'neutral') return 'Building ' + id;
    if (!c) return 'empty site';
    if (c.kind === 'private') return possessive(s.players[c.owner].name) + ' building ' + c.b;
    if (c.kind === 'hazard') return c.region + ' hazard';
    if (c.kind === 'teepee') return c.color + ' teepee';
    return id;
  }
  G.locationName = locationName;

  // ------------------------------------------------------------- tasks
  const TASKS = {
    turnStart(s) {
      s.ctx = { used: [] };
      s.triggeredThisTurn = false;
      push(s, { t: 'endTurn' }, { t: 'locAction' }, { t: 'move', limit: stepLimit(s.players[s.current]) });
    },

    move(s, task) {
      const opts = moveOptions(s, s.current, task.limit);
      if (!opts.length) { log(s, pname(s, s.current) + ' cannot move.'); return; }
      ask(s, 'move', 'Move your cowboy (up to ' + task.limit + ' steps)', opts.map((o) => ({
        label: locationName(s, o.node) + ' (' + o.steps + ' step' + (o.steps > 1 ? 's' : '') + (o.toll ? ', toll $' + o.toll : '') + ')',
        node: o.node, toll: o.toll, payments: o.payments, path: o.path,
      })));
    },

    locAction(s) {
      const p = s.current, pl = s.players[p];
      const loc = pl.location;
      if (loc === 'KC') { push(s, { t: 'kcReturn' }, { t: 'deliver' }, { t: 'foresight', col: 2 }, { t: 'foresight', col: 1 }, { t: 'foresight', col: 0 }); return; }
      const acts = buildingActions(s, p, loc);
      const opts = [];
      acts.forEach((a, i) => {
        if (!s.ctx.used.includes(i) && canDo(s, p, a)) opts.push({ label: a.label, act: 'bld', i, a });
      });
      if (!s.ctx.used.length) for (const ax of auxOptions(s, p)) opts.push(ax);
      opts.push({ label: s.ctx.used.length ? 'Finish turn' : 'Do nothing / finish turn', act: 'end' });
      const where = locationName(s, loc);
      ask(s, 'action', acts.length
        ? 'At ' + where + ': use its actions (any order, each once) or one auxiliary action'
        : 'At ' + where + ': you may take one auxiliary action', opts);
    },

    action(s, task) { runAction(s, task.a); },

    endTurn(s) {
      const p = s.current, pl = s.players[p];
      draw(s, pl, Math.max(0, handLimit(pl) - pl.hand.length));
      if (s.endTrigger !== null) {
        if (s.triggeredThisTurn) { if (s.finalLeft <= 0) s.gameOver = true; }
        else if (--s.finalLeft <= 0) s.gameOver = true;
      }
      s.turnCount++;
      if (s.turnCount >= 400) s.gameOver = true;
      if (s.gameOver) { log(s, 'The game is over.'); s.tasks = []; return; }
      s.current = (s.current + 1) % s.players.length;
    },

    // ---- Kansas City
    foresight(s, task) {
      const col = s.foresight[task.col];
      if (!col.length) return;
      ask(s, 'foresight', 'Kansas City: choose a foresight tile from column ' + (task.col + 1),
        col.map((t, i) => ({ label: tileLabel(t) + tileDest(t), i, col: task.col, tile: t })));
    },

    deliver(s) {
      const pl = s.players[s.current];
      if (pl.certs > 0) {
        const hv = handValue(pl.hand) + pl.permCerts;
        const opts = [];
        for (let k = 0; k <= pl.certs; k++) opts.push({ label: 'Use ' + k + ' temporary certificate' + (k === 1 ? '' : 's') + ' (total value ' + (hv + k) + ')', k });
        ask(s, 'certUse', 'Kansas City: hand value ' + handValue(pl.hand) + ' + ' + pl.permCerts + ' permanent certificate(s). Use temporary certificates?', opts);
      } else push(s, { t: 'deliverCity', used: 0 });
    },

    deliverCity(s, task) {
      const pl = s.players[s.current];
      const value = handValue(pl.hand) + pl.permCerts + task.used;
      let opts = cityOptions(s, s.current, value);
      ask(s, 'city', 'Deliver your herd (value ' + value + ', income $' + value + '). Choose a city:', opts.map((c) => ({
        label: c.name + ' (needs ' + c.req + ', ' + (c.vp >= 0 ? '+' : '') + c.vp + ' VP, transport $' + c.cost + ')',
        city: c.id, cost: c.cost, value, used: task.used,
      })));
    },

    kcReturn(s) { s.players[s.current].location = 'start'; },

    disk(s) {
      const p = s.current, pl = s.players[p];
      pl.disks++;
      const opts = availableUnlocks(pl).map((u) => ({ label: G.UNLOCKS[u].label, u }));
      if (!opts.length) return;
      ask(s, 'unlock', 'Place a disk: remove it from your player board to unlock', opts);
    },

    // ---- sub-decisions for actions
    discardOne(s, task) {
      const pl = s.players[s.current];
      if (!pl.hand.length || task.n <= 0) return;
      push(s, { t: 'discardOne', n: task.n - 1, verb: task.verb });
      ask(s, 'discard', (task.verb || 'Discard') + ' a card (' + task.n + ' left)', uniqueHandOptions(pl), { verb: task.verb });
    },

    buyLoop(s, task) {
      const p = s.current, pl = s.players[p];
      if (task.cb <= 0) return;
      const opts = [];
      const seen = {};
      s.market.forEach((c, i) => {
        const v = G.BREEDS[c.breed].value;
        for (const pr of G.CATTLE_PRICES[v]) {
          const key = c.breed + ':' + pr.cowboys;
          if (seen[key] || pr.cowboys > task.cb) continue;
          const cost = Math.max(0, pr.cost - (task.discount || 0));
          if (cost > pl.money) continue;
          seen[key] = 1;
          opts.push({ label: 'Buy ' + G.BREEDS[c.breed].name + ' (value ' + v + ', ' + G.BREEDS[c.breed].vp + ' VP) for $' + cost + ' using ' + pr.cowboys + ' cowboy' + (pr.cowboys > 1 ? 's' : ''), card: c.id, cowboys: pr.cowboys, cost });
        }
      });
      if (s.marketDeck.length) opts.push({ label: 'Use 1 cowboy to draw 2 cards into the market', drawMarket: true });
      opts.push({ label: 'Done buying', done: true });
      ask(s, 'buy', 'Cattle market: ' + task.cb + ' cowboy(s) left', opts, { cb: task.cb, discount: task.discount });
    },

    upgradeStation(s, task) {
      const p = s.current, pl = s.players[p];
      const opts = task.list.filter((i) => !s.stations[i].owners.includes(p) && G.STATIONS[i].cost <= pl.money)
        .map((i) => ({ label: 'Upgrade station at space ' + G.STATIONS[i].pos + ' for $' + G.STATIONS[i].cost + ' (' + G.STATIONS[i].vp + ' VP' + (s.stations[i].master ? ', station master' : '') + ')', st: i }));
      if (!opts.length) return;
      opts.push({ label: 'Do not upgrade', st: -1 });
      ask(s, 'station', 'Your engine passed a station. Upgrade it?', opts);
    },
  };

  function tileLabel(t) {
    if (t.kind === 'worker') return G.WORKER_NAMES[t.worker];
    if (t.kind === 'hazard') return t.region[0].toUpperCase() + t.region.slice(1) + ' (' + t.vp + ' VP)';
    return (t.color === 'green' ? 'Green' : 'Blue') + ' teepee (' + t.vp + ' VP)';
  }
  G.tileLabel = tileLabel;
  function tileDest(t) { return t.kind === 'worker' ? ' → job market' : ' → trail'; }

  function uniqueHandOptions(pl) {
    const seen = {};
    const opts = [];
    for (const c of pl.hand) {
      if (seen[c.breed]) continue;
      seen[c.breed] = 1;
      const n = pl.hand.filter((h) => h.breed === c.breed).length;
      opts.push({ label: G.BREEDS[c.breed].name + ' (value ' + G.BREEDS[c.breed].value + (n > 1 ? ', you hold ' + n : '') + ')', card: c.id, breed: c.breed });
    }
    return opts;
  }

  function cityOptions(s, p, value) {
    const pl = s.players[p];
    const out = [];
    for (const c of G.CITIES) {
      if (c.req > value) continue;
      if (!c.repeat && pl.cities[c.id]) continue;
      const cost = G.transportCost(c.rail, pl.engine);
      if (cost > pl.money + value) continue;
      out.push(Object.assign({ cost }, c));
    }
    if (!out.length) out.push(Object.assign({ cost: 0 }, G.CITIES[0]));
    return out;
  }
  G.cityOptions = cityOptions;

  function availableUnlocks(pl) {
    return Object.keys(G.UNLOCKS).filter((u) => !pl.unlocks[u] && (!G.UNLOCKS[u].requires || pl.unlocks[G.UNLOCKS[u].requires]));
  }
  G.availableUnlocks = availableUnlocks;

  function buildingActions(s, p, loc) {
    const c = s.board[loc];
    if (!c) return [];
    if (c.kind === 'neutral') return G.NEUTRAL[c.id].actions;
    if (c.kind === 'private' && c.owner === p) return G.PRIVATE[c.b].actions;
    return [];
  }
  G.buildingActions = buildingActions;

  function auxOptions(s, p) {
    const pl = s.players[p], u = pl.unlocks;
    const o = [];
    o.push({ label: 'Aux: gain $' + (u.money2 ? 2 : 1), act: 'aux', aux: 'money', n: u.money2 ? 2 : 1 });
    if (allCards(pl).length > pl.hand.length || pl.hand.length) {
      o.push({ label: 'Aux: draw 1 card, discard 1', act: 'aux', aux: 'draw', n: 1 });
      if (u.draw2) o.push({ label: 'Aux: draw 2 cards, discard 2', act: 'aux', aux: 'draw', n: 2 });
    }
    if (u.cert && pl.certs < certMax(pl)) o.push({ label: 'Aux: gain 1 certificate', act: 'aux', aux: 'cert', n: 1 });
    if (u.cert2 && pl.certs < certMax(pl) && pl.money >= 1) o.push({ label: 'Aux: pay $1, gain 2 certificates', act: 'aux', aux: 'cert', n: 2, cost: 1 });
    if (u.train && pl.money >= 1 && engineTarget(s, p, 1, 1) !== pl.engine) o.push({ label: 'Aux: pay $1, engine forward 1', act: 'aux', aux: 'train', n: 1, cost: 1 });
    if (u.train2 && pl.money >= 2 && engineTarget(s, p, 1, 1) !== pl.engine) o.push({ label: 'Aux: pay $2, engine forward 2', act: 'aux', aux: 'train', n: 2, cost: 2 });
    if (u.trim && pl.engine > 0 && pl.hand.length) o.push({ label: 'Aux: engine back 1, remove 1 card from the game', act: 'aux', aux: 'trim', n: 1 });
    if (u.trim2 && pl.engine > 1 && pl.hand.length > 1) o.push({ label: 'Aux: engine back 2, remove 2 cards from the game', act: 'aux', aux: 'trim', n: 2 });
    return o;
  }

  function hireOptions(s, p, extra) {
    const pl = s.players[p];
    const opts = [];
    const seen = {};
    s.job.slots.forEach((w, i) => {
      if (!w) return;
      const row = Math.floor(i / G.JOB_ROW_SIZE);
      const cost = Math.max(0, G.JOB_ROWS[row] + extra);
      const key = w + ':' + cost;
      if (seen[key] || cost > pl.money || pl.workers[w] >= 6) return;
      seen[key] = 1;
      opts.push({ label: 'Hire ' + G.WORKER_NAMES[w] + ' for $' + cost, slot: i, worker: w, cost });
    });
    return opts;
  }

  function buildOptions(s, p) {
    const pl = s.players[p];
    const own = ownBuildings(s, p);
    const emptySpots = Object.keys(N).filter((id) => N[id].type === 'spot' && !s.board[id]);
    const opts = [];
    for (const b of pl.buildingsLeft) {
      const def = G.PRIVATE[b];
      const spots = [];
      if (def.cost <= pl.workers.craftsman && def.cost * G.CRAFTSMAN_COST <= pl.money)
        for (const id of emptySpots) spots.push({ node: id, craft: def.cost, cost: def.cost * G.CRAFTSMAN_COST });
      for (const id of own) {
        const old = G.PRIVATE[s.board[id].b];
        const diff = def.cost - old.cost;
        if (diff > 0 && diff <= pl.workers.craftsman && diff * G.CRAFTSMAN_COST <= pl.money)
          spots.push({ node: id, craft: diff, cost: diff * G.CRAFTSMAN_COST, replace: s.board[id].b });
      }
      if (spots.length) opts.push({ b, spots });
    }
    return opts;
  }
  G.buildOptions = buildOptions;

  function engineOptions(s, p, n) {
    const pl = s.players[p];
    const out = [];
    const seen = {};
    for (let k = 1; k <= n; k++) {
      const pos = engineTarget(s, p, k, 1);
      if (pos === pl.engine || seen[pos]) continue;
      seen[pos] = 1;
      out.push({ label: 'Move engine to space ' + pos, pos });
    }
    return out;
  }

  function canDo(s, p, a) {
    const pl = s.players[p];
    switch (a.kind) {
      case 'discardBreed': return pl.hand.some((c) => c.breed === a.breed) && !(a.certs && pl.certs >= certMax(pl) && !a.money);
      case 'hire': return hireOptions(s, p, a.extra).length > 0;
      case 'build': return buildOptions(s, p).length > 0;
      case 'cert': return pl.certs < certMax(pl);
      case 'engine': return engineOptions(s, p, pl.workers.engineer + a.bonus).length > 0;
      case 'engineFixed': return engineOptions(s, p, a.n).length > 0;
      case 'buyCattle': return true;
      case 'drawDiscard': return pl.deck.length + pl.discard.length + pl.hand.length > 0;
      case 'removeHazard': return pl.money >= a.cost && Object.values(s.board).some((c) => c && c.kind === 'hazard');
      case 'trade': return Object.keys(N).some((id) => s.board[id] && s.board[id].kind === 'teepee' && pl.money + N[id].trade >= 0);
      case 'objective': return s.objDisplay.length > 0;
      case 'discardPair': return pairBreeds(pl).length > 0;
      default: return true;
    }
  }

  function pairBreeds(pl) {
    const cnt = {};
    for (const c of pl.hand) cnt[c.breed] = (cnt[c.breed] || 0) + 1;
    return Object.keys(cnt).filter((b) => cnt[b] >= 2);
  }

  function discardCard(pl, cardId) {
    const i = pl.hand.findIndex((c) => c.id === cardId);
    if (i >= 0) pl.discard.push(pl.hand.splice(i, 1)[0]);
  }

  function runAction(s, a) {
    const p = s.current, pl = s.players[p];
    const who = pname(s, p);
    switch (a.kind) {
      case 'discardBreed': {
        const c = pl.hand.find((h) => h.breed === a.breed);
        if (!c) return;
        discardCard(pl, c.id);
        pl.money += a.money || 0;
        if (a.certs) pl.certs = Math.min(certMax(pl), pl.certs + a.certs);
        log(s, who + ' discards a ' + G.BREEDS[a.breed].name + (a.money ? ' for $' + a.money : '') + (a.certs ? ' for ' + a.certs + ' certificates' : '') + '.');
        return;
      }
      case 'hire': {
        const opts = hireOptions(s, p, a.extra);
        if (!opts.length) return;
        opts.push({ label: 'Do not hire', skip: true });
        ask(s, 'hire', 'Hire a worker from the job market', opts);
        return;
      }
      case 'build': {
        const opts = buildOptions(s, p).map((o) => {
          const d = G.PRIVATE[o.b];
          return { label: 'Building ' + o.b + ' (' + d.cost + ' craftsm' + (d.cost > 1 ? 'en' : 'an') + ', ' + d.vp + ' VP' + (d.hand ? ', ' + d.hand + ' toll' : '') + '): ' + d.actions.map((x) => x.label).join(' / '), b: o.b, spots: o.spots };
        });
        if (!opts.length) return;
        opts.push({ label: 'Do not build', skip: true });
        ask(s, 'build', 'Build: choose a building tile', opts);
        return;
      }
      case 'cert':
        pl.certs = Math.min(certMax(pl), pl.certs + a.n);
        log(s, who + ' gains ' + a.n + ' certificate' + (a.n > 1 ? 's' : '') + '.');
        return;
      case 'engine': case 'engineFixed': {
        const n = a.kind === 'engine' ? pl.workers.engineer + a.bonus : a.n;
        const opts = engineOptions(s, p, n);
        if (!opts.length) return;
        opts.push({ label: 'Do not move the engine', pos: -1 });
        ask(s, 'engine', 'Move your engine up to ' + n + ' space' + (n > 1 ? 's' : ''), opts);
        return;
      }
      case 'buyCattle':
        push(s, { t: 'buyLoop', cb: pl.workers.cowboy + (a.extraCowboys || 0), discount: 0 });
        return;
      case 'drawDiscard':
        draw(s, pl, a.n);
        log(s, who + ' draws ' + a.n + ' and discards ' + a.n + '.');
        push(s, { t: 'discardOne', n: a.n });
        return;
      case 'removeHazard': {
        const opts = Object.keys(N).filter((id) => s.board[id] && s.board[id].kind === 'hazard')
          .map((id) => ({ label: 'Remove ' + tileLabel(s.board[id]) + ' for $' + a.cost, node: id, cost: a.cost }));
        if (pl.money < a.cost || !opts.length) return;
        opts.push({ label: 'Do not remove', skip: true });
        ask(s, 'hazard', 'Remove a hazard from the trail', opts);
        return;
      }
      case 'trade': {
        const opts = Object.keys(N).filter((id) => s.board[id] && s.board[id].kind === 'teepee' && pl.money + N[id].trade >= 0)
          .map((id) => ({ label: 'Take ' + tileLabel(s.board[id]) + ' (' + (N[id].trade >= 0 ? 'gain $' + N[id].trade : 'pay $' + -N[id].trade) + ')', node: id, money: N[id].trade }));
        if (!opts.length) return;
        opts.push({ label: 'Do not trade', skip: true });
        ask(s, 'teepee', 'Trade with a teepee', opts);
        return;
      }
      case 'objective': {
        const opts = s.objDisplay.map((id) => { const o = objDef(id); return { label: o.label + ' (+' + o.vp + ' / −' + o.pen + ' VP)', obj: id }; });
        opts.push({ label: 'Take none', skip: true });
        ask(s, 'objective', 'Take an objective card (scores at game end; penalty if not met)', opts);
        return;
      }
      case 'discardPair': {
        const opts = pairBreeds(pl).map((b) => ({ label: 'Discard 2× ' + G.BREEDS[b].name + ' for $' + a.money, breed: b, money: a.money }));
        opts.push({ label: 'Do not discard', skip: true });
        ask(s, 'pair', 'Discard a pair of the same breed', opts);
        return;
      }
      case 'money':
        pl.money += a.n;
        log(s, who + ' gains $' + a.n + '.');
        return;
      case 'moneyPerBuilding': {
        const n = ownBuildings(s, p).length * a.n;
        pl.money += n;
        log(s, who + ' gains $' + n + ' from buildings.');
        return;
      }
      case 'moveAgain': {
        const top = s.tasks[s.tasks.length - 1];
        if (top && top.t === 'locAction') s.tasks.pop();
        s.ctx.used = [];
        push(s, { t: 'locAction' }, { t: 'move', limit: a.n });
        return;
      }
    }
  }

  function moveEngine(s, p, pos) {
    const pl = s.players[p];
    const old = pl.engine;
    pl.engine = pos;
    log(s, pname(s, p) + ' moves the engine ' + (pos > old ? 'forward' : 'back') + ' to space ' + pos + '.');
    if (pos > old) {
      const list = [];
      G.STATIONS.forEach((st, i) => { if (st.pos > old && st.pos <= pos && !s.stations[i].owners.includes(p)) list.push(i); });
      if (list.length) push(s, { t: 'upgradeStation', list });
    }
  }

  // ------------------------------------------------------- resolutions
  const RESOLVE = {
    move(s, d, o) {
      const p = s.current, pl = s.players[p];
      let paid = 0;
      for (const pay of o.payments) {
        const amt = Math.min(pay.amt, pl.money);
        pl.money -= amt; paid += amt;
        if (pay.to !== null) s.players[pay.to].money += amt;
      }
      pl.location = o.node;
      pl.path = o.path;
      log(s, pname(s, p) + ' moves to ' + locationName(s, o.node) + (paid ? ' paying $' + paid + ' in tolls' : '') + '.');
    },

    action(s, d, o) {
      if (o.act === 'end') return;
      if (o.act === 'bld') {
        s.ctx.used.push(o.i);
        push(s, { t: 'locAction' }, { t: 'action', a: o.a });
        return;
      }
      // auxiliary action
      const p = s.current, pl = s.players[p];
      s.ctx.used.push('aux');
      const who = pname(s, p);
      if (o.aux === 'money') { pl.money += o.n; log(s, who + ' takes $' + o.n + ' (aux).'); }
      else if (o.aux === 'draw') { draw(s, pl, o.n); log(s, who + ' draws/discards ' + o.n + ' (aux).'); push(s, { t: 'discardOne', n: o.n }); }
      else if (o.aux === 'cert') { pl.money -= o.cost || 0; pl.certs = Math.min(certMax(pl), pl.certs + o.n); log(s, who + ' gains ' + o.n + ' certificate(s) (aux).'); }
      else if (o.aux === 'train') { pl.money -= o.cost; moveEngine(s, p, engineTarget(s, p, o.n, 1)); }
      else if (o.aux === 'trim') { moveEngine(s, p, engineTarget(s, p, o.n, -1)); push(s, { t: 'discardOne', n: o.n, verb: 'Remove from the game' }); }
    },

    discard(s, d, o) {
      const pl = s.players[s.current];
      if (d.verb) {
        const i = pl.hand.findIndex((c) => c.id === o.card);
        if (i >= 0) { pl.hand.splice(i, 1); pl.removed++; }
        log(s, pname(s, s.current) + ' removes a ' + G.BREEDS[o.breed].name + ' from the game.');
      } else discardCard(pl, o.card);
    },

    hire(s, d, o) {
      if (o.skip) return;
      const pl = s.players[s.current];
      pl.money -= o.cost;
      pl.workers[o.worker]++;
      s.job.slots[o.slot] = null;
      log(s, pname(s, s.current) + ' hires a ' + G.WORKER_NAMES[o.worker] + ' for $' + o.cost + '.');
    },

    build(s, d, o) {
      if (o.skip) return;
      ask(s, 'buildSpot', 'Choose where to build building ' + o.b, o.spots.map((sp) => ({
        label: (sp.replace ? 'Replace your building ' + sp.replace + ' at ' : 'Empty site ') + sp.node + ' ($' + sp.cost + ', ' + sp.craft + ' craftsm' + (sp.craft > 1 ? 'en' : 'an') + ')',
        node: sp.node, cost: sp.cost, b: o.b, replace: sp.replace,
      })).concat([{ label: 'Cancel', skip: true }]));
    },

    buildSpot(s, d, o) {
      if (o.skip) return;
      const p = s.current, pl = s.players[p];
      pl.money -= o.cost;
      pl.buildingsLeft = pl.buildingsLeft.filter((b) => b !== o.b);
      s.board[o.node] = { kind: 'private', owner: p, b: o.b };
      log(s, pname(s, p) + ' builds building ' + o.b + ' at ' + o.node + (o.replace ? ' (replacing ' + o.replace + ')' : '') + ' for $' + o.cost + '.');
    },

    engine(s, d, o) { if (o.pos >= 0) moveEngine(s, s.current, o.pos); },

    station(s, d, o) {
      if (o.st < 0) return;
      const p = s.current, pl = s.players[p];
      const st = G.STATIONS[o.st];
      pl.money -= st.cost;
      s.stations[o.st].owners.push(p);
      pl.stations.push(o.st);
      log(s, pname(s, p) + ' upgrades the station at space ' + st.pos + ' ($' + st.cost + ').');
      if (s.stations[o.st].master) {
        const m = s.stations[o.st].master;
        s.stations[o.st].master = null;
        pl.masters.push(m);
        pl.permCerts++;
        log(s, pname(s, p) + ' takes a station master: ' + G.STATION_MASTERS[m].label + '.');
      }
      push(s, { t: 'disk' });
    },

    unlock(s, d, o) {
      const pl = s.players[s.current];
      pl.unlocks[o.u] = true;
      log(s, pname(s, s.current) + ' unlocks: ' + G.UNLOCKS[o.u].label + '.');
    },

    buy(s, d, o) {
      const p = s.current, pl = s.players[p];
      if (o.done) return;
      if (o.drawMarket) {
        for (let i = 0; i < 2 && s.marketDeck.length; i++) s.market.push(s.marketDeck.pop());
        log(s, pname(s, p) + ' uses a cowboy to add 2 cards to the cattle market.');
        push(s, { t: 'buyLoop', cb: d.cb - 1, discount: d.discount });
        return;
      }
      const i = s.market.findIndex((c) => c.id === o.card);
      const card = s.market.splice(i, 1)[0];
      pl.money -= o.cost;
      pl.discard.push(card);
      log(s, pname(s, p) + ' buys a ' + G.BREEDS[card.breed].name + ' for $' + o.cost + '.');
      push(s, { t: 'buyLoop', cb: d.cb - o.cowboys, discount: d.discount });
    },

    hazard(s, d, o) {
      if (o.skip) return;
      const pl = s.players[s.current];
      pl.money -= o.cost;
      pl.hazards.push(s.board[o.node]);
      log(s, pname(s, s.current) + ' removes a ' + tileLabel(s.board[o.node]) + ' hazard.');
      s.board[o.node] = null;
    },

    teepee(s, d, o) {
      if (o.skip) return;
      const pl = s.players[s.current];
      pl.money += o.money;
      pl.teepees.push(s.board[o.node]);
      log(s, pname(s, s.current) + ' trades for a ' + tileLabel(s.board[o.node]) + '.');
      s.board[o.node] = null;
    },

    objective(s, d, o) {
      if (o.skip) return;
      const pl = s.players[s.current];
      s.objDisplay = s.objDisplay.filter((x) => x !== o.obj);
      pl.objectives.push({ id: o.obj });
      if (s.objDeck.length) s.objDisplay.push(s.objDeck.pop());
      log(s, pname(s, s.current) + ' takes objective: ' + objDef(o.obj).label + '.');
    },

    pair(s, d, o) {
      if (o.skip) return;
      const pl = s.players[s.current];
      for (let k = 0; k < 2; k++) { const c = pl.hand.find((h) => h.breed === o.breed); discardCard(pl, c.id); }
      pl.money += o.money;
      log(s, pname(s, s.current) + ' discards a pair of ' + G.BREEDS[o.breed].name + ' for $' + o.money + '.');
    },

    foresight(s, d, o) {
      const col = s.foresight[o.col];
      const tile = col.splice(o.i, 1)[0];
      const where = placeTile(s, tile);
      log(s, pname(s, s.current) + ' picks ' + tileLabel(tile) + (where === null ? ' (no room, discarded)' : '') + '.');
      refillForesight(s, o.col);
    },

    certUse(s, d, o) { push(s, { t: 'deliverCity', used: o.k }); },

    city(s, d, o) {
      const p = s.current, pl = s.players[p];
      pl.money += o.value;
      pl.certs -= o.used;
      pl.discard.push(...pl.hand);
      pl.hand = [];
      pl.money -= Math.min(o.cost, pl.money);
      pl.cities[o.city] = (pl.cities[o.city] || 0) + 1;
      const c = G.CITIES.find((x) => x.id === o.city);
      log(s, pname(s, p) + ' delivers to ' + c.name + ': income $' + o.value + ', transport $' + o.cost + ', ' + c.vp + ' VP.');
      push(s, { t: 'disk' });
      // If nothing can ever fill the job market again, end the game.
      if (s.endTrigger === null && !s.stacks.some((x) => x.length) && !s.foresight.some((x) => x.length)) {
        s.endTrigger = p; s.finalLeft = s.players.length - 1; s.triggeredThisTurn = true;
        log(s, 'The foresight tiles are exhausted: the game end is triggered.');
      }
    },
  };

  // ---------------------------------------------------------- scoring
  function objDef(id) { return G.OBJECTIVES.find((o) => o.id === id) || G.START_OBJECTIVES.find((o) => o.id === id); }
  G.objDef = objDef;

  function objectiveStat(s, p, stat) {
    const pl = s.players[p];
    switch (stat) {
      case 'buildings': return ownBuildings(s, p).length;
      case 'hazards': return pl.hazards.length;
      case 'teepees': return pl.teepees.length;
      case 'tiles': return pl.hazards.length + pl.teepees.length;
      case 'stations': return pl.stations.length;
      case 'bestCity': return Math.max(0, ...G.CITIES.filter((c) => pl.cities[c.id]).map((c) => c.req));
      case 'cities': return Object.keys(pl.cities).length;
      case 'engine': return pl.engine;
      case 'cattle': return allCards(pl).filter((c) => G.BREEDS[c.breed].vp > 0).length;
      default: return pl.workers[stat] || 0;
    }
  }
  G.objectiveStat = objectiveStat;
  G.objectiveMet = (s, p, id) => { const o = objDef(id); return objectiveStat(s, p, o.stat) >= o.n; };

  G.score = function (s, p) {
    const pl = s.players[p];
    const b = {};
    b.money = Math.floor(pl.money / 5);
    b.buildings = ownBuildings(s, p).reduce((t, id) => t + G.PRIVATE[s.board[id].b].vp, 0);
    b.cities = G.CITIES.reduce((t, c) => t + (pl.cities[c.id] || 0) * c.vp, 0);
    b.stations = pl.stations.reduce((t, i) => t + G.STATIONS[i].vp, 0);
    b.hazards = pl.hazards.reduce((t, h) => t + h.vp, 0);
    b.teepees = pl.teepees.reduce((t, h) => t + h.vp, 0);
    b.cattle = allCards(pl).reduce((t, c) => t + G.BREEDS[c.breed].vp, 0);
    let objs = 0, done = 0;
    for (const o of pl.objectives) {
      const d = objDef(o.id);
      if (objectiveStat(s, p, d.stat) >= d.n) { objs += d.vp; done++; } else objs -= d.pen;
    }
    b.objectives = objs;
    let m = 0;
    for (const k of pl.masters) {
      if (k === 'haz') m += 2 * pl.hazards.length;
      else if (k === 'bld') m += 2 * ownBuildings(s, p).length;
      else if (k === 'obj') m += 3 * done;
      else if (k === 'cattle') m += objectiveStat(s, p, 'cattle');
      else if (k === 'worker') m += pl.workers.cowboy + pl.workers.craftsman + pl.workers.engineer;
    }
    b.masters = m;
    b.workers = G.WORKER_TYPES.reduce((t, w) => t + (pl.workers[w] >= 6 ? 4 : 0), 0);
    b.jobToken = pl.jobToken ? 2 : 0;
    b.total = Object.values(b).reduce((t, v) => t + v, 0);
    return b;
  };
})(typeof window !== 'undefined' ? window.GWT : module.exports);
