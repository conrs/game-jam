// The Last Leaf: the first snow can't fall until every leaf has touched the ground.
// Build fires under the tree; their warm air lifts leaves back up. Hold off winter.

import * as sfx from './audio.js';

const W = 160;
const H = 240;
const GROUND = 212;
const LEAF_COUNT = 48;

const SLOTS = [16, 46, 80, 114, 144];   // fire pit x positions
const COLUMN_HALF = 13;                 // half-width of a fire's warm column
const GRAVITY = 18;                     // leaves fall slowly
const MAX_FALL = 22;
const LIFT = 62;                        // warm-air lift at full heat, near the ground
const MAX_LOGS = 4;
const FUEL_PER_LOG = 5;
const MAX_FUEL = 12;

const LEAF_COLORS = ['#e0642c', '#f0a030', '#c8382c', '#f5c84a', '#a8452a'];
const LEAF_FRAMES = [
  ['.#.', '###', '.#.'],
  ['##.', '###', '.##'],
  ['.##', '###', '##.'],
  ['###', '.#.', '...'],
];
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Sky, sun and hills: a W x GROUND image, with the W x (H - GROUND) ground strip below.
const backdrop = new Image();
backdrop.src = 'art/background.png';
const groundArt = new Image();
groundArt.src = 'art/ground.png';
// Storm clouds: a W-wide strip that tiles sideways, fringe along the bottom.
const cloudArt = new Image();
cloudArt.src = 'art/clouds.png';
const CLOUD_DRIFT = 2; // px/s, plus a share of the wind
let cloudX = 0;
const stage = document.getElementById('stage');
const ui = {
  time: document.getElementById('hud-time'),
  best: document.getElementById('hud-best'),
  logs: document.getElementById('hud-logs'),
  leaves: document.getElementById('hud-leaves'),
  popups: document.getElementById('popups'),
  overlay: document.getElementById('overlay'),
  screens: document.querySelectorAll('.screen'),
  result: document.getElementById('result'),
  scores: document.getElementById('scores'),
  you: document.getElementById('you'),
  nameHint: document.getElementById('name-hint'),
  levels: document.querySelectorAll('input[data-level]'),
  playerStatus: document.getElementById('player-status'),
  playerBtn: document.getElementById('player-btn'),
  mute: document.getElementById('mute'),
  fullscreen: document.getElementById('fullscreen'),
  pauseBtn: document.getElementById('pause'),
};

// --- Save (Betacade reads localStorage JSON) -----------------------------------

// Namespaced because itch.io serves every game from one origin.
const SAVE_KEY = 'game-jam:save';

const save = (() => {
  const defaults = { bestTime: 0, runs: 0 };
  try {
    let raw = localStorage.getItem(SAVE_KEY);
    // Older builds used a bare "save" key. Only carry it over on Betacade, where the
    // game has its own storage; elsewhere it could be another game's save.
    if (raw === null && window.wt?.host === 'betacade') raw = localStorage.getItem('save');
    return { ...defaults, ...JSON.parse(raw || '{}') };
  } catch {
    return defaults;
  }
})();

let runPaused = false; // our own pause menu (Betacade's pause is `paused`, further down)
let screen = null;    // the menu screen showing, or null while playing
let settingsFrom = 'menu';
let myBoard = null; // {best, rank, ...} from the last score sent to the global board
let boardRequest = 0;

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage blocked: the game still plays.
  }
}

const track = (event, props) => window.wt?.track(event, props);

// --- Helpers -------------------------------------------------------------------

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rect(c, color, x, y, w, h) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// --- Tree ------------------------------------------------------------------------

// A full-size W x H layer, transparent around the tree.
const treeArt = new Image();
treeArt.src = 'art/tree.png';

// Branch tips, where leaves hang. The tree art was drawn over this branch
// layout, so its tips line up with the art's twigs; redrawing the tree in a
// different shape means replacing this with the new tip positions.
const tips = [];

