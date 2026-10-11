// Game state and simulation. Rendering lives in render.js, sound in audio.js.

import { Trail } from './trail.js';
import { pointInPolygon, polygonArea, polygonBounds, polygonCenter, distSqToSegment } from './geometry.js';
import { t } from './i18n.js';

export const COLORS = [
  { hex: '#FFD447', rgb: [255, 212, 71], shape: 'circle' },
  { hex: '#46E6FF', rgb: [70, 230, 255], shape: 'diamond' },
  { hex: '#FF5FB7', rgb: [255, 95, 183], shape: 'triangle' },
  { hex: '#A6FF5C', rgb: [166, 255, 92], shape: 'square' },
];

const COMBO_WINDOW = 2.2; // seconds between loops to keep a combo alive
const LEVEL_SECONDS = 20;
const GLOW_MAX = 100;
const MOTH_PENALTY = 22;
const FRENZY_SECONDS = 6.5;

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Difficulty for a given night (level). */
export function levelParams(level) {
  return {
    colors: level < 2 ? 2 : level < 4 ? 3 : 4,
    moths: level < 2 ? 0 : level < 3 ? 1 : level < 5 ? 2 : Math.min(5, 3 + Math.floor((level - 5) / 2)),
    // Keeps rising after night 10 so even perfect play eventually ends.
    drain: level <= 10 ? 2.6 + (level - 1) * 0.7 : 8.9 + (level - 10) * 0.5,
    bats: level >= 4,
    batEvery: Math.max(3.5, 10 - (level - 4) * 1.1),
    mothSpeed: Math.min(1.6, 1 + (level - 2) * 0.07),
  };
}

/** Points for one loop: each color group scores its size squared. */
export function scoreLoop(countsByColor, combo) {
  let base = 0;
  for (const n of countsByColor) base += n * n * 10;
  return base * Math.min(Math.max(combo, 1), 8);
}

export class Game {
  constructor(audio, save) {
    this.audio = audio;
    this.save = save;
    this.trail = new Trail();
    this.W = 0;
    this.H = 0;
    this.U = 1;
    this.clock = 0;
    this.state = 'title';
    this.paused = false;
    this.onRunEnd = null;
    this.pointer = { down: false, x: 0, y: 0, speed: 0, lastT: 0 };
    this.ui = {};
    this.resetWorld();
  }

  // ---------- setup ----------

  resetWorld() {
    this.flocks = [];
    this.fireflies = [];
    this.moths = [];
    this.bats = [];
    this.golden = null;
    this.flyers = [];
    this.particles = [];
    this.popups = [];
    this.flashes = [];
    this.rings = [];
    this.banners = [];
    this.shake = 0;
    this.hitstop = 0;
    this.trail.clear();
  }

  resize(W, H) {
    if (this.W && this.H && (W !== this.W || H !== this.H)) {
      const sx = W / this.W;
      const sy = H / this.H;
      const scale = (o) => {
        o.x *= sx;
        o.y *= sy;
      };
      [this.flocks, this.fireflies, this.moths, this.bats, this.flyers, this.particles, this.popups].forEach((list) =>
        list.forEach(scale),
      );
      for (const f of this.flocks) {
        f.tx *= sx;
        f.ty *= sy;
      }
      for (const fl of this.flashes) fl.poly.forEach(scale);
      if (this.golden) {
        this.golden.cx *= sx;
        this.golden.cy *= sy;
        this.golden.ax *= sx;
        this.golden.ay *= sy;
      }
      for (const b of this.bats) b.y0 *= sy;
      this.trail.pts.forEach(scale);
    }
    this.W = W;
    this.H = H;
    this.U = clamp(Math.min(W, H) / 400, 0.7, 2.2);
    const U = this.U;
    this.trail.configure({
      maxLength: 950 * U,
      minStep: Math.max(3, 4 * U),
      snap: 11 * U,
      releaseSnap: 30 * U,
      minArea: Math.PI * (22 * U) ** 2,
    });
    this.layoutHud();
    if (this.state === 'title' && !this.fireflies.length) this.setupTitle();
  }

