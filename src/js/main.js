// Boot sequence, main loop, input and the YouTube Playables lifecycle.

import { platform } from './platform.js';
import { setLanguage } from './i18n.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { Renderer } from './render.js';

const canvas = document.getElementById('game');
const audio = new AudioEngine();

const DEFAULT_SAVE = { v: 1, best: 0, games: 0, caught: 0, bestCombo: 0, biggest: 0, tutorialDone: false };
const save = { ...DEFAULT_SAVE };
const game = new Game(audio, save);
const renderer = new Renderer(canvas);

let W = 0;
let H = 0;
let rafId = 0;
let last = 0;
let systemPaused = false;
let ready = false;
let needsResize = true;

// Debug handle for local testing only (never exposed inside YouTube).
if (!platform.inPlayables || window.__GLOWLOOP_DEBUG__) {
  window.__glowloop = {
    game,
    audio,
    save,
    /** Advance the simulation manually (used when requestAnimationFrame is throttled). */
    step(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) {
        if (needsResize) resize();
        game.update(dt);
      }
      renderer.draw(game, performance.now() / 1000);
    },
  };
}

window.addEventListener('error', () => platform.logError());
window.addEventListener('unhandledrejection', () => platform.logError());

// ---------- sizing ----------

function resize() {
  needsResize = false;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (w === W && h === H && dpr === renderer.dpr) return;
  W = w;
  H = h;
  game.resize(W, H);
  renderer.resize(W, H, dpr, game.U);
}

window.addEventListener('resize', () => {
  needsResize = true;
  if (!rafId && !systemPaused && ready) requestFrame();
});

// ---------- save data ----------

/** Accepts saves from any earlier version and fills in missing fields. */
function applySave(str) {
  let data = null;
  try {
    data = str ? JSON.parse(str) : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') return;
  for (const key of Object.keys(DEFAULT_SAVE)) {
    const v = data[key];
    if (typeof v === typeof DEFAULT_SAVE[key] && (typeof v !== 'number' || Number.isFinite(v))) save[key] = v;
  }
}

function persist() {
  return platform.saveData(JSON.stringify(save));
}

game.onRunEnd = (score) => {
  platform.sendScore(score);
  persist();
};

// ---------- audio ----------

function syncAudio() {
  audio.setPaused(systemPaused || (game.state === 'playing' && game.paused));
}

platform.onAudioEnabledChange((enabled) => audio.setEnabled(enabled));

// ---------- pause / resume (Playables SDK only, no Page Visibility API) ----------

platform.onPause(() => {
  systemPaused = true;
  audio.setPaused(true);
  if (game.state === 'playing') {
    game.pointerCancel();
    game.paused = true;
  }
  if (ready) renderer.draw(game, performance.now() / 1000);
  stopLoop();
  persist();
});

platform.onResume(() => {
  systemPaused = false;
  syncAudio();
  if (ready) requestFrame();
});

// ---------- main loop ----------

function frame(ts) {
  rafId = 0;
  if (systemPaused) return;
  if (needsResize) resize();
  const now = ts / 1000;
  const dt = last ? Math.min(now - last, 1 / 20) : 0;
  last = now;
  game.update(dt);
  renderer.draw(game, now);
  requestFrame();
}

function requestFrame() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  last = 0;
}

// ---------- input ----------

let activePointer = null;
let down = null;
let travelled = 0;

function toLocal(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

const inRect = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const inCircle = (p, c) => c && Math.hypot(p.x - c.x, p.y - c.y) <= c.r * 1.4;

function restart() {
  game.startRun();
  syncAudio();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!ready || systemPaused || activePointer !== null) return;
  audio.unlock();
  syncAudio();
  const p = toLocal(e);
  activePointer = e.pointerId;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* not supported */
  }
  down = { ...p, time: performance.now() };
  travelled = 0;

  if (game.state === 'over') {
    if (game.overT > 0.6 && inRect(p, game.ui.playAgain)) restart();
    return;
  }
  if (game.state === 'ending') return;
  if (game.state === 'playing' && game.paused) {
    game.togglePause();
    syncAudio();
    return;
  }
  if (game.state === 'playing' && inCircle(p, game.hud.pause)) {
    game.togglePause();
    syncAudio();
    return;
  }
  game.pointerDown(p.x, p.y);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointer || systemPaused) return;
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  for (const ev of events.length ? events : [e]) {
    const p = toLocal(ev);
    if (down) travelled = Math.max(travelled, Math.hypot(p.x - down.x, p.y - down.y));
    game.pointerMove(p.x, p.y);
  }
});

function release(e) {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  if (systemPaused) return;
  game.pointerUp();
  if (down && travelled < 12 && performance.now() - down.time < 450) game.tap();
  down = null;
}

canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (!ready || systemPaused) return;
  audio.unlock();
  const key = e.key;
  if (key === 'Escape' || key === 'p' || key === 'P') {
    // Esc closes the pause dialog; never preventDefault on Esc (certification rule).
    if (game.state === 'playing') {
      game.togglePause();
      syncAudio();
    }
    return;
  }
  if (key === 'Enter' || key === ' ') {
    e.preventDefault();
    if (game.state === 'title') game.beginFromTitle();
    else if (game.state === 'playing' && game.paused) {
      game.togglePause();
      syncAudio();
    } else if (game.state === 'over' && game.overT > 0.6) restart();
  }
  syncAudio();
});

// ---------- boot ----------

async function boot() {
  const language = platform.getLanguage();
  const saved = platform.loadData();
  resize();
  renderer.drawLoading(game.U, 0);
  platform.firstFrameReady();

  setLanguage(await language);
  applySave(await saved);
  audio.setEnabled(platform.isAudioEnabled());
  if (save.best > 0) platform.sendScore(save.best);

  // Draw the interactive title screen, then tell YouTube we are ready.
  ready = true;
  game.update(0);
  renderer.draw(game, performance.now() / 1000);
  platform.gameReady();
  requestFrame();
}

boot();