function findTips() {
  const rand = mulberry32(1031);
  function branch(x, y, ang, len, depth) {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    if (depth === 0) {
      tips.push({ x: x2, y: y2 });
      return;
    }
    const n = rand() < 0.35 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.55 + (rand() - 0.5) * 0.5;
      // Pull branches back toward upward so the crown stays on screen.
      const a = ang + spread + (-Math.PI / 2 - ang) * 0.15;
      branch(x2, y2, a, len * (0.66 + rand() * 0.14), depth - 1);
    }
  }
  branch(80, GROUND, -Math.PI / 2, 44, 5);
}

// --- State ---------------------------------------------------------------------

let s = null;

function newLeaves() {
  const rand = mulberry32(Date.now() & 0xffff);
  return Array.from({ length: LEAF_COUNT }, () => {
    const tip = tips[Math.floor(rand() * tips.length)];
    const home = { x: clamp(tip.x + (rand() - 0.5) * 10, 4, W - 4), y: clamp(tip.y + (rand() - 0.5) * 8, 50, GROUND - 60) };
    return {
      state: 'tree',
      x: home.x, y: home.y, vx: 0, vy: 0,
      home,
      color: LEAF_COLORS[Math.floor(rand() * LEAF_COLORS.length)],
      phase: rand() * Math.PI * 2,
    };
  });
}

function makeState(phase) {
  return {
    phase,
    t: 0,
    leaves: newLeaves(),
    fires: SLOTS.map((x) => ({ x, fuel: 0, heat: 0 })),
    logs: 3,
    logTimer: 0,
    shedTimer: 2.5,
    wind: 0,
    windTarget: 0,
    gustTimer: 6,
    sparks: [],
    flakes: [],
    stormT: 0,
    rescues: 0,
  };
}

function startRun() {
  s = makeState('play');
  save.runs++;
  track('run.start', { run: save.runs });
  sfx.start();
  sfx.music('game');
  showScreen(null);
}

// --- Difficulty ramps with time --------------------------------------------------

const shedInterval = (t) => Math.max(0.35, 2.2 - t * 0.025);
const gustStrength = (t) => Math.min(42, 10 + t * 0.35);
const burnRate = (t) => 1 + t * 0.008;
const logInterval = (t) => Math.min(3.6, 2.2 + t * 0.012);

// --- Rules ---------------------------------------------------------------------

function counts() {
  let tree = 0, air = 0, ground = 0;
  for (const l of s.leaves) {
    if (l.state === 'tree') tree++;
    else if (l.state === 'air') air++;
    else ground++;
  }
  return { tree, air, ground };
}

function lightFire(i) {
  if (s.phase !== 'play' || runPaused) return;
  const f = s.fires[i];
  if (s.logs < 1) {
    sfx.noLogs();
    popup('NO LOGS', f.x, GROUND - 14, 'cold');
    return;
  }
  if (f.fuel >= MAX_FUEL - 1) return; // already roaring; don't waste a log
  s.logs--;
  f.fuel = Math.min(MAX_FUEL, f.fuel + FUEL_PER_LOG);
  sfx.light();
  for (let k = 0; k < 10; k++) spark(f.x, GROUND - 4, 1.4);
}

function shed() {
  const attached = s.leaves.filter((l) => l.state === 'tree');
  if (!attached.length) return;
  // Sometimes a flurry: several leaves from one side of the crown at once.
  const flurry = s.t > 20 && Math.random() < 0.18;
  let picks;
  if (flurry) {
    const side = Math.random() < 0.5 ? -1 : 1;
    attached.sort((a, b) => side * (b.home.x - a.home.x));
    picks = attached.slice(0, 3 + Math.floor(s.t / 40));
  } else {
    picks = [attached[Math.floor(Math.random() * attached.length)]];
  }
  for (const l of picks) {
    l.state = 'air';
    l.vx = (Math.random() - 0.5) * 6;
    l.vy = 0;
  }
}

