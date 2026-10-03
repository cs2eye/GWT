// Static game data for the Great Western Trail adaptation.
// Values are adapted for a 2-player game; see README for how they differ from the board game.
(function (G) {
  'use strict';

  G.BREEDS = {
    jersey:       { name: 'Jersey',        value: 1, vp: 0, color: '#9aa0a6', start: 5 },
    dutch:        { name: 'Dutch Belt',    value: 2, vp: 0, color: '#4a8f3c', start: 3 },
    guernsey:     { name: 'Guernsey',      value: 2, vp: 0, color: '#c98a2b', start: 3 },
    angus:        { name: 'Black Angus',   value: 2, vp: 0, color: '#333333', start: 3 },
    holstein:     { name: 'Holstein',      value: 3, vp: 1, color: '#5d7fb5', market: 7 },
    brownswiss:   { name: 'Brown Swiss',   value: 4, vp: 2, color: '#8b5a2b', market: 6 },
    ayrshire:     { name: 'Ayrshire',      value: 4, vp: 3, color: '#b23a48', market: 6 },
    westhighland: { name: 'West Highland', value: 5, vp: 4, color: '#d4a017', market: 5 },
    longhorn:     { name: 'Texas Longhorn',value: 5, vp: 5, color: '#7b3f99', market: 5 },
  };

  // Buying options per breeding value: cowboys required and price.
  G.CATTLE_PRICES = {
    3: [{ cowboys: 1, cost: 6 }],
    4: [{ cowboys: 1, cost: 12 }, { cowboys: 2, cost: 8 }],
    5: [{ cowboys: 2, cost: 12 }, { cowboys: 3, cost: 8 }],
  };
  G.MARKET_SIZE = 7;

  // Toll per hand colour.
  G.TOLL = { green: 1, black: 2 };

  // ---- Trail map -------------------------------------------------------
  // type: start | neutral | spot (private building site) | hazard | teepee | kc
  G.NODES = {
    start: { type: 'start', x: 30, y: 140, next: ['A'] },
    A:   { type: 'neutral', x: 95,  y: 140, next: ['s1', 'fl1'] },
    s1:  { type: 'spot', x: 150, y: 65,  next: ['s2'] },
    s2:  { type: 'spot', x: 220, y: 65,  next: ['B'] },
    fl1: { type: 'hazard', region: 'flood', x: 145, y: 215, next: ['fl2'] },
    fl2: { type: 'hazard', region: 'flood', x: 197, y: 235, next: ['fl3'] },
    fl3: { type: 'hazard', region: 'flood', x: 250, y: 215, next: ['B'] },
    B:   { type: 'neutral', x: 305, y: 140, next: ['s3'] },
    s3:  { type: 'spot', x: 365, y: 140, next: ['s4'] },
    s4:  { type: 'spot', x: 425, y: 140, next: ['C'] },
    C:   { type: 'neutral', x: 485, y: 140, next: ['tp1', 's5'] },
    tp1: { type: 'teepee', x: 535, y: 62, trade: 2, next: ['tp2'] },
    tp2: { type: 'teepee', x: 590, y: 45, trade: 1, next: ['tp3'] },
    tp3: { type: 'teepee', x: 645, y: 45, trade: 0, next: ['tp4'] },
    tp4: { type: 'teepee', x: 700, y: 62, trade: -1, next: ['D'] },
    s5:  { type: 'spot', x: 560, y: 220, next: ['s6'] },
    s6:  { type: 'spot', x: 640, y: 220, next: ['D'] },
    D:   { type: 'neutral', x: 755, y: 140, next: ['s7'] },
    s7:  { type: 'spot', x: 815, y: 140, next: ['E'] },
    E:   { type: 'neutral', x: 880, y: 140, next: ['s8'] },
    s8:  { type: 'spot', x: 960, y: 175, next: ['s9'] },
    s9:  { type: 'spot', x: 1020, y: 280, next: ['F'] },
    F:   { type: 'neutral', x: 1010, y: 410, next: ['dr1', 's10'] },
    dr1: { type: 'hazard', region: 'drought', x: 960, y: 335, next: ['dr2'] },
    dr2: { type: 'hazard', region: 'drought', x: 905, y: 318, next: ['dr3'] },
    dr3: { type: 'hazard', region: 'drought', x: 850, y: 335, next: ['G'] },
    s10: { type: 'spot', x: 955, y: 490, next: ['s11'] },
    s11: { type: 'spot', x: 860, y: 490, next: ['G'] },
    G:   { type: 'neutral', x: 800, y: 410, next: ['s12'] },
    s12: { type: 'spot', x: 740, y: 410, next: ['rk1', 's13'] },
    rk1: { type: 'hazard', region: 'rockfall', x: 690, y: 335, next: ['rk2'] },
    rk2: { type: 'hazard', region: 'rockfall', x: 630, y: 318, next: ['rk3'] },
    rk3: { type: 'hazard', region: 'rockfall', x: 570, y: 335, next: ['s15'] },
    s13: { type: 'spot', x: 680, y: 490, next: ['s14'] },
    s14: { type: 'spot', x: 590, y: 490, next: ['s15'] },
    s15: { type: 'spot', x: 520, y: 410, next: ['s16'] },
    s16: { type: 'spot', x: 460, y: 410, next: ['KC'] },
    KC:  { type: 'kc', x: 380, y: 410, next: [] },
  };
  // Order used to estimate how far along the trail a location is.
  G.TRAIL_ORDER = ['start', 'A', 's1', 'fl1', 's2', 'fl2', 'fl3', 'B', 's3', 's4', 'C', 'tp1', 's5',
    'tp2', 'tp3', 's6', 'tp4', 'D', 's7', 'E', 's8', 's9', 'F', 'dr1', 's10', 'dr2', 'dr3', 's11',
    'G', 's12', 'rk1', 's13', 'rk2', 'rk3', 's14', 's15', 's16', 'KC'];

  // ---- Buildings -------------------------------------------------------
  // Action kinds are interpreted by the engine (see engine.js runAction).
  G.NEUTRAL = {
    A: { name: 'A', actions: [
      { kind: 'discardBreed', breed: 'guernsey', money: 2, label: 'Discard Guernsey: +$2' },
      { kind: 'hire', extra: 0, label: 'Hire a worker' },
      { kind: 'hire', extra: 2, label: 'Hire a worker (+$2)' } ] },
    B: { name: 'B', actions: [
      { kind: 'discardBreed', breed: 'dutch', money: 2, label: 'Discard Dutch Belt: +$2' },
      { kind: 'build', label: 'Build a building' } ] },
    C: { name: 'C', actions: [
      { kind: 'cert', n: 1, label: 'Gain 1 certificate' },
      { kind: 'engine', bonus: 0, label: 'Move engine (1 per engineer)' } ] },
    D: { name: 'D', actions: [
      { kind: 'buyCattle', extraCowboys: 0, label: 'Buy cattle' },
      { kind: 'drawDiscard', n: 2, label: 'Draw 2 cards, then discard 2' } ] },
    E: { name: 'E', actions: [
      { kind: 'discardBreed', breed: 'angus', money: 0, certs: 2, label: 'Discard Black Angus: +2 certificates' },
      { kind: 'build', label: 'Build a building' } ] },
    F: { name: 'F', actions: [
      { kind: 'buyCattle', extraCowboys: 0, label: 'Buy cattle' },
      { kind: 'trade', label: 'Trade with a teepee' },
      { kind: 'removeHazard', cost: 7, label: 'Remove a hazard ($7)' } ] },
    G: { name: 'G', actions: [
      { kind: 'engine', bonus: 0, label: 'Move engine (1 per engineer)' },
      { kind: 'objective', label: 'Take an objective card' },
      { kind: 'discardPair', money: 4, label: 'Discard a pair of one breed: +$4' } ] },
  };

  G.PRIVATE = {
    1:  { cost: 1, vp: 1, hand: 'green', actions: [
      { kind: 'discardBreed', breed: 'guernsey', money: 4, label: 'Discard Guernsey: +$4' } ] },
    2:  { cost: 1, vp: 1, hand: 'green', actions: [
      { kind: 'cert', n: 1, label: 'Gain 1 certificate' },
      { kind: 'engineFixed', n: 1, label: 'Move engine 1' } ] },
    3:  { cost: 1, vp: 1, hand: 'black', actions: [
      { kind: 'hire', extra: -2, label: 'Hire a worker ($2 cheaper)' } ] },
    4:  { cost: 2, vp: 2, hand: 'green', actions: [
      { kind: 'drawDiscard', n: 2, label: 'Draw 2 cards, then discard 2' },
      { kind: 'money', n: 1, label: 'Gain $1' } ] },
    5:  { cost: 2, vp: 2, hand: null, actions: [
      { kind: 'buyCattle', extraCowboys: 1, label: 'Buy cattle (+1 cowboy)' } ] },
    6:  { cost: 3, vp: 3, hand: 'black', actions: [
      { kind: 'removeHazard', cost: 4, label: 'Remove a hazard ($4)' },
      { kind: 'trade', label: 'Trade with a teepee' } ] },
    7:  { cost: 3, vp: 3, hand: 'green', actions: [
      { kind: 'engine', bonus: 1, label: 'Move engine (engineers + 1)' } ] },
    8:  { cost: 4, vp: 4, hand: null, actions: [
      { kind: 'moneyPerBuilding', n: 1, label: 'Gain $1 per building you own' },
      { kind: 'cert', n: 1, label: 'Gain 1 certificate' } ] },
    9:  { cost: 5, vp: 5, hand: 'black', actions: [
      { kind: 'moveAgain', n: 4, label: 'Move your cowboy again (up to 4 steps)' } ] },
    10: { cost: 6, vp: 8, hand: 'black', actions: [
      { kind: 'money', n: 3, label: 'Gain $3' } ] },
  };
  G.CRAFTSMAN_COST = 2; // $ per craftsman used

  // ---- Kansas City / railroad -------------------------------------------
  G.RAIL_LENGTH = 34;
  G.CITIES = [
    { id: 'kc',  name: 'Kansas City',      req: 1,  rail: 0,  vp: -4, repeat: true },
    { id: 'top', name: 'Topeka',           req: 3,  rail: 3,  vp: -2 },
    { id: 'wic', name: 'Wichita',          req: 5,  rail: 6,  vp: -1 },
    { id: 'cos', name: 'Colorado Springs', req: 7,  rail: 9,  vp: 1 },
    { id: 'saf', name: 'Santa Fe',         req: 9,  rail: 12, vp: 2 },
    { id: 'alb', name: 'Albuquerque',      req: 11, rail: 15, vp: 4 },
    { id: 'elp', name: 'El Paso',          req: 13, rail: 18, vp: 6 },
    { id: 'sdg', name: 'San Diego',        req: 15, rail: 22, vp: 8 },
    { id: 'sac', name: 'Sacramento',       req: 17, rail: 26, vp: 10 },
    { id: 'sf',  name: 'San Francisco',    req: 18, rail: 30, vp: 9, repeat: true },
  ];
  G.transportCost = function (cityRail, enginePos) {
    return Math.max(0, Math.ceil((cityRail - enginePos) / 2));
  };

  G.STATIONS = [
    { pos: 5,  cost: 1, vp: 1 },
    { pos: 9,  cost: 2, vp: 2, master: true },
    { pos: 13, cost: 2, vp: 3 },
    { pos: 17, cost: 3, vp: 3, master: true },
    { pos: 21, cost: 3, vp: 4 },
    { pos: 25, cost: 4, vp: 5, master: true },
    { pos: 29, cost: 4, vp: 6, master: true },
    { pos: 33, cost: 5, vp: 7, master: true },
  ];

  G.STATION_MASTERS = {
    haz:    { label: '+1 permanent certificate; 2 VP per hazard tile' },
    bld:    { label: '+1 permanent certificate; 2 VP per private building' },
    obj:    { label: '+1 permanent certificate; 3 VP per completed objective' },
    cattle: { label: '+1 permanent certificate; 1 VP per bought cattle card' },
    worker: { label: '+1 permanent certificate; 1 VP per worker' },
  };

  // ---- Player board upgrades (unlocked by placing disks) ----------------
  G.UNLOCKS = {
    cert:     { label: 'Aux: gain 1 certificate', value: 1.6 },
    train:    { label: 'Aux: pay $1, engine +1', value: 1.2 },
    trim:     { label: 'Aux: engine back 1, remove a card from game', value: 1.3 },
    money2:   { label: 'Aux: gain $2 (instead of $1)', value: 0.9 },
    draw2:    { label: 'Aux: draw 2 / discard 2', value: 0.8 },
    cert2:    { label: 'Aux: pay $1, gain 2 certificates', value: 1.0, requires: 'cert' },
    train2:   { label: 'Aux: pay $2, engine +2', value: 0.8, requires: 'train' },
    trim2:    { label: 'Aux: engine back 2, remove 2 cards', value: 0.8, requires: 'trim' },
    hand5:    { label: 'Hand limit 5', value: 3.2 },
    hand6:    { label: 'Hand limit 6', value: 2.6, requires: 'hand5' },
    step4:    { label: 'Step limit 4', value: 2.6 },
    step5:    { label: 'Step limit 5', value: 1.8, requires: 'step4' },
    certmax6: { label: 'Certificate limit 6 (from 4)', value: 0.6 },
  };

  // ---- Job market ------------------------------------------------------
  G.JOB_ROWS = [5, 5, 6, 4, 6, 7, 5, 7, 8, 6, 5, 4]; // hire cost per row
  G.JOB_ROW_SIZE = 2;
  G.JOB_REFILL_ROWS = [3, 6, 9]; // when the market reaches these rows, refill the cattle market
  G.WORKER_TYPES = ['cowboy', 'craftsman', 'engineer'];
  G.WORKER_NAMES = { cowboy: 'Cowboy', craftsman: 'Craftsman', engineer: 'Engineer' };

  // ---- Foresight tiles --------------------------------------------------
  G.FORESIGHT_POOL = {
    cowboy: 11, craftsman: 11, engineer: 11,
    flood: 5, drought: 5, rockfall: 5,
    teepee_green: 6, teepee_blue: 6,
  };
  G.HAZARD_VP = [2, 2, 3, 3, 4];

  // ---- Objectives -------------------------------------------------------
  // stat names are computed in engine.objectiveStat
  G.OBJECTIVES = [
    { id: 'o1',  label: 'Own 3 private buildings',   stat: 'buildings', n: 3, vp: 3, pen: 2 },
    { id: 'o2',  label: 'Own 2 hazard tiles',        stat: 'hazards',   n: 2, vp: 3, pen: 2 },
    { id: 'o3',  label: 'Own 2 teepee tiles',        stat: 'teepees',   n: 2, vp: 3, pen: 2 },
    { id: 'o4',  label: 'Upgrade 3 stations',        stat: 'stations',  n: 3, vp: 4, pen: 2 },
    { id: 'o5',  label: 'Deliver to a city worth 13+', stat: 'bestCity', n: 13, vp: 4, pen: 2 },
    { id: 'o6',  label: 'Have 4 engineers',          stat: 'engineer',  n: 4, vp: 3, pen: 2 },
    { id: 'o7',  label: 'Have 4 cowboys',            stat: 'cowboy',    n: 4, vp: 3, pen: 2 },
    { id: 'o8',  label: 'Have 4 craftsmen',          stat: 'craftsman', n: 4, vp: 3, pen: 2 },
    { id: 'o9',  label: 'Own 5 private buildings',   stat: 'buildings', n: 5, vp: 5, pen: 3 },
    { id: 'o10', label: 'Engine at space 20+',       stat: 'engine',    n: 20, vp: 4, pen: 2 },
    { id: 'o11', label: 'Own 5 bought cattle cards', stat: 'cattle',    n: 5, vp: 5, pen: 3 },
    { id: 'o12', label: 'Deliver to 5 different cities', stat: 'cities', n: 5, vp: 4, pen: 2 },
    { id: 'o13', label: 'Own 4 hazard/teepee tiles', stat: 'tiles',     n: 4, vp: 5, pen: 3 },
    { id: 'o14', label: 'Upgrade 5 stations',        stat: 'stations',  n: 5, vp: 6, pen: 3 },
  ];
  G.START_OBJECTIVES = [
    { id: 'so1', label: 'Own 2 private buildings', stat: 'buildings', n: 2, vp: 3, pen: 0 },
    { id: 'so2', label: 'Upgrade 2 stations',      stat: 'stations',  n: 2, vp: 3, pen: 0 },
    { id: 'so3', label: 'Own 3 bought cattle cards', stat: 'cattle',  n: 3, vp: 3, pen: 0 },
    { id: 'so4', label: 'Own 2 hazard/teepee tiles', stat: 'tiles',   n: 2, vp: 3, pen: 0 },
  ];
  G.OBJECTIVE_DISPLAY = 3;
})(typeof window !== 'undefined' ? (window.GWT = window.GWT || {}) : (module.exports = {}));
