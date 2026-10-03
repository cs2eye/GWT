// Browser UI: renders the state and routes human choices / schedules AI choices.
(function (G) {
  'use strict';
  const N = G.NODES;
  const PCOL = ['var(--p0)', 'var(--p1)'];
  const PHEX = ['#c9302c', '#2f6fd0'];
  const SAVE_KEY = 'gwt-save-v1';
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let state = null;
  let aiTimer = null;
  let speed = 550;

  // ------------------------------------------------------------ flow
  function newGame() {
    clearTimeout(aiTimer);
    state = G.newGame({ players: [{ name: 'You', ai: false }, { name: 'Rancher Bot', ai: true }] });
    hideModal();
    after();
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }
  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function isHumanTurn() { return state.decision && !state.players[state.decision.player].ai; }

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
        const i = G.aiChoose(state);
        G.choose(state, i);
        after();
      }, speed);
    }
  }

  // ----------------------------------------------------------- render
  function render() {
    renderTrail();
    renderRail();
    renderJob();
    renderForesight();
    renderMarket();
    renderObjectives();
    renderDecision();
    renderPlayer($('me'), 0);
    renderPlayer($('opp'), 1);
    renderLog();
  }

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function addTitle(el, text) { el.appendChild(svgEl('title', {}, text)); return el; }

  function nodeTooltip(id) {
    const n = N[id], c = state.board[id];
    if (n.type === 'kc') return 'Kansas City: pick foresight tiles, collect income and deliver your herd.';
    if (n.type === 'start') return 'Start: your cowboy returns here after Kansas City.';
    if (n.type === 'neutral') return 'Neutral building ' + id + ':\n• ' + G.NEUTRAL[id].actions.map((a) => a.label).join('\n• ');
    if (!c) {
      if (n.type === 'spot') return 'Empty building site ' + id + ' (does not count as a step)';
      if (n.type === 'hazard') return 'Empty ' + n.region + ' area (does not count as a step)';
      return 'Empty teepee area — trading here pays ' + (n.trade >= 0 ? '$' + n.trade : '−$' + -n.trade);
    }
    if (c.kind === 'private') {
      const d = G.PRIVATE[c.b];
      return G.possessive(state.players[c.owner].name).replace(/^y/, 'Y') + ' building ' + c.b + ' (' + d.vp + ' VP' + (d.hand ? ', ' + d.hand + ' toll $' + G.TOLL[d.hand] : '') + '):\n• ' + d.actions.map((a) => a.label).join('\n• ');
    }
    if (c.kind === 'hazard') return c.region + ' hazard: ' + c.vp + ' VP if removed. Toll $' + G.TOLL[c.hand] + ' to pass.';
    return c.color + ' teepee: ' + c.vp + ' VP if traded for (site pays ' + (n.trade >= 0 ? '$' + n.trade : '−$' + -n.trade) + '). Toll $' + G.TOLL[c.hand] + ' to pass.';
  }

  function optionsByNode() {
    const map = {};
    if (!isHumanTurn()) return map;
    state.decision.options.forEach((o, i) => { if (o.node && !(o.node in map)) map[o.node] = i; });
    return map;
  }

  const HAZ_COL = { flood: '#4f8fd1', drought: '#e09a3e', rockfall: '#8a8a8a' };

  function renderTrail() {
    const svg = $('trail');
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 1080, height: 540, fill: '#f4e8cc', rx: 8 }));
    for (const id in N) for (const nx of N[id].next) {
      svg.appendChild(svgEl('line', { x1: N[id].x, y1: N[id].y, x2: N[nx].x, y2: N[nx].y, class: 'edge' }));
    }
    const targets = optionsByNode();
    for (const id in N) {
      const n = N[id], c = state.board[id];
      const g = svgEl('g', {});
      const x = n.x, y = n.y;
      if (n.type === 'start') {
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 16, fill: '#d8c6a0', stroke: '#8b6b3e' }));
        g.appendChild(svgEl('text', { x, y: y + 30, class: 'node-label' }, 'Start'));
      } else if (n.type === 'kc') {
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 34, fill: '#7b4a26', stroke: '#3b2a1a', 'stroke-width': 2 }));
        g.appendChild(svgEl('text', { x, y: y - 2, class: 'node-label', fill: '#fff', style: 'fill:#fff;font-weight:bold' }, 'Kansas'));
        g.appendChild(svgEl('text', { x, y: y + 12, class: 'node-label', style: 'fill:#fff;font-weight:bold' }, 'City'));
      } else if (n.type === 'neutral') {
        g.appendChild(svgEl('rect', { x: x - 22, y: y - 22, width: 44, height: 44, rx: 6, fill: '#e9d3a6', stroke: '#6b4a2a', 'stroke-width': 2 }));
        g.appendChild(svgEl('text', { x, y: y + 7, class: 'node-label node-big' }, id));
      } else if (c && c.kind === 'private') {
        g.appendChild(svgEl('rect', { x: x - 20, y: y - 20, width: 40, height: 40, rx: 5, fill: PHEX[c.owner], stroke: '#222' }));
        g.appendChild(svgEl('text', { x, y: y + 6, class: 'node-label node-big', style: 'fill:#fff' }, c.b));
        const h = G.PRIVATE[c.b].hand;
        if (h) g.appendChild(svgEl('circle', { cx: x + 15, cy: y - 15, r: 6, fill: h === 'green' ? '#3a9b3a' : '#111', stroke: '#fff' }));
      } else if (n.type === 'spot') {
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 11, fill: '#efe2c4', stroke: '#b49a6e', 'stroke-dasharray': '3 3' }));
      } else if (n.type === 'hazard') {
        if (c) {
          g.appendChild(svgEl('polygon', { points: `${x},${y - 21} ${x + 21},${y} ${x},${y + 21} ${x - 21},${y}`, fill: HAZ_COL[c.region], stroke: '#333' }));
          g.appendChild(svgEl('text', { x, y: y + 5, class: 'node-label', style: 'fill:#fff;font-weight:bold' }, c.vp + 'VP'));
          g.appendChild(svgEl('circle', { cx: x + 15, cy: y - 13, r: 5, fill: c.hand === 'green' ? '#3a9b3a' : '#111', stroke: '#fff' }));
        } else {
          g.appendChild(svgEl('polygon', { points: `${x},${y - 12} ${x + 12},${y} ${x},${y + 12} ${x - 12},${y}`, fill: HAZ_COL[n.region], opacity: 0.25 }));
        }
      } else if (n.type === 'teepee') {
        const tc = c ? (c.color === 'green' ? '#3a9b3a' : '#2f6fd0') : '#999';
        g.appendChild(svgEl('polygon', { points: `${x},${y - 20} ${x + 18},${y + 14} ${x - 18},${y + 14}`, fill: tc, opacity: c ? 1 : 0.25, stroke: c ? '#333' : 'none' }));
        if (c) g.appendChild(svgEl('text', { x, y: y + 10, class: 'node-label', style: 'fill:#fff;font-weight:bold' }, c.vp));
        g.appendChild(svgEl('text', { x, y: y + 30, class: 'node-label', style: 'font-size:10px' }, (n.trade >= 0 ? '+$' + n.trade : '−$' + -n.trade)));
      }
      addTitle(g, nodeTooltip(id));
      if (id in targets) {
        g.classList.add('clickable');
        g.addEventListener('click', () => humanChoose(targets[id]));
      }
      svg.appendChild(g);
      if (id in targets) svg.appendChild(svgEl('circle', { cx: x, cy: y, r: n.type === 'kc' ? 40 : 27, class: 'target-ring' }));
    }
    // cowboys
    state.players.forEach((pl, i) => {
      const n = N[pl.location];
      const off = i === 0 ? -14 : 14;
      const g = svgEl('g', {});
      g.appendChild(svgEl('circle', { cx: n.x + off, cy: n.y + 26, r: 9, fill: PHEX[i], class: 'cowboy' }));
      g.appendChild(svgEl('text', { x: n.x + off, y: n.y + 30, class: 'node-label', style: 'fill:#fff;font-size:10px;font-weight:bold' }, i === 0 ? 'Y' : 'AI'));
      addTitle(g, pl.name + "'s cowboy");
      svg.appendChild(g);
    });
    // legend
    const lg = svgEl('g', {});
    lg.appendChild(svgEl('text', { x: 16, y: 520, class: 'node-label', style: 'text-anchor:start;font-size:11px' },
      'Hover a location for details. Empty sites don’t count as steps. Dots on tiles = toll when passing (green $1, black $2).'));
    svg.appendChild(lg);
  }

  function railX(pos) { return 40 + pos * (1000 / G.RAIL_LENGTH); }
  function renderRail() {
    const svg = $('rail');
    svg.innerHTML = '';
    svg.appendChild(svgEl('line', { x1: railX(0), y1: 62, x2: railX(G.RAIL_LENGTH), y2: 62, stroke: '#6b4a2a', 'stroke-width': 4 }));
    for (let i = 0; i <= G.RAIL_LENGTH; i++) {
      svg.appendChild(svgEl('line', { x1: railX(i), y1: 56, x2: railX(i), y2: 68, stroke: '#6b4a2a', 'stroke-width': 2 }));
      if (i % 5 === 0) svg.appendChild(svgEl('text', { x: railX(i), y: 80, class: 'node-label', style: 'font-size:9px;fill:#7a6650' }, i));
    }
    G.STATIONS.forEach((st, i) => {
      const x = railX(st.pos);
      const g = svgEl('g', {});
      g.appendChild(svgEl('rect', { x: x - 17, y: 8, width: 34, height: 34, rx: 4, fill: '#fff', stroke: '#6b4a2a' }));
      g.appendChild(svgEl('text', { x, y: 22, class: 'node-label', style: 'font-size:10px' }, '$' + st.cost));
      g.appendChild(svgEl('text', { x, y: 35, class: 'node-label', style: 'font-size:10px;font-weight:bold' }, st.vp + 'VP'));
      if (state.stations[i].master) g.appendChild(svgEl('text', { x: x + 20, y: 14, class: 'node-label', style: 'font-size:12px' }, '★'));
      state.stations[i].owners.forEach((o, k) => g.appendChild(svgEl('circle', { cx: x - 10 + k * 20, cy: 46, r: 5, fill: PHEX[o], stroke: '#fff' })));
      addTitle(g, 'Station at space ' + st.pos + ': pay $' + st.cost + ' when your engine passes it for ' + st.vp + ' VP (and place a disk).' +
        (state.stations[i].master ? '\nStation master: ' + G.STATION_MASTERS[state.stations[i].master].label : ''));
      svg.appendChild(g);
    });
    G.CITIES.forEach((c) => {
      const x = railX(c.rail);
      const g = svgEl('g', {});
      g.appendChild(svgEl('circle', { cx: x, cy: 96, r: 5, fill: '#7b4a26' }));
      g.appendChild(svgEl('text', { x, y: 112, class: 'node-label', style: 'font-size:9px' }, c.name.length > 11 ? c.name.split(' ').map((w) => w.slice(0, 4)).join(' ') : c.name));
      g.appendChild(svgEl('text', { x, y: 124, class: 'node-label', style: 'font-size:9px;fill:#7a6650' }, '≥' + c.req + ' · ' + (c.vp > 0 ? '+' : '') + c.vp));
      state.players.forEach((pl, i) => { if (pl.cities[c.id]) g.appendChild(svgEl('circle', { cx: x - 8 + i * 16, cy: 88, r: 4, fill: PHEX[i] })); });
      addTitle(g, c.name + ': needs herd value ' + c.req + ', ' + c.vp + ' VP' + (c.repeat ? ' (repeatable)' : ''));
      svg.appendChild(g);
    });
    state.players.forEach((pl, i) => {
      const x = railX(pl.engine) + (pl.engine === 0 ? (i ? 8 : -8) : 0);
      const g = svgEl('g', {});
      g.appendChild(svgEl('rect', { x: x - 8, y: 54, width: 16, height: 16, rx: 3, fill: PHEX[i], stroke: '#fff', 'stroke-width': 2 }));
      addTitle(g, pl.name + "'s engine at space " + pl.engine);
      svg.appendChild(g);
    });
  }

  function chip(cls, text, title) { return '<span class="chip ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>'; }

  function renderJob() {
    const rows = [];
    const curRow = Math.floor(state.job.placed / G.JOB_ROW_SIZE);
    for (let r = 0; r < G.JOB_ROWS.length; r++) {
      let cells = '';
      for (let k = 0; k < G.JOB_ROW_SIZE; k++) {
        const i = r * G.JOB_ROW_SIZE + k;
        const w = state.job.slots[i];
        if (w) cells += chip(w, G.WORKER_NAMES[w]);
        else cells += chip('empty', i < state.job.placed ? 'hired' : '—');
      }
      const refill = G.JOB_REFILL_ROWS.includes(r + 1) ? ' <span title="Completing this row refills the cattle market">🐄</span>' : '';
      rows.push('<div class="jobrow' + (r === curRow ? ' current' : '') + '"><span class="cost">$' + G.JOB_ROWS[r] + '</span>' + cells + refill + '</div>');
    }
    const left = state.job.slots.length - state.job.placed;
    $('job').innerHTML = '<div class="hint" style="font-size:12px;color:var(--muted);margin-bottom:4px">' + left + ' empty slot' + (left === 1 ? '' : 's') + ' left — the game ends when the market is full.</div>' + rows.join('');
  }

  function tileChip(t) {
    if (t.kind === 'worker') return chip(t.worker, G.tileLabel(t));
    return chip(t.kind, G.tileLabel(t));
  }
  function renderForesight() {
    let h = '<div class="fcols">';
    state.foresight.forEach((col, c) => {
      h += '<div class="fcol"><b>Column ' + (c + 1) + '</b>' + (col.length ? col.map(tileChip).join('') : '<span class="chip empty">empty</span>') + '</div>';
    });
    h += '</div><div style="font-size:12px;color:var(--muted);margin-top:6px">Tiles left in stacks: ' + state.stacks.reduce((t, s) => t + s.length, 0) + '</div>';
    $('foresight').innerHTML = h;
  }

  function cardHtml(c, small) {
    const b = G.BREEDS[c.breed];
    return '<div class="card' + (small ? ' small' : '') + '" style="background:' + b.color + '" title="' + esc(b.name + ': breeding value ' + b.value + (b.vp ? ', ' + b.vp + ' VP at game end' : '')) + '">' +
      '<div>' + esc(b.name) + '</div><div class="val">' + b.value + '</div><div class="vp">' + (b.vp ? b.vp + ' VP' : '') + '</div></div>';
  }
  function renderMarket() {
    const prices = Object.keys(G.CATTLE_PRICES).map((v) => 'value ' + v + ': ' + G.CATTLE_PRICES[v].map((p) => p.cowboys + ' cowboy' + (p.cowboys > 1 ? 's' : '') + ' $' + p.cost).join(' or ')).join(' · ');
    $('market').innerHTML = '<div class="cards">' + (state.market.length ? state.market.map((c) => cardHtml(c)).join('') : '<i>empty</i>') + '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-top:6px">Prices — ' + prices + '. Cards left in market deck: ' + state.marketDeck.length + '</div>';
  }

  function renderObjectives() {
    $('objectives').innerHTML = state.objDisplay.map((id) => {
      const o = G.objDef(id);
      return '<div class="obj">' + esc(o.label) + ' — <b>+' + o.vp + '</b> / −' + o.pen + ' VP</div>';
    }).join('') + '<div style="font-size:12px;color:var(--muted)">Take one at building G.</div>';
  }

  function renderBuildRef() {
    let h = '<div class="buildref">';
    for (const id in G.NEUTRAL) h += '<div><b>' + id + '</b> — ' + G.NEUTRAL[id].actions.map((a) => esc(a.label)).join(' · ') + '</div>';
    for (const b in G.PRIVATE) {
      const d = G.PRIVATE[b];
      h += '<div><b>#' + b + '</b> (' + d.cost + ' craftsm., ' + d.vp + ' VP' + (d.hand ? ', ' + d.hand + ' toll' : '') + ') — ' + d.actions.map((a) => esc(a.label)).join(' · ') + '</div>';
    }
    $('buildref').innerHTML = h + '</div>';
  }

  function renderDecision() {
    const el = $('decision');
    if (state.gameOver) {
      el.className = 'panel decision';
      el.innerHTML = '<div class="prompt">Game over</div><button id="show-final">Show final scores</button>';
      $('show-final').onclick = showGameOver;
      return;
    }
    const d = state.decision;
    if (!d) { el.innerHTML = ''; return; }
    if (state.players[d.player].ai) {
      el.className = 'panel decision waiting';
      el.innerHTML = '<div class="thinking">' + esc(state.players[d.player].name) + ' is playing… (' + esc(d.prompt) + ')</div>';
      return;
    }
    el.className = 'panel decision';
    const pl = state.players[d.player];
    let h = '<div class="prompt">' + esc(d.prompt) + '</div><div class="opts">';
    d.options.forEach((o, i) => {
      const cls = o.act === 'aux' ? 'aux' : o.act === 'end' ? 'end' : o.act === 'bld' ? 'bld' : '';
      h += '<button data-i="' + i + '" class="' + cls + '">' + esc(o.label) + '</button>';
    });
    h += '</div>';
    let hint = '';
    if (d.type === 'move') hint = 'Click a highlighted location on the map, or a button above. Your step limit is ' + G.stepLimit(pl) + '.';
    else if (d.type === 'buildSpot' || d.type === 'hazard' || d.type === 'teepee') hint = 'You can also click the highlighted location on the map.';
    if (d.type === 'move' || d.type === 'action' || d.type === 'city' || d.type === 'certUse')
      hint += (hint ? ' ' : '') + 'Current hand value: ' + G.handValue(pl.hand) + '.';
    if (hint) h += '<div class="hint">' + esc(hint) + '</div>';
    el.innerHTML = h;
    el.querySelectorAll('button[data-i]').forEach((b) => { b.onclick = () => humanChoose(+b.dataset.i); });
  }

  function renderPlayer(el, p) {
    const pl = state.players[p];
    const sc = G.score(state, p);
    const turn = !state.gameOver && state.current === p;
    let h = '<div class="pboard"><h2><span><span class="dot" style="background:' + PHEX[p] + '"></span>' + esc(pl.name) + (turn ? ' ◀ turn' : '') + '</span><span>' + sc.total + ' VP</span></h2>';
    h += '<div class="stats">' +
      '<div>Money<b>$' + pl.money + '</b></div>' +
      '<div title="Temporary (max ' + G.certMax(pl) + ') + permanent">Certificates<b>' + pl.certs + (pl.permCerts ? ' +' + pl.permCerts : '') + '</b></div>' +
      '<div>Engine<b>' + pl.engine + '</b></div>' +
      '<div>Cowboys<b>' + pl.workers.cowboy + '</b></div>' +
      '<div>Craftsmen<b>' + pl.workers.craftsman + '</b></div>' +
      '<div>Engineers<b>' + pl.workers.engineer + '</b></div>' +
      '<div>Steps<b>' + G.stepLimit(pl) + '</b></div>' +
      '<div>Hand limit<b>' + G.handLimit(pl) + '</b></div>' +
      '<div title="Deck / discard">Deck<b>' + pl.deck.length + ' / ' + pl.discard.length + '</b></div>' +
      '</div>';
    const un = Object.keys(pl.unlocks);
    h += '<div class="unlocks">Unlocked: ' + (un.length ? un.map((u) => esc(G.UNLOCKS[u].label)).join('; ') : 'nothing yet') + '</div>';
    if (pl.masters.length) h += '<div class="unlocks">Station masters: ' + pl.masters.map((m) => esc(G.STATION_MASTERS[m].label)).join('; ') + '</div>';
    if (!pl.ai) {
      h += '<div style="margin:6px 0 2px">Hand (value <b>' + G.handValue(pl.hand) + '</b>):</div><div class="cards">' + pl.hand.map((c) => cardHtml(c, true)).join('') + '</div>';
    } else {
      h += '<div class="unlocks">Hand: ' + pl.hand.length + ' cards</div>';
    }
    const tiles = pl.hazards.map((t) => G.tileLabel(t)).concat(pl.teepees.map((t) => G.tileLabel(t)));
    if (tiles.length) h += '<div class="unlocks">Tiles: ' + esc(tiles.join(', ')) + '</div>';
    h += '<div style="margin-top:6px">' + pl.objectives.map((o) => {
      const d = G.objDef(o.id);
      const met = G.objectiveMet(state, p, o.id);
      return '<div class="obj' + (met ? ' met' : '') + '">' + (met ? '✔ ' : '') + esc(d.label) + ' (+' + d.vp + (d.pen ? ' / −' + d.pen : '') + ')</div>';
    }).join('') + '</div>';
    h += '</div>';
    el.innerHTML = h;
  }

  function renderLog() {
    const el = $('log');
    const items = state.log.slice(-80).reverse();
    // Engine messages are written in the third person; fix the verb for the human ("You buys" -> "You buy").
    const fix = (m) => m.replace(/^You (\w+?)(e?)s\b/, (all, v, e) => 'You ' + v + (/(ss|sh|ch|x)$/.test(v) ? '' : e));
    el.innerHTML = items.map((l) => '<li class="p' + l.p + '">' + esc(fix(l.msg)) + '</li>').join('');
  }

  // ----------------------------------------------------------- modals
  function showModal(html) { $('modal-box').innerHTML = html; $('modal').classList.remove('hidden'); }
  function hideModal() { $('modal').classList.add('hidden'); }

  function showGameOver() {
    const rows = [['money', 'Money ($5 = 1 VP)'], ['buildings', 'Private buildings'], ['cities', 'Cities'], ['stations', 'Stations'],
      ['hazards', 'Hazards'], ['teepees', 'Teepees'], ['cattle', 'Cattle cards'], ['objectives', 'Objectives'],
      ['masters', 'Station masters'], ['workers', '6 workers of a type'], ['jobToken', 'Job market token'], ['total', 'Total']];
    const sc = state.players.map((_, p) => G.score(state, p));
    const winner = sc[0].total === sc[1].total ? (state.players[0].money >= state.players[1].money ? 0 : 1) : (sc[0].total > sc[1].total ? 0 : 1);
    let h = '<h2>' + (winner === 0 ? '🏆 You win!' : '🤠 ' + esc(state.players[1].name) + ' wins') + '</h2><table><tr><th></th>' +
      state.players.map((p) => '<th>' + esc(p.name) + '</th>').join('') + '</tr>';
    for (const [k, label] of rows) h += '<tr' + (k === 'total' ? ' style="font-weight:bold"' : '') + '><td>' + label + '</td>' + sc.map((s) => '<td>' + s[k] + '</td>').join('') + '</tr>';
    h += '</table><button id="m-new">New game</button> <button id="m-close">Close</button>';
    showModal(h);
    $('m-new').onclick = newGame;
    $('m-close').onclick = hideModal;
  }

  function showRules() {
    showModal(`<h2>How to play</h2>
<p>Drive your herd from the start of the trail to <b>Kansas City</b> again and again. Each delivery earns money and victory points (VP). The player with the most VP at the end wins.</p>
<h3>Your turn</h3>
<ol>
<li><b>Move</b> your cowboy up to your step limit (3 at first). Only occupied locations count as steps — neutral buildings A–G, private buildings, hazards and teepees. Empty sites are skipped. You can't stop where the other cowboy stands. Passing or stopping on a hazard, teepee or the opponent's building with a hand pays a toll (green $1, black $2).</li>
<li><b>Act</b>: on a neutral building or one of your own buildings, use its actions in any order (each once) — <i>or</i> take a single auxiliary action instead. Elsewhere you may take one auxiliary action.</li>
<li>Your hand is refilled to your hand limit.</li>
</ol>
<h3>Kansas City</h3>
<ol>
<li>Pick one foresight tile from each of the 3 columns. Workers go to the job market, hazards and teepees onto the trail.</li>
<li>Your herd value is the sum of the breeding values of the <b>different</b> breeds in your hand, plus any certificates you choose to use. You earn that much money.</li>
<li>Deliver to a city whose requirement is at most your herd value (each city once, except Kansas City and San Francisco). Pay transport: $1 per 2 rail spaces between your engine and the city.</li>
<li>Every delivery and every station upgrade places a disk, which unlocks an upgrade: more steps, bigger hand, or better auxiliary actions.</li>
</ol>
<h3>Key actions</h3>
<ul>
<li><b>Hire</b> workers: cowboys buy cattle, craftsmen build, engineers move your engine.</li>
<li><b>Buy cattle</b>: better breeds raise your herd value and score VP.</li>
<li><b>Build</b>: private buildings give VP, extra actions for you and tolls from your opponent. Cost = $2 per craftsman used. You may replace your own building with a pricier one, paying only the difference.</li>
<li><b>Move engine</b>: cheaper transport, and you may upgrade a station you pass (VP + a disk; some have a station master ★).</li>
<li>Remove hazards and trade with teepees for VP; take objective cards at G.</li>
</ul>
<h3>Game end</h3>
<p>When the last job-market slot is filled, that player gets 2 VP and the other player takes one final turn. Score money ($5 = 1 VP), buildings, cities, stations, hazards, teepees, cattle cards, objectives (penalty if failed), station masters and 4 VP for each worker type with 6 workers.</p>
<p style="font-size:12px;color:var(--muted)">This is a streamlined fan adaptation of Alexander Pfister's <i>Great Western Trail</i> for 2 players. Building effects, costs and tracks are simplified — see README.md.</p>
<button id="m-close">Close</button>`);
    $('m-close').onclick = hideModal;
  }

  // ------------------------------------------------------------ boot
  function boot() {
    // Two-click confirmation (browser confirm() dialogs are blocked in some embeds).
    let armed = null;
    $('btn-new').onclick = (e) => {
      const btn = e.currentTarget;
      if (!state || state.gameOver || armed) { clearTimeout(armed); armed = null; btn.textContent = 'New game'; newGame(); return; }
      btn.textContent = 'Click again to restart';
      armed = setTimeout(() => { armed = null; btn.textContent = 'New game'; }, 3000);
    };
    $('btn-rules').onclick = showRules;
    $('speed').onchange = (e) => { speed = +e.target.value; };
    $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') hideModal(); });
    renderBuildRef();
    const saved = load();
    if (saved && !saved.gameOver && saved.players && saved.decision) { state = saved; after(); }
    else { newGame(); showRules(); }
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.GWT);