function updateLeaves(dt) {
  for (const l of s.leaves) {
    if (l.state === 'tree') continue;

    let lift = 0;
    for (const f of s.fires) {
      if (f.heat <= 0 || Math.abs(l.x - f.x) > COLUMN_HALF) continue;
      const near = clamp((l.y - 20) / (GROUND - 20), 0.25, 1); // weaker higher up
      lift += f.heat * LIFT * near;
    }

    if (l.state === 'ground') {
      if (lift > LIFT * 0.5) {
        l.state = 'air';
        l.vy = -30;
        s.rescues++;
        sfx.rescue();
      }
      continue;
    }

    l.vy += (GRAVITY - lift) * dt;
    l.vy = clamp(l.vy, -40, MAX_FALL);
    l.vx += s.wind * dt;
    l.vx *= 1 - 1.2 * dt;
    l.x += (l.vx + Math.sin(s.t * 2 + l.phase) * 8) * dt;
    l.y += l.vy * dt;

    if (l.x < 2) { l.x = 2; l.vx = Math.abs(l.vx) * 0.3; }
    if (l.x > W - 3) { l.x = W - 3; l.vx = -Math.abs(l.vx) * 0.3; }
    if (l.y < 50) { l.y = 50; l.vy = Math.max(l.vy, 0); }
    if (l.y >= GROUND - 2) {
      l.state = 'ground';
      l.y = GROUND - 2 - Math.floor(Math.random() * 3);
      l.vx = 0;
      l.vy = 0;
      sfx.land();
    }
  }
}

function update(dt) {
  updateSparks(dt);
  cloudX = (cloudX + (CLOUD_DRIFT + s.wind * 0.3) * dt) % W;
  if (s.phase === 'storm') return updateStorm(dt);
  if (s.phase !== 'play') return;
  s.t += dt;

  // Logs trickle in.
  s.logTimer += dt;
  if (s.logTimer >= logInterval(s.t)) {
    s.logTimer = 0;
    if (s.logs < MAX_LOGS) {
      s.logs++;
      sfx.log();
    }
  }

  // Fires burn down; heat follows fuel.
  for (const f of s.fires) {
    f.fuel = Math.max(0, f.fuel - burnRate(s.t) * dt);
    const target = f.fuel > 0 ? clamp(f.fuel / 2, 0.4, 1) : 0;
    f.heat += (target - f.heat) * Math.min(1, dt * 3);
    if (f.heat < 0.02) f.heat = 0;
    if (f.heat > 0 && Math.random() < f.heat * dt * 14) spark(f.x, GROUND - 6, f.heat);
  }

  // Gusts come in waves from alternating sides.
  s.gustTimer -= dt;
  if (s.gustTimer <= 0) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    s.windTarget = dir * gustStrength(s.t);
    s.gustTimer = 5 + Math.random() * 4;
    s.gustEnd = s.t + 2.5;
    sfx.gust();
    popup(dir < 0 ? '<< GUST' : 'GUST >>', W / 2, 70, 'cold');
  }
  if (s.gustEnd && s.t > s.gustEnd) s.windTarget = 0;
  s.wind += (s.windTarget - s.wind) * Math.min(1, dt * 1.5);

  s.shedTimer -= dt;
  if (s.shedTimer <= 0) {
    shed();
    s.shedTimer = shedInterval(s.t);
  }

  updateLeaves(dt);

  if (counts().ground === LEAF_COUNT) {
    s.phase = 'storm';
    ui.pauseBtn.hidden = true; // nothing left to pause
    sfx.snow();
    sfx.music('menu');
  }
}

function updateStorm(dt) {
  s.stormT += dt;
  if (s.stormT > 2.5) endRun();
}

function endRun() {
  const best = s.t > save.bestTime;
  save.bestTime = Math.max(save.bestTime, s.t);
  persist();
  track('run.end', { time: Math.round(s.t), rescues: s.rescues, best });
  s.phase = 'over';
  const run = s;
  const showResult = (line) => {
    ui.result.textContent =
      `The last leaf touched the ground.\nWinter held off for\n\n${fmtTime(run.t)}\n\n${line}\nLeaves rescued: ${run.rescues}`;
  };
  showResult(best ? 'NEW BEST!' : `Best ${fmtTime(save.bestTime)}`);
  ui.nameHint.hidden = true;
  showScreen('gameover');

  // The global board keeps each player's best; the answer adds their rank (null when not sharing).
  window.wt?.submitScore?.(Math.round(run.t * 10) / 10)?.then((r) => {
    if (!r) return;
    myBoard = r;
    if (s !== run) return;
    showResult(`${best ? 'NEW BEST! ' : ''}#${r.rank} worldwide`);
    ui.nameHint.hidden = r.named; // Settings can sign them in, on Betacade or elsewhere
  });
}