  layoutHud() {
    const { W, U } = this;
    const top = 12 * U;
    const barW = Math.min(W * 0.52, 250 * U);
    this.hud = {
      scoreY: top + 24 * U,
      barX: W / 2 - barW / 2 + 10 * U,
      barY: top + 54 * U,
      barW,
      barH: 7 * U,
      jarX: W / 2 - barW / 2 - 10 * U,
      jarY: top + 57 * U,
      pause: { x: W - 30 * U, y: top + 22 * U, r: 18 * U },
      bottom: top + 76 * U,
    };
  }

  /** Playfield rectangle where fireflies live. */
  get field() {
    const { W, H, U } = this;
    return { x0: 18 * U, y0: this.hud.bottom + 8 * U, x1: W - 18 * U, y1: H - 22 * U };
  }

  targetFireflies() {
    const { W, H, U } = this;
    const area = (W * H) / (U * U);
    const bonus = this.frenzy > 0 ? 10 : 0;
    return clamp(Math.round(area / 9500), 12, 24) + bonus;
  }

  setupTitle() {
    this.resetWorld();
    this.state = 'title';
    this.titleTaps = 0;
    this.titleStartAt = 0;
    this.ghost = 0;
    const { W, H, U } = this;
    // The "start button" is a flock of fireflies you have to loop.
    this.titleFlock = this.spawnFlock(0, 7, W / 2, H * 0.64, true);
    this.titleFlock.speed = 0;
    for (const f of this.fireflies) f.ro = rand(6, 30) * U;
    for (let i = 0; i < 4; i++) {
      this.spawnFlock(i % 4, randInt(2, 3), rand(W * 0.1, W * 0.9), rand(H * 0.25, H * 0.9));
    }
  }

  startRun() {
    this.resetWorld();
    this.state = 'playing';
    this.paused = false;
    this.score = 0;
    this.displayScore = 0;
    this.glow = GLOW_MAX;
    this.combo = 0;
    this.lastLoopAt = -99;
    this.runTime = 0;
    this.level = 1;
    this.frenzy = 0;
    this.nextGolden = 18;
    this.nextBat = 4;
    this.mothCooldown = 2;
    this.heartbeatT = 0;
    this.firstCatch = !this.save.tutorialDone;
    this.idle = 0;
    this.stats = { caught: 0, biggest: 0, bestCombo: 0, newBest: false };
    const n = this.targetFireflies();
    const f = this.field;
    while (this.fireflies.length < n) {
      this.spawnFlock(randInt(0, 1), randInt(3, 5), rand(f.x0, f.x1), rand(f.y0, f.y1));
    }
    this.audio.startMusic();
  }

  // ---------- spawning ----------

  spawnFlock(c, size, x, y, still = false) {
    const U = this.U;
    const flock = { x, y, vx: 0, vy: 0, tx: x, ty: y, c, retarget: 0, speed: still ? 0 : rand(14, 26) * U, still };
    this.flocks.push(flock);
    for (let i = 0; i < size; i++) {
      const a = rand(0, Math.PI * 2);
      const ro = rand(4, 22 + size * 3) * U;
      this.fireflies.push({
        x: x + Math.cos(a) * ro,
        y: y + Math.sin(a) * ro,
        vx: 0,
        vy: 0,
        c,
        flock,
        a,
        ro,
        w: rand(0.5, 1.3) * (Math.random() < 0.5 ? -1 : 1),
        ph: rand(0, Math.PI * 2),
        phs: rand(2, 4),
        born: this.clock,
        alpha: 0,
      });
    }
    return flock;
  }

