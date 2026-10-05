// Browser UI: renders the state and routes human choices / schedules AI choices.
(function (G) {
  'use strict';
  const PCOL = ['#d7263d', '#1b6ec2', '#2a9d3f', '#e09400', '#8e44ad'];
  const BOT_NAMES = ['Red Line Co.', 'Blue Arrow', 'Green Transit', 'Golden Coach', 'Violet Express'];
  const BLD = {
    H: { fill: '#f6dfb0', icon: '🏠' },
    O: { fill: '#cfdcea', icon: '🏢' },
    P: { fill: '#ecc6c6', icon: '🍺' },
  };
  const SAVE_KEY = 'bus-save-v1';
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let state = null;
  let aiTimer = null;
  let speed = 400;

  // ------------------------------------------------------------ flow
  function newGame(bots) {
    clearTimeout(aiTimer);
    // the human always takes red; bots take the next colours
    const players = [{ name: 'You', ai: false }];
    for (let i = 1; i <= bots; i++) players.push({ name: BOT_NAMES[i], ai: true });
    state = G.newGame({ players });
    hideModal();
    after();
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }
  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function isHumanTurn() { return state && state.decision && !state.players[state.decision.player].ai; }

  function humanChoose(i) {
    if (!isHumanTurn()) return;
    G.choose(state, i);
    after();
  }
  function after() {
    save();
    render();
    clearTimeout(aiTimer);
    if (state.gameOver) { showGameOver(); return; }
    if (state.decision && state.players[state.decision.player].ai) {
      aiTimer = setTimeout(() => {
        G.choose(state, G.aiChoose(state));
        after();
      }, speed);
    }
  }

  // ----------------------------------------------------------- render
  function render() {
    renderMap();
    renderActions();
    renderDecision();
    renderStatus();
    renderPlayers();
    renderLog();
  }

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function addTitle(el, text) { el.appendChild(svgEl('title', {}, text)); return el; }

  // option indices of the pending human decision, keyed by what they point at on the map
  function targets() {
    const t = { edge: {}, site: {}, station: {} };
    if (!isHumanTurn()) return t;
    const d = state.decision;
    d.options.forEach((o, i) => {
      if (o.edge !== undefined) t.edge[o.edge] = i;
      else if (o.site !== undefined) t.site[o.site] = i;
      else if (o.station !== undefined) t.station[o.station] = i;
    });
    return t;
  }

  function renderMap() {
    const s = state, svg = $('map');
    svg.setAttribute('viewBox', '0 0 ' + G.WIDTH + ' ' + G.HEIGHT);
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: G.WIDTH, height: G.HEIGHT, fill: '#e3e8d8', rx: 8 }));
    const tg = targets();

    // streets
    for (const e of s.edges) {
      const a = s.nodes[e.a], b = s.nodes[e.b];
      svg.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'street' }));
      svg.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'street-mid' }));
    }
    // site connectors
    for (const x of s.sites) {
      const n = s.nodes[x.node];
      svg.appendChild(svgEl('line', { x1: n.x, y1: n.y, x2: x.x, y2: x.y, stroke: '#b9b3a4', 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }));
    }
    // bus lines, offset side by side when several share a street
    for (const e of s.edges) {
      if (!e.lines.length) continue;
      const a = s.nodes[e.a], b = s.nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      e.lines.forEach((p, k) => {
        const off = (k - (e.lines.length - 1) / 2) * 5;
        svg.appendChild(svgEl('line', {
          x1: a.x + nx * off, y1: a.y + ny * off, x2: b.x + nx * off, y2: b.y + ny * off,
          stroke: PCOL[p], 'stroke-width': 4.5, 'stroke-linecap': 'round',
        }));
      });
    }
    // highlighted street options
    for (const eid in tg.edge) {
      const e = s.edges[eid], a = s.nodes[e.a], b = s.nodes[e.b];
      svg.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'target' }));
    }
    for (const e of s.edges) {
      const a = s.nodes[e.a], b = s.nodes[e.b];
      const hit = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hit' });
      if (e.id in tg.edge) {
        hit.addEventListener('click', () => humanChoose(tg.edge[e.id]));
      } else hit.style.cursor = 'default';
      addTitle(hit, e.lines.length ? 'Lines: ' + e.lines.map((p) => s.players[p].name).join(', ') : 'Empty street');
      svg.appendChild(hit);
    }
    // intersections and line ends
    for (const n of s.nodes) {
      if (n.station) continue;
      svg.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 3, fill: '#8d8778' }));
    }
    s.players.forEach((pl, p) => {
      for (const end of G.lineEnds(pl)) {
        const n = s.nodes[end];
        svg.appendChild(svgEl('circle', { cx: n.x + (p - 2) * 3, cy: n.y, r: 4, fill: PCOL[p], stroke: '#fff', 'stroke-width': 1 }));
      }
    });
    // building sites
    const type = G.deliverType(s);
    for (const x of s.sites) {
      const g = svgEl('g', {});
      const sz = 24;
      if (x.b) {
        g.appendChild(svgEl('rect', {
          x: x.x - sz / 2, y: x.y - sz / 2, width: sz, height: sz, rx: 4, fill: BLD[x.b].fill,
          stroke: x.b === type ? '#1f2933' : '#8b8b8b', 'stroke-width': x.b === type ? 2 : 1,
        }));
        g.appendChild(svgEl('text', { x: x.x, y: x.y + 5, class: 'emoji' }, BLD[x.b].icon));
        if (x.pax) {
          g.appendChild(svgEl('circle', { cx: x.x + 10, cy: x.y - 10, r: 5.5, fill: '#1f2933', stroke: '#fff', 'stroke-width': 1.5 }));
        }
      } else {
        g.appendChild(svgEl('rect', { x: x.x - sz / 2, y: x.y - sz / 2, width: sz, height: sz, rx: 4, fill: '#ffffffaa', stroke: '#a7a294', 'stroke-dasharray': '3 2' }));
        g.appendChild(svgEl('text', { x: x.x, y: x.y + 4, class: 'lbl', style: 'fill:#8d8778' }, x.zone));
      }
      addTitle(g, x.b ? G.TYPE_NAME[x.b] + (x.pax ? ' — occupied by a passenger' : ' — empty') : 'Empty building site, zone ' + x.zone + ' (lower zones fill first)');
      if (x.id in tg.site) {
        g.classList.add('clickable');
        g.addEventListener('click', () => humanChoose(tg.site[x.id]));
        g.appendChild(svgEl('rect', { x: x.x - sz / 2 - 4, y: x.y - sz / 2 - 4, width: sz + 8, height: sz + 8, rx: 6, class: 'ring' }));
      }
      svg.appendChild(g);
    }
    // stations
    for (const st of s.stations) {
      const n = s.nodes[st], g = svgEl('g', {});
      g.appendChild(svgEl('rect', { x: n.x - 22, y: n.y - 15, width: 44, height: 30, rx: 6, fill: '#37474f', stroke: '#fff', 'stroke-width': 2 }));
      g.appendChild(svgEl('text', { x: n.x, y: n.y - 1, class: 'lbl', style: 'fill:#fff;font-weight:600' }, '🚉' + G.stationName(s, st)));
      const k = s.stationPax[st];
      g.appendChild(svgEl('text', { x: n.x, y: n.y + 11, class: 'lbl', style: 'fill:#ffd54f;font-size:10px;font-weight:600' }, k + ' pax'));
      addTitle(g, 'Train station ' + G.stationName(s, st) + ': ' + k + ' passenger(s) waiting');
      if (st in tg.station) {
        g.classList.add('clickable');
        g.addEventListener('click', () => humanChoose(tg.station[st]));
        g.appendChild(svgEl('rect', { x: n.x - 26, y: n.y - 19, width: 52, height: 38, rx: 8, class: 'ring' }));
      }
      svg.appendChild(g);
    }
  }

  function renderActions() {
    const s = state, box = $('actions');
    const opts = {};
    if (isHumanTurn() && state.decision.type === 'place') {
      state.decision.options.forEach((o, i) => { if (o.area) opts[o.area] = i; });
    }
    box.innerHTML = '';
    for (const a of G.AREAS) {
      const div = document.createElement('div');
      div.className = 'area' + (a.id in opts ? ' can' : '');
      let slots = '';
      s.spaces[a.id].forEach((p, i) => {
        const v = a.values ? a.values[i] : String.fromCharCode(65 + i);
        slots += p === null ? '<span class="slot">' + v + '</span>'
          : '<span class="slot filled" style="background:' + PCOL[p] + '" title="' + esc(s.players[p].name) + '">' + v + '</span>';
      });
      div.innerHTML = '<div class="nm">' + a.name + '</div><div class="ds">' + areaDesc(a) + '</div><div class="slots">' + slots + '</div>';
      if (a.id in opts) div.addEventListener('click', () => humanChoose(opts[a.id]));
      box.appendChild(div);
    }
  }

  function areaDesc(a) {
    switch (a.id) {
      case 'line': return 'Everyone here extends by the most markers any one player has here';
      case 'pax': return 'Add the shown number of passengers at stations';
      case 'build': return 'Construct the shown number of buildings';
      case 'vroom': return 'Deliver 1 passenger per bus to the clock\'s building type';
      default: return a.short;
    }
  }

  function renderDecision() {
    const box = $('decision');
    const s = state;
    if (s.gameOver) {
      box.className = 'panel decision waiting';
      box.innerHTML = '<div class="prompt">Game over</div><button class="primary" id="go-again">New game</button>';
      $('go-again').onclick = showNewGame;
      return;
    }
    const d = s.decision;
    if (!d) { box.innerHTML = ''; return; }
    const pl = s.players[d.player];
    if (pl.ai) {
      box.className = 'panel decision waiting';
      box.innerHTML = '<div class="thinking"><span class="dot" style="background:' + PCOL[d.player] + '"></span>' + esc(pl.name) + ' is deciding…</div>';
      return;
    }
    box.className = 'panel decision';
    const onMap = (o) => o.edge !== undefined || o.site !== undefined;
    let html = '<div class="prompt">' + esc(d.prompt) + '</div><div class="opts">';
    d.options.forEach((o, i) => {
      if (onMap(o)) return;
      const cls = o.stop || o.pass ? ' class="stop"' : '';
      html += '<button data-i="' + i + '"' + cls + '>' + esc(o.label) + '</button>';
    });
    html += '</div>';
    if (d.options.some(onMap)) html += '<div class="hint">Click a highlighted ' + (d.options.some((o) => o.edge !== undefined) ? 'street' : 'building site') + ' on the map.</div>';
    if (d.type === 'place') html += '<div class="hint">You can also click an action area on the board. Markers left: ' + pl.markers + '.</div>';
    if (d.type === 'vroomPick') html += '<div class="hint">Passengers can ride anywhere along your line. Each one delivered scores 1 VP.</div>';
    box.innerHTML = html;
    box.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => humanChoose(+b.dataset.i)));
  }

  function renderStatus() {
    const s = state;
    let html = '<h2>Round ' + Math.max(1, s.round) + (s.phase === 'setup' ? ' — setup' : s.phase === 'place' ? ' — placing markers' : s.phase === 'resolve' ? ' — resolving actions' : '') + '</h2>';
    html += '<div class="clockrow">Clock: ';
    G.TYPES.forEach((t, i) => {
      html += (i ? '<span class="arrow">→</span>' : '') + '<span class="tm' + (i === s.clock ? ' now' : '') + '">' + BLD[t].icon + ' ' + G.TYPE_NAME[t] + '</span>';
    });
    html += '</div><div class="kv">';
    html += '<div>Time stones left<br><b>' + s.stones + '</b></div>';
    html += '<div>Passenger supply<br><b>' + s.paxSupply + '</b></div>';
    html += '<div>Min. markers / round<br><b>' + G.minMarkers(s) + '</b></div>';
    html += '<div>Starting player<br><b><span class="dot" style="background:' + PCOL[s.start] + '"></span>' + esc(s.players[s.start].name) + '</b></div>';
    html += '</div>';
    $('status').innerHTML = html;
  }

  function renderPlayers() {
    const s = state;
    let html = '<h2>Bus companies</h2><table class="pl"><tr><th></th><th>VP</th><th>Markers</th><th>Buses</th><th>Stones</th><th>Line</th></tr>';
    s.players.forEach((pl, p) => {
      const cur = s.decision && s.decision.player === p;
      const passed = s.phase === 'place' && s.passed[p];
      html += '<tr class="' + (cur ? 'cur' : '') + (passed ? ' passed' : '') + '"><td><span class="dot" style="background:' + PCOL[p] + '"></span>' + esc(pl.name) +
        (passed ? ' <small>(passed)</small>' : '') + '</td><td><b>' + (pl.vp - pl.stones) + '</b></td><td>' + pl.markers +
        (s.phase === 'place' ? ' <small>(' + s.placed[p] + ')</small>' : '') + '</td><td>' + pl.buses + '</td><td>' + pl.stones + '</td><td>' + Math.max(0, pl.line.length - 1) + '</td></tr>';
    });
    html += '</table>';
    $('players').innerHTML = html;
  }

  function renderLog() {
    const ol = $('log');
    ol.innerHTML = state.log.map((l) => {
      const style = l.p >= 0 ? ' style="color:' + PCOL[l.p] + '"' : '';
      return '<li' + (l.p < 0 ? ' class="sys"' : '') + style + '>' + esc(l.msg) + '</li>';
    }).join('');
    ol.scrollTop = ol.scrollHeight;
  }

  // ----------------------------------------------------------- modals
  function showModal(html) { $('modal-box').innerHTML = html; $('modal').classList.remove('hidden'); }
  function hideModal() { $('modal').classList.add('hidden'); }

  function showNewGame() {
    clearTimeout(aiTimer);
    showModal('<h2>New game of Bus</h2><p>How many automated opponents?</p><div class="choice-row">' +
      [2, 3, 4].map((n) => '<button class="primary" data-n="' + n + '">' + n + ' opponents (' + (n + 1) + ' players)</button>').join('') +
      '</div>' + (state && !state.gameOver ? '<button id="nb-cancel">Cancel</button>' : ''));
    $('modal-box').querySelectorAll('button[data-n]').forEach((b) => b.addEventListener('click', () => newGame(+b.dataset.n)));
    const c = $('nb-cancel');
    if (c) c.onclick = () => { hideModal(); after(); };
  }

  function showGameOver() {
    const r = G.ranking(state);
    let html = '<h2>' + (r[0].name === 'You' ? 'You win!' : esc(r[0].name) + ' wins') + '</h2><table><tr><th>Company</th><th>Delivered</th><th>Time stones</th><th>Total</th></tr>';
    for (const x of r) {
      html += '<tr><td><span class="dot" style="background:' + PCOL[x.p] + '"></span>' + esc(x.name) + '</td><td>' + x.delivered + '</td><td>−' + x.stones + '</td><td><b>' + x.total + '</b></td></tr>';
    }
    html += '</table><p style="font-size:12px;color:var(--muted)">Ties are broken by fewer time stones, then more unused markers.</p><button class="primary" id="go-new">New game</button> <button id="go-close">Look at the board</button>';
    showModal(html);
    $('go-new').onclick = showNewGame;
    $('go-close').onclick = hideModal;
  }

  function showRules() {
    showModal(`<h2>How to play</h2>
<p>You run a bus company. Score points by carrying passengers along your bus line to the building type the clock shows. The game is played with 20 action markers per player, and they don't come back.</p>
<h3>Each round</h3>
<ul>
<li><b>Place markers.</b> Starting with the starting player and going round the table, each player places one marker on the next free space of an action area, or passes. Once you pass you are out for the round. You can't pass until you have placed at least as many markers as the <b>most buses any player owns</b>.</li>
<li><b>Resolve.</b> Areas resolve left to right, and spaces within an area in order.</li>
</ul>
<h3>Actions</h3>
<ul>
<li><b>Line Expansion</b>: each player with a marker here extends their line by the highest number of markers any single player has here. Extend from either end of your line. Your line may not visit an intersection twice. You may only use a street that already carries another company's line if that end of your line has no empty street available.</li>
<li><b>Buses</b>: gain a bus (maximum 5). Each bus carries one passenger per Vroom!, but it also raises everyone's minimum marker count.</li>
<li><b>Passengers</b>: place the shown number of passengers at any train stations (30 in the supply).</li>
<li><b>Buildings</b>: construct the shown number of Houses, Offices or Pubs. The inner zone (1) must be full before zone 2 can be built on, and zone 2 before zone 3.</li>
<li><b>Clock</b>: advance the clock House → Office → Pub → House and take a time stone (−1 VP). When the 5th stone is taken, the game ends at the end of that round.</li>
<li><b>Vroom!</b>: for each marker, deliver up to one passenger per bus. A passenger must be on your line (at a station or at a building) and go to an empty building of the current clock type that is also on your line. Each building holds one passenger. Passengers already at the current type stay put. +1 VP per delivery.</li>
<li><b>Starting Player</b>: you go first next round.</li>
</ul>
<h3>Game end</h3>
<p>The game ends at the end of the round in which the last time stone is taken, or when at most one player has markers left. Score = passengers delivered − time stones.</p>
<p style="font-size:12px;color:var(--muted)">A fan adaptation of Jeroen Doumen and Joris Wiersinga's <i>Bus</i> (Splotter Spellen). Some numbers and details differ from the published game.</p>
<button class="primary" id="rules-close">Close</button>`);
    $('rules-close').onclick = () => { hideModal(); };
  }

  // ----------------------------------------------------------- init
  $('btn-new').onclick = showNewGame;
  $('btn-rules').onclick = showRules;
  $('speed').onchange = (e) => { speed = +e.target.value; };
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal') && state) { hideModal(); if (!state.gameOver) after(); } });

  const saved = load();
  if (saved && !saved.gameOver && saved.players) { state = saved; after(); }
  else { state = null; showNewGame(); }
})(window.BUS);