// --- Particles: sparks + snow -------------------------------------------------

function spark(x, y, heat) {
  const life = 0.5 + Math.random() * 0.6;
  s.sparks.push({
    x: x + (Math.random() - 0.5) * 8, y,
    vx: (Math.random() - 0.5) * 10, vy: -(20 + Math.random() * 30) * heat,
    life, max: life,
    color: Math.random() < 0.5 ? '#f5c84a' : '#f0803c',
  });
}

function updateSparks(dt) {
  for (const p of s.sparks) {
    p.life -= dt;
    p.x += (p.vx + s.wind * 0.3) * dt;
    p.y += p.vy * dt;
  }
  s.sparks = s.sparks.filter((p) => p.life > 0);

  // Snow thickens as more leaves reach the ground.
  const threat = s.phase === 'storm' ? 1 : counts().ground / LEAF_COUNT;
  const rate = s.phase === 'storm' ? 120 : threat * threat * 25;
  if (Math.random() < rate * dt) s.flakes.push({ x: Math.random() * W, y: stormHeight() - 2, v: 8 + Math.random() * 10 });
  for (const f of s.flakes) {
    f.y += f.v * dt;
    f.x += (s.wind * 0.4 + Math.sin(f.y * 0.1) * 4) * dt;
  }
  s.flakes = s.flakes.filter((f) => f.y < GROUND);
}

// --- Drawing -------------------------------------------------------------------

function stormHeight() {
  if (!s) return 0;
  if (s.phase === 'storm' || s.phase === 'over') return 70 + Math.min(1, s.stormT) * 60;
  return 6 + 46 * (counts().ground / LEAF_COUNT);
}

function drawBackdrop() {
  // Until the images load, flat fills keep the previous frame from smearing.
  if (backdrop.complete && backdrop.naturalWidth) ctx.drawImage(backdrop, 0, 0);
  else rect(ctx, '#271936', 0, 0, W, GROUND);
  if (groundArt.complete && groundArt.naturalWidth) ctx.drawImage(groundArt, 0, GROUND);
  else rect(ctx, '#210e0e', 0, GROUND, W, H - GROUND);

  // Storm clouds creep down as winter gets closer.
  // The art's fringe spans its bottom ~7 rows, so center that on the storm height.
  const sh = stormHeight();
  if (!cloudArt.complete || !cloudArt.naturalWidth) return rect(ctx, '#4d5c76', 0, 0, W, sh);
  const x = Math.round(((cloudX % W) + W) % W);
  const y = Math.round(sh) - cloudArt.height + 4;
  ctx.drawImage(cloudArt, x - W, y);
  ctx.drawImage(cloudArt, x, y);
}