  /** A spot inside the field that is not too close to the pen or moths. */
  freeSpot() {
    const f = this.field;
    const U = this.U;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 8; i++) {
      const x = rand(f.x0 + 20 * U, f.x1 - 20 * U);
      const y = rand(f.y0 + 20 * U, f.y1 - 20 * U);
      let d = Infinity;
      if (this.pointer.down) d = Math.hypot(x - this.pointer.x, y - this.pointer.y);
      for (const m of this.moths) d = Math.min(d, Math.hypot(x - m.x, y - m.y));
      for (const fl of this.flocks) d = Math.min(d, Math.hypot(x - fl.x, y - fl.y) * 1.5);
      if (d > bestScore) {
        bestScore = d;
        best = { x, y };
      }
    }
    return best;
  }

  spawnMoth() {
    const { W, H, U } = this;
    const side = randInt(0, 3);
    const x = side === 0 ? -20 * U : side === 1 ? W + 20 * U : rand(0, W);
    const y = side === 2 ? this.hud.bottom : side === 3 ? H + 20 * U : rand(this.hud.bottom, H);
    this.moths.push({ x, y, vx: 0, vy: 0, ph: rand(0, 6), fleeing: false, wander: rand(0, 6) });
  }

  spawnGolden() {
    const f = this.field;
    const cx = (f.x0 + f.x1) / 2;
    const cy = (f.y0 + f.y1) / 2;
    this.golden = {
      cx,
      cy,
      ax: (f.x1 - f.x0) * 0.38,
      ay: (f.y1 - f.y0) * 0.36,
      w1: rand(0.8, 1.15),
      w2: rand(1.25, 1.6),
      p1: rand(0, 6),
      p2: rand(0, 6),
      t: 0,
      life: 7.5,
      x: cx,
      y: cy,
    };
    this.golden.x = cx + Math.sin(this.golden.p1) * this.golden.ax;
    this.golden.y = cy + Math.sin(this.golden.p2) * this.golden.ay;
    if (!this.seenGolden) {
      this.seenGolden = true;
      this.banner(t('golden'));
    }
    this.audio.golden();
  }

  spawnBat() {
    const f = this.field;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y0 = rand(f.y0 + 30 * this.U, f.y1 - 30 * this.U);
    this.bats.push({
      dir,
      y0,
      x: dir > 0 ? -30 * this.U : this.W + 30 * this.U,
      y: y0,
      warn: 1.0,
      t: 0,
      speed: (230 + this.level * 10) * this.U,
      amp: rand(15, 45) * this.U,
      freq: rand(2, 3.5),
    });
    this.audio.batWarn();
  }

  banner(text, life = 2.6) {
    this.banners.push({ text, t: 0, life });
  }

  // ---------- input ----------

  pointerDown(x, y) {
    const p = this.pointer;
    p.down = true;
    p.x = x;
    p.y = y;
    p.speed = 0;
    p.lastT = this.clock;
    this.trail.begin(x, y, this.clock);
  }

  pointerMove(x, y) {
    const p = this.pointer;
    if (!p.down) return;
    const dt = Math.max(1e-3, this.clock - p.lastT);
    const d = Math.hypot(x - p.x, y - p.y);
    p.speed = p.speed * 0.7 + (d / dt) * 0.3;
    p.x = x;
    p.y = y;
    p.lastT = this.clock;
    const before = this.trail.pts.length;
    const loop = this.trail.add(x, y, this.clock);
    if (this.trail.pts.length !== before && Math.random() < 0.7) this.sparkAt(x, y);
    if (loop) this.resolveLoop(loop.poly);
  }

  pointerUp() {
    const p = this.pointer;
    if (!p.down) return;
    p.down = false;
    p.speed = 0;
    this.audio.drawSpeed(0);
    const loop = this.trail.end(this.clock);
    if (loop) this.resolveLoop(loop.poly);
  }

  /** Input interrupted (system pause): drop the line without resolving it. */
  pointerCancel() {
    this.pointer.down = false;
    this.pointer.speed = 0;
    this.audio.drawSpeed(0);
    this.trail.clear();
  }

  /** A tap that did not draw anything (used on the title screen). */
  tap() {
    if (this.state !== 'title') return;
    this.titleTaps++;
    this.ghost = 0.001;
    if (this.titleTaps >= 3) this.beginFromTitle();
  }

  beginFromTitle() {
    if (this.titleStartAt) return;
    this.titleStartAt = this.clock + 0.55;
    this.audio.tap();
  }

  togglePause() {
    if (this.state !== 'playing') return;
    this.paused = !this.paused;
    this.pointerCancel();
    this.audio.tap();
  }

  // ---------- loops ----------

  resolveLoop(poly) {
    const b = polygonBounds(poly);
    const inside = (o) => o.x >= b.minX && o.x <= b.maxX && o.y >= b.minY && o.y <= b.maxY && pointInPolygon(o.x, o.y, poly);
    const flies = this.fireflies.filter((f) => f.alpha > 0.35 && inside(f));
    const center = polygonCenter(poly);
    const area = polygonArea(poly);

    if (this.state === 'title') {
      if (flies.length) {
        this.capture(poly, flies, false);
        this.beginFromTitle();
      } else this.fizzle(poly);
      return;
    }
    if (this.state !== 'playing' || this.paused) return;

    const moths = this.frenzy > 0 ? [] : this.moths.filter((m) => !m.fleeing && inside(m));
    const gotGolden = this.golden && this.golden.t > 0.3 && inside(this.golden);

    if (moths.length) {
      this.burn(poly, center, flies, moths);
      return;
    }
    if (!flies.length && !gotGolden) {
      this.fizzle(poly);
      return;
    }
    const pts = this.capture(poly, flies, gotGolden);
    this.stats.biggest = Math.max(this.stats.biggest, flies.length);
    if (gotGolden) this.startFrenzy(center);
    if (area > 0 && pts) this.idle = 0;
  }

  capture(poly, flies, gotGolden) {
    const U = this.U;
    const center = polygonCenter(poly);
    const playing = this.state === 'playing';
    const counts = [0, 0, 0, 0];
    for (const f of flies) counts[f.c]++;
    const groups = this.frenzy > 0 ? [flies.length] : counts.filter((n) => n > 0);
    const n = flies.length;
    const pure = n >= 3 && groups.length === 1;

    let points = 0;
    if (playing) {
      const now = this.clock;
      const double = now - this.lastLoopAt < 0.7;
      this.combo = now - this.lastLoopAt <= COMBO_WINDOW ? this.combo + 1 : 1;
      this.lastLoopAt = now;
      points = scoreLoop(groups, this.combo) + (gotGolden ? 500 : 0);
      this.score += points;
      this.stats.caught += n;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
      const gain = n * 2.6 + (pure ? n * 1.2 : 0) + (Math.min(this.combo, 8) - 1) * 1.5;
      this.glow = Math.min(GLOW_MAX, this.glow + gain);
      if (this.firstCatch && n) {
        this.firstCatch = false;
        this.save.tutorialDone = true;
        this.banner(t('colorsHint'));
        this.banner(t('lanternHint'));
      }

      // Popups, strongest callout on top.
      let y = center.y - 14 * U;
      this.popup(center.x, y, `+${points.toLocaleString('en-US')}`, '#FFF4D6', 30);
      const tags = [];
      if (pure) tags.push([`${t('pure')} ×${n}`, COLORS[flies[0].c].hex]);
      if (n >= 10) tags.push([t('huge'), '#FFFFFF']);
      if (double) tags.push([t('double'), '#FFE08A']);
      if (this.combo >= 2) tags.push([`${t('combo')} ×${Math.min(this.combo, 8)}`, '#FFB86B']);
      for (const [text, color] of tags) {
        y += 24 * U;
        this.popup(center.x, y, text, color, 17);
      }
    }

    // Visuals: fill flash, flyers, sparks.
    const flashColor = this.frenzy > 0 ? '#FFFFFF' : pure ? COLORS[flies[0].c].hex : '#FFE9B0';
    this.flashes.push({ poly, t: 0, life: 0.55, color: flashColor, bad: false });
    this.rings.push({ x: center.x, y: center.y, r0: 10 * U, r1: 90 * U + n * 6 * U, t: 0, life: 0.5, color: flashColor });
    flies.forEach((f, i) => {
      this.fireflies.splice(this.fireflies.indexOf(f), 1);
      this.flyers.push({
        x: f.x,
        y: f.y,
        sx: f.x,
        sy: f.y,
        cx: center.x,
        cy: center.y,
        c: f.c,
        t: -i * 0.035,
        dur: 0.75,
        toJar: playing,
      });
      this.burst(f.x, f.y, COLORS[f.c].hex, 6, 90);
    });
    this.shake = Math.min(14 * U, this.shake + (2 + n * 0.6) * U);
    if (n >= 8) this.hitstop = 0.09;
    this.audio.capture(Math.max(n, 1), this.combo || 1, pure);
    return points;
  }

  burn(poly, center, flies, moths) {
    const U = this.U;
    this.combo = 0;
    this.lastLoopAt = -99;
    this.glow = Math.max(0, this.glow - MOTH_PENALTY);
    this.flashes.push({ poly, t: 0, life: 0.7, color: '#FF3B3B', bad: true });
    this.popup(center.x, center.y, t('burned'), '#FF6B5B', 30);
    this.popup(center.x, center.y + 26 * U, `−${MOTH_PENALTY}`, '#FF9C8F', 17);
    for (const f of flies) {
      const dx = f.x - center.x;
      const dy = f.y - center.y;
      const d = Math.hypot(dx, dy) || 1;
      f.vx += (dx / d) * 260 * U;
      f.vy += (dy / d) * 260 * U;
    }
    for (const m of moths) {
      m.fleeing = true;
      this.burst(m.x, m.y, '#FF5A3C', 16, 160);
    }
    this.shake = Math.min(16 * U, this.shake + 12 * U);
    this.audio.burn();
  }

  fizzle(poly) {
    const c = polygonCenter(poly);
    this.flashes.push({ poly, t: 0, life: 0.3, color: '#8FA3D9', bad: false });
    this.burst(c.x, c.y, '#B8C6F0', 5, 50);
    this.audio.fizzle();
  }

  startFrenzy(center) {
    this.frenzy = FRENZY_SECONDS;
    this.glow = GLOW_MAX;
    this.golden = null;
    this.popup(center.x, center.y - 50 * this.U, t('frenzy'), '#FFE36E', 40);
    this.burst(center.x, center.y, '#FFE36E', 40, 260);
    for (const m of this.moths) m.fleeing = true;
    this.audio.frenzy();
  }

  // ---------- effects ----------

  popup(x, y, text, color, size) {
    this.popups.push({ x, y, text, color, size, t: 0, life: 1.1 });
  }

  burst(x, y, color, count, speed) {
    const U = this.U;
    for (let i = 0; i < count && this.particles.length < 500; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.3, 1) * speed * U;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.35, 0.8), color, size: rand(1, 2.4) * U });
    }
  }

  sparkAt(x, y) {
    const U = this.U;
    if (this.particles.length > 450) return;
    const a = rand(0, Math.PI * 2);
    const s = rand(20, 90) * U;
    this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20 * U, t: 0, life: rand(0.2, 0.5), color: '#FFE7A3', size: rand(0.8, 1.8) * U });
  }

  // ---------- update ----------

  update(dt) {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      dt *= 0.2;
    }
    const frozen = this.paused && this.state === 'playing';
    if (frozen) return;
    this.clock += dt;
    const U = this.U;

    if (this.state === 'title') this.updateTitle(dt);
    else if (this.state === 'playing') this.updateRun(dt);
    else if (this.state === 'ending') {
      this.endT += dt;
      if (this.endT > 1.5) this.finishRun();
    } else if (this.state === 'over') this.overT += dt;

    this.trail.update(this.clock);
    if (this.pointer.down) this.audio.drawSpeed(this.pointer.speed);
    this.updateFlocks(dt);
    this.updateFireflies(dt);
    this.updateMoths(dt);

    // flyers → jar (or burst in place on the title screen)
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt;
      if (f.t < 0) continue;
      const k = Math.min(1, f.t / f.dur);
      const e = k * k * (3 - 2 * k);
      if (f.toJar) {
        const mx = (f.cx + this.hud.jarX) / 2;
        const my = Math.min(f.cy, this.hud.jarY) - 60 * U;
        const a = 1 - e;
        f.x = a * a * f.sx + 2 * a * e * mx + e * e * this.hud.jarX;
        f.y = a * a * f.sy + 2 * a * e * my + e * e * this.hud.jarY;
      } else {
        f.x = f.sx + (f.cx - f.sx) * e;
        f.y = f.sy + (f.cy - f.sy) * e - Math.sin(k * Math.PI) * 30 * U;
      }
      if (k >= 1) {
        this.flyers.splice(i, 1);
        if (f.toJar) this.jarPulse = 1;
        else this.burst(f.x, f.y, COLORS[f.c].hex, 3, 60);
      }
    }
    if (this.jarPulse > 0) this.jarPulse = Math.max(0, this.jarPulse - dt * 3);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= 1 - 2.5 * dt;
      p.vy = p.vy * (1 - 2.5 * dt) + 40 * U * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const list of [this.popups, this.flashes, this.rings]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].t += dt;
        if (list[i].t >= list[i].life) list.splice(i, 1);
      }
    }
    if (this.banners.length) {
      const b = this.banners[0];
      b.t += dt;
      if (b.t >= b.life) this.banners.shift();
    }
    this.shake *= Math.pow(0.02, dt);
    if (this.shake < 0.1) this.shake = 0;

    const intensity = this.state === 'playing' ? (this.frenzy > 0 ? 2 : Math.min(1, (this.level - 1) / 4)) : 0;
    this.audio.tick(intensity);
  }

  updateTitle(dt) {
    if (this.ghost > 0) this.ghost += dt;
    if (this.titleStartAt && this.clock >= this.titleStartAt) {
      this.startRun();
      return;
    }
    // Keep the title flock alive and centered so there is always something to loop.
    const { W, H } = this;
    this.titleFlock.x = W / 2;
    this.titleFlock.y = H * 0.64;
    if (!this.titleStartAt && !this.fireflies.some((f) => f.flock === this.titleFlock)) {
      this.titleFlock = this.spawnFlock(randInt(0, 3), 7, W / 2, H * 0.64, true);
      for (const f of this.fireflies) if (f.flock === this.titleFlock) f.ro = rand(6, 30) * this.U;
    }
  }

  updateRun(dt) {
    const U = this.U;
    this.runTime += dt;
    this.idle += dt;
    const level = 1 + Math.floor(this.runTime / LEVEL_SECONDS);
    if (level !== this.level) this.levelUp(level);
    const P = levelParams(this.level);

    // Lantern glow drains; loops refuel it.
    if (this.frenzy > 0) {
      this.frenzy -= dt;
      if (this.frenzy <= 0) this.frenzy = 0;
    } else if (!this.firstCatch && this.runTime > 1.2) {
      this.glow -= P.drain * dt;
    }
    if (this.glow <= 0) {
      this.glow = 0;
      this.beginEnding();
      return;
    }
    if (this.glow < 25) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.heartbeatT = 0.55 + this.glow / 40;
        this.audio.heartbeat();
      }
    }
    if (this.combo > 0 && this.clock - this.lastLoopAt > COMBO_WINDOW) this.combo = 0;
    this.displayScore += (this.score - this.displayScore) * Math.min(1, dt * 10);
    if (Math.abs(this.score - this.displayScore) < 1) this.displayScore = this.score;

    // Keep the field populated with flocks.
    const want = this.targetFireflies();
    if (this.fireflies.length < want - 2) {
      const spot = this.freeSpot();
      const c = randInt(0, P.colors - 1);
      this.spawnFlock(c, randInt(3, Math.min(7, 4 + this.level)), spot.x, spot.y);
    }

    // Moths
    const alive = this.moths.filter((m) => !m.fleeing).length;
    this.mothCooldown -= dt;
    if (this.frenzy <= 0 && alive < P.moths && this.mothCooldown <= 0) {
      this.spawnMoth();
      this.mothCooldown = 2.5;
    }

    // Golden firefly
    if (this.golden) {
      const g = this.golden;
      g.t += dt;
      const s = g.t;
      g.x = g.cx + Math.sin(g.p1 + s * g.w1) * g.ax;
      g.y = g.cy + Math.sin(g.p2 + s * g.w2) * g.ay;
      if (g.t > g.life) {
        this.burst(g.x, g.y, '#FFE36E', 10, 80);
        this.golden = null;
      } else if (Math.random() < 0.5) {
        this.particles.push({ x: g.x, y: g.y, vx: rand(-15, 15) * U, vy: rand(-15, 15) * U, t: 0, life: 0.6, color: '#FFE36E', size: rand(1, 2) * U });
      }
    } else if (this.frenzy <= 0 && this.runTime >= this.nextGolden) {
      this.spawnGolden();
      this.nextGolden = this.runTime + rand(24, 34);
    }

    // Bats cut the line
    if (P.bats) {
      this.nextBat -= dt;
      if (this.nextBat <= 0) {
        if (!this.seenBats) {
          this.seenBats = true;
          this.banner(t('bats'));
        }
        this.spawnBat();
        this.nextBat = P.batEvery * rand(0.8, 1.25);
      }
    }
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      if (b.warn > 0) {
        b.warn -= dt;
        continue;
      }
      b.t += dt;
      b.x += b.dir * b.speed * dt;
      b.y = b.y0 + Math.sin(b.t * b.freq * Math.PI) * b.amp;
      if (b.x < -60 * U || b.x > this.W + 60 * U) {
        this.bats.splice(i, 1);
        continue;
      }
      this.batHitsTrail(b);
    }
  }

  batHitsTrail(b) {
    const pts = this.trail.pts;
    if (pts.length < 2 || !this.trail.active) return;
    const r2 = (15 * this.U) ** 2;
    for (let i = 0; i < pts.length - 1; i++) {
      if (distSqToSegment(b.x, b.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < r2) {
        for (let k = 0; k < pts.length; k += 2) this.burst(pts[k].x, pts[k].y, '#FFE7A3', 1, 70);
        this.popup(b.x, b.y - 20 * this.U, t('snapped'), '#C9D4FF', 20);
        this.trail.cut();
        this.combo = 0;
        this.audio.snap();
        return;
      }
    }
  }

  levelUp(level) {
    const before = levelParams(this.level);
    this.level = level;
    const now = levelParams(level);
    this.banner(t('night', { n: level }), 1.6);
    if (now.colors > before.colors) this.banner(t('newColor'));
    if (now.moths > 0 && before.moths === 0) {
      this.banner(t('moths'));
      this.banner(t('mothsLight'));
    }
    this.audio.levelUp();
  }

  beginEnding() {
    this.state = 'ending';
    this.endT = 0;
    this.trail.clear();
    this.pointer.down = false;
    this.audio.drawSpeed(0);
    this.audio.stopMusic();
    this.audio.gameOver();
    for (const m of this.moths) m.fleeing = true;
  }

  finishRun() {
    this.state = 'over';
    this.overT = 0;
    const s = this.save;
    s.games = (s.games || 0) + 1;
    s.caught = (s.caught || 0) + this.stats.caught;
    s.bestCombo = Math.max(s.bestCombo || 0, this.stats.bestCombo);
    s.biggest = Math.max(s.biggest || 0, this.stats.biggest);
    if (this.score > (s.best || 0)) {
      s.best = this.score;
      this.stats.newBest = true;
    }
    this.displayScore = this.score;
    if (this.onRunEnd) this.onRunEnd(this.score);
  }

  updateFlocks(dt) {
    const f = this.field;
    const U = this.U;
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const fl = this.flocks[i];
      if (!this.fireflies.some((ff) => ff.flock === fl)) {
        if (fl !== this.titleFlock) this.flocks.splice(i, 1);
        continue;
      }
      if (fl.still) continue;
      fl.retarget -= dt;
      if (fl.retarget <= 0 || Math.hypot(fl.tx - fl.x, fl.ty - fl.y) < 12 * U) {
        fl.tx = rand(f.x0 + 30 * U, f.x1 - 30 * U);
        fl.ty = rand(f.y0 + 30 * U, f.y1 - 30 * U);
        fl.retarget = rand(3, 7);
      }
      const dx = fl.tx - fl.x;
      const dy = fl.ty - fl.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = fl.speed * (this.frenzy > 0 ? 0.6 : 1);
      fl.vx += ((dx / d) * speed - fl.vx) * Math.min(1, dt * 0.8);
      fl.vy += ((dy / d) * speed - fl.vy) * Math.min(1, dt * 0.8);
      fl.x += fl.vx * dt;
      fl.y += fl.vy * dt;
    }
  }

  updateFireflies(dt) {
    const U = this.U;
    const f = this.field;
    const list = this.fireflies;
    const p = this.pointer;
    const ending = this.state === 'ending' || this.state === 'over';
    const fleeR = 38 * U;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      a.alpha = Math.min(1, (this.clock - a.born) / 0.7);
      a.ph += a.phs * dt;
      a.a += a.w * dt;
      const tx = a.flock.x + Math.cos(a.a) * a.ro;
      const ty = a.flock.y + Math.sin(a.a) * a.ro * 0.8;
      let ax = (tx - a.x) * 2.4 - a.vx * 1.7 + rand(-50, 50) * U;
      let ay = (ty - a.y) * 2.4 - a.vy * 1.7 + rand(-50, 50) * U;
      if (p.down && !ending) {
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < fleeR && d > 0.01) {
          const push = (1 - d / fleeR) * 420 * U;
          ax += (dx / d) * push;
          ay += (dy / d) * push;
        }
      }
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        const r = 9 * U;
        if (d2 < r * r && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = (1 - d / r) * 300 * U;
          ax += (dx / d) * push;
          ay += (dy / d) * push;
          b.vx -= (dx / d) * push * dt;
          b.vy -= (dy / d) * push * dt;
        }
      }
      if (ending) ay -= 60 * U;
      a.vx += ax * dt;
      a.vy += ay * dt;
      const sp = Math.hypot(a.vx, a.vy);
      const max = 150 * U;
      if (sp > max) {
        a.vx *= max / sp;
        a.vy *= max / sp;
      }
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      if (!ending) {
        if (a.x < f.x0) a.vx += (f.x0 - a.x) * 8 * dt;
        if (a.x > f.x1) a.vx -= (a.x - f.x1) * 8 * dt;
        if (a.y < f.y0) a.vy += (f.y0 - a.y) * 8 * dt;
        if (a.y > f.y1) a.vy -= (a.y - f.y1) * 8 * dt;
      }
    }
  }

  updateMoths(dt) {
    const U = this.U;
    const p = this.pointer;
    const P = levelParams(this.level || 1);
    const range = Math.min(this.W, this.H) * 0.5;
    for (let i = this.moths.length - 1; i >= 0; i--) {
      const m = this.moths[i];
      m.ph += dt * 18;
      m.wander += dt * rand(0.5, 1.5);
      let tx;
      let ty;
      let speed = 46 * U * P.mothSpeed;
      if (m.fleeing) {
        const cx = this.W / 2;
        const cy = this.H / 2;
        const dx = m.x - cx || 1;
        const dy = m.y - cy;
        const d = Math.hypot(dx, dy);
        tx = m.x + (dx / d) * 100;
        ty = m.y + (dy / d) * 100;
        speed = 220 * U;
        if (m.x < -50 * U || m.x > this.W + 50 * U || m.y < -50 * U || m.y > this.H + 50 * U) {
          this.moths.splice(i, 1);
          continue;
        }
      } else if (p.down && Math.hypot(p.x - m.x, p.y - m.y) < range) {
        // Moths are drawn to your light.
        tx = p.x;
        ty = p.y;
        speed = 72 * U * P.mothSpeed;
      } else {
        // Otherwise they hover around the nearest flock.
        let best = null;
        let bd = Infinity;
        for (const fl of this.flocks) {
          const d = (fl.x - m.x) ** 2 + (fl.y - m.y) ** 2;
          if (d < bd) {
            bd = d;
            best = fl;
          }
        }
        const f = this.field;
        tx = best ? best.x + Math.cos(m.wander) * 45 * U : (f.x0 + f.x1) / 2;
        ty = best ? best.y + Math.sin(m.wander * 1.3) * 45 * U : (f.y0 + f.y1) / 2;
      }
      const dx = tx - m.x;
      const dy = ty - m.y;
      const d = Math.hypot(dx, dy) || 1;
      m.vx += ((dx / d) * speed - m.vx) * Math.min(1, dt * 2.2);
      m.vy += ((dy / d) * speed - m.vy) * Math.min(1, dt * 2.2);
      // Erratic flutter
      const flutter = Math.sin(m.ph * 0.37) * 38 * U;
      m.x += (m.vx + (-dy / d) * flutter) * dt;
      m.y += (m.vy + (dx / d) * flutter) * dt;
    }
  }
}