function drawFire(f, i, t) {
  // Stone ring and slot number.
  rect(ctx, '#6a5a5a', f.x - 7, GROUND - 1, 14, 2);
  rect(ctx, '#8a7a72', f.x - 6, GROUND - 2, 3, 2);
  rect(ctx, '#8a7a72', f.x + 3, GROUND - 2, 3, 2);
  rect(ctx, '#2a1810', f.x - 4, GROUND - 2, 8, 1);
  if (f.heat <= 0) {
    ctx.globalAlpha = 0.5;
    drawDigit(i + 1, f.x - 1, GROUND + 6);
    ctx.globalAlpha = 1;
    return;
  }

  // Warm air column: faint wavy lines so you can see what's lifting.
  ctx.globalAlpha = 0.1 * f.heat;
  for (let y = 60; y < GROUND - 8; y += 3) {
    const wob = Math.round(Math.sin(y * 0.15 - t * 4) * 2);
    rect(ctx, '#ffd08a', f.x - COLUMN_HALF + 2 + wob, y, 1, 2);
    rect(ctx, '#ffd08a', f.x + COLUMN_HALF - 3 - wob, y, 1, 2);
  }
  ctx.globalAlpha = 1;

  // Flames.
  for (let k = -3; k <= 3; k++) {
    const h = Math.round((10 - Math.abs(k) * 2.2) * f.heat * (0.8 + Math.random() * 0.4));
    if (h <= 0) continue;
    rect(ctx, '#e0442c', f.x + k, GROUND - 2 - h, 1, h);
    if (h > 3) rect(ctx, '#f5a030', f.x + k, GROUND - 2 - Math.round(h * 0.6), 1, Math.round(h * 0.6));
    if (h > 6) rect(ctx, '#ffe39a', f.x + k, GROUND - 2 - Math.round(h * 0.3), 1, Math.round(h * 0.3));
  }
  // Fuel bar.
  rect(ctx, '#1a1020', f.x - 6, GROUND + 6, 12, 2);
  rect(ctx, '#f5a030', f.x - 6, GROUND + 6, 12 * (f.fuel / MAX_FUEL), 2);
}

const DIGITS = {
  1: ['01', '11', '01', '01', '01'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
};

function drawDigit(n, x, y) {
  DIGITS[n].forEach((row, gy) => [...row].forEach((on, gx) => on === '1' && rect(ctx, '#fff1d6', x + gx, y + gy, 1, 1)));
}

function drawLeaf(l, t) {
  const spin = l.state === 'air' ? Math.floor(t * 6 + l.phase * 3) % LEAF_FRAMES.length : 0;
  let x = l.x, y = l.y;
  if (l.state === 'tree') x += Math.round(Math.sin(t * 1.5 + l.phase) * 0.6 + s.wind * 0.03);
  LEAF_FRAMES[spin].forEach((row, gy) => [...row].forEach((on, gx) => on === '#' && rect(ctx, l.color, x - 1 + gx, y - 1 + gy, 1, 1)));
}

function draw(t) {
  ctx.imageSmoothingEnabled = false;
  drawBackdrop();
  if (treeArt.complete && treeArt.naturalWidth) ctx.drawImage(treeArt, 0, 0);
  for (const l of s.leaves) if (l.state !== 'air') drawLeaf(l, t);
  s.fires.forEach((f, i) => drawFire(f, i, t));
  for (const l of s.leaves) if (l.state === 'air') drawLeaf(l, t);
  for (const p of s.sparks) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    rect(ctx, p.color, p.x, p.y, 1, 1);
  }
  ctx.globalAlpha = 1;
  for (const f of s.flakes) rect(ctx, '#f4f8ff', f.x, f.y, 1, 1);
  if (s.phase === 'storm' || s.phase === 'over') {
    ctx.globalAlpha = Math.min(0.5, s.stormT * 0.2);
    rect(ctx, '#dfe8f5', 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// --- HUD / overlay -------------------------------------------------------------

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function updateHud() {
  setText(ui.time, `WINTER HELD ${fmtTime(s.t)}`);
  setText(ui.best, save.bestTime ? `BEST ${fmtTime(save.bestTime)}` : '');
  setText(ui.logs, `LOGS ${'■'.repeat(s.logs)}${'□'.repeat(MAX_LOGS - s.logs)}`);
  const up = LEAF_COUNT - counts().ground;
  setText(ui.leaves, `LEAVES UP ${up}`);
  ui.leaves.classList.toggle('low', up <= 10);
}

function popup(text, x, y, kind = '') {
  const el = document.createElement('div');
  el.className = `popup ${kind}`;
  el.textContent = text;
  el.style.left = `calc(var(--px) * ${Math.round(x)})`;
  el.style.top = `calc(var(--px) * ${Math.round(y)})`;
  ui.popups.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// Show one menu screen by name (menu, leaderboard, settings, credits, pause, gameover),
// or null to play.
function showScreen(name) {
  screen = name;
  ui.overlay.hidden = !name;
  ui.pauseBtn.hidden = Boolean(name) || s.phase !== 'play';
  stage.classList.toggle('menu-open', Boolean(name));
  for (const el of ui.screens) el.hidden = el.dataset.screen !== name;
  if (name === 'leaderboard') renderScores();
  if (name === 'settings') renderSettings();
  if (!name) {
    document.activeElement?.blur();
    return;
  }
  ui.overlay.querySelector(`[data-screen="${name}"] :is(button, input)`)?.focus({ preventScroll: true });
}

function boardMessage(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

// Betacade's global board: each player's best time, shown by alias (or name, if they opt in).
async function renderScores() {
  const req = ++boardRequest;
  ui.scores.replaceChildren(boardMessage('Loading...'));
  ui.you.textContent = save.bestTime
    ? `Your best: ${fmtTime(save.bestTime)}${myBoard ? `  (#${myBoard.rank})` : ''}`
    : '';
  const top = (await window.wt?.scores?.({ limit: 10 })) ?? [];
  if (req !== boardRequest) return; // reopened meanwhile
  const rows = top.map((r) => {
    const li = document.createElement('li');
    li.classList.toggle('mine', Boolean(myBoard) && r.rank === myBoard.rank && r.score === myBoard.best);
    for (const text of [`#${r.rank}`, r.name, fmtTime(r.score)]) {
      const span = document.createElement('span');
      span.textContent = text;
      li.append(span);
    }
    return li;
  });
  ui.scores.replaceChildren(...(rows.length ? rows : [boardMessage('No winters held off yet.')]));
}

function menuAction(action) {
  if (action === 'play') return startRun();
  if (action === 'resume') return resumeRun();
  if (action === 'quit') return quitRun();
  if (action === 'settings') settingsFrom = screen ?? 'menu';
  if (action === 'back') return showScreen(settingsFrom);
  if (action === 'menu' && s.phase === 'over') s = makeState('title'); // fresh tree behind the menu
  showScreen(action);
}

// --- Pause ---------------------------------------------------------------------

function pauseRun() {
  if (s.phase !== 'play' || runPaused) return;
  runPaused = true;
  sfx.duck(true);
  showScreen('pause');
}

function resumeRun() {
  if (!runPaused) return;
  runPaused = false;
  last = null; // no time jump on the first frame back
  sfx.duck(false);
  showScreen(null);
}

// Ends the run without a score: a quit run never reaches the leaderboard.
function quitRun() {
  runPaused = false;
  track('run.quit', { time: Math.round(s.t) });
  s = makeState('title');
  sfx.music('menu');
  showScreen('menu');
}

// Arrow keys move between the visible buttons; Enter/Space press the focused one natively.
function moveFocus(step) {
  const buttons = [...ui.overlay.querySelectorAll('.screen:not([hidden]) :is(button, input)')];
  const i = buttons.indexOf(document.activeElement);
  buttons[(i + step + buttons.length) % buttons.length]?.focus({ preventScroll: true });
}

function fitStage() {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
  stage.style.width = `${W * scale}px`;
  stage.style.height = `${H * scale}px`;
  stage.style.setProperty('--px', `${scale}px`);
}

// --- Input -----------------------------------------------------------------------

function onPointer(e) {
  e.preventDefault();
  sfx.unlock();
  if (s.phase !== 'play') return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  let best = 0;
  SLOTS.forEach((sx, i) => {
    if (Math.abs(sx - x) < Math.abs(SLOTS[best] - x)) best = i;
  });
  lightFire(best);
}

window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.key >= '1' && e.key <= '5') {
    lightFire(Number(e.key) - 1);
  } else if (e.key === 'm' || e.key === 'M') {
    updateMute(sfx.toggleMute());
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  } else if (ui.overlay.hidden && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) {
    pauseRun();
  } else if (screen === 'pause' && (e.key === 'p' || e.key === 'P')) {
    resumeRun();
  } else if (!ui.overlay.hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      menuAction(screen === 'pause' ? 'resume' : screen === 'settings' ? 'back' : 'menu');
    } else if ((e.key === 'Enter' || e.key === ' ') && !(document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLInputElement)) {
      e.preventDefault();
      moveFocus(0);
    }
  }
});

function updateMute(muted) {
  ui.mute.setAttribute('aria-pressed', String(muted));
}

canvas.addEventListener('pointerdown', onPointer);
ui.pauseBtn.addEventListener('click', () => {
  sfx.unlock();
  pauseRun();
});
// Leaving the tab pauses the run, so leaves don't fall while nobody's watching.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseRun();
});
// Any tap on the title screen starts the menu music (browsers block sound until a gesture).
ui.overlay.addEventListener('pointerdown', () => sfx.unlock());
// Pointing at a button selects it, so the mouse and the arrow keys share one highlight.
ui.overlay.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'mouse') e.target.closest('button')?.focus({ preventScroll: true });
});
ui.overlay.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  sfx.unlock();
  menuAction(btn.dataset.action);
});
ui.mute.addEventListener('click', () => {
  sfx.unlock();
  updateMute(sfx.toggleMute());
});

// Our own fullscreen button, so hosts' corner buttons (itch.io's) can stay off.
// Hidden where the page can't go fullscreen (iPhone Safari, iframes without permission).
function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
ui.fullscreen.hidden = !document.fullscreenEnabled;
document.addEventListener('fullscreenchange', () => {
  ui.fullscreen.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
});
// --- Settings ------------------------------------------------------------------

// Sliders run 0-10; the audio module keeps levels as 0-1.
function renderSettings() {
  for (const input of ui.levels) input.value = String(Math.round(sfx.getLevel(input.dataset.level) * 10));
  renderPlayer(window.wt?.player);
}

for (const input of ui.levels) {
  input.addEventListener('input', () => {
    sfx.unlock();
    sfx.setLevel(input.dataset.level, Number(input.value) / 10);
  });
  // A sample at the new level once the slider settles.
  input.addEventListener('change', () => (input.dataset.level === 'sfx' ? sfx.rescue() : null));
}

// Betacade sign-in. The player chooses in Betacade's own menu (on Betacade) or window
// (elsewhere); the game only opens it and shows the result.
function renderPlayer(p) {
  const player = p ?? { signedIn: false, showName: false, name: null };
  if (!player.signedIn) {
    ui.playerStatus.textContent = 'Signed out. Sign in to put your name on the leaderboard.';
    ui.playerBtn.textContent = 'SIGN IN';
    ui.playerBtn.dataset.menu = 'signin';
  } else if (!player.showName) {
    ui.playerStatus.textContent = 'Signed in. Your name is hidden on the leaderboard.';
    ui.playerBtn.textContent = 'SHOW MY NAME';
    ui.playerBtn.dataset.menu = 'leaderboard';
  } else {
    ui.playerStatus.textContent = `On the leaderboard as ${player.name}.`;
    ui.playerBtn.textContent = 'NAME SETTINGS';
    ui.playerBtn.dataset.menu = 'leaderboard';
  }
}

// openMenu has to run inside the click: off Betacade it opens a window, which browsers
// only allow from a gesture.
ui.playerBtn.addEventListener('click', () => {
  sfx.unlock();
  window.wt?.openMenu?.(ui.playerBtn.dataset.menu);
});
window.wt?.onPlayer?.(renderPlayer);

ui.fullscreen.addEventListener('click', () => {
  sfx.unlock();
  toggleFullscreen();
});

// --- Loop --------------------------------------------------------------------------

let last = null;
let paused = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) return;
  const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!runPaused) update(dt);
  draw(now / 1000);
  updateHud();
}

// Betacade freezes rAF while paused; reset the frame delta so we don't jump on resume.
// Its pause also opens ours, so the player comes back to a paused run, not a live one.
window.addEventListener('wt:pause', () => { paused = true; sfx.pauseMusic(true); pauseRun(); });
window.addEventListener('wt:resume', () => { paused = false; last = null; sfx.pauseMusic(false); });

window.addEventListener('resize', fitStage);
fitStage();
findTips();
updateMute(sfx.isMuted());
s = makeState('title');
sfx.music('menu');
showScreen('menu');
requestAnimationFrame(frame);
