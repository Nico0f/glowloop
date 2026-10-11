// Canvas 2D renderer. Glows are pre-rendered sprites drawn additively, which is
// far cheaper on phones than shadowBlur.

import { COLORS } from './game.js';
import { t } from './i18n.js';

const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const TAU = Math.PI * 2;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function glowSprite(size, rgb, stops) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, alpha] of stops) grad.addColorStop(at, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.stars = [];
  }

  resize(W, H, dpr, U) {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.U = U;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.buildSprites();
    this.buildBackground();
  }

  buildSprites() {
    const s = Math.ceil(64 * this.U * this.dpr);
    const soft = [
      [0, 1],
      [0.1, 0.7],
      [0.3, 0.22],
      [0.6, 0.06],
      [1, 0],
    ];
    this.glow = COLORS.map((c) => glowSprite(s, c.rgb, soft));
    this.goldGlow = glowSprite(s * 1.6, [255, 227, 110], soft);
    this.warmGlow = glowSprite(s, [255, 214, 150], soft);
    this.redGlow = glowSprite(s, [255, 70, 50], [
      [0, 0.7],
      [0.3, 0.2],
      [1, 0],
    ]);
    this.darkHalo = glowSprite(s, [4, 2, 10], [
      [0, 0.85],
      [0.5, 0.45],
      [1, 0],
    ]);
  }

  buildBackground() {
    const { W, H, dpr, U } = this;
    const c = makeCanvas(W * dpr, H * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#060919');
    sky.addColorStop(0.55, '#0d1433');
    sky.addColorStop(0.85, '#1a1b46');
    sky.addColorStop(1, '#231c4a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Stars
    const count = Math.round((W * H) / 2600);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H * 0.8;
      const r = Math.random() < 0.9 ? 0.6 : 1.2;
      g.fillStyle = `rgba(210,220,255,${0.15 + Math.random() * 0.5})`;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    this.stars = Array.from({ length: Math.min(40, Math.round(count / 6)) }, () => ({
      x: Math.random() * W,
      y: Math.random() * H * 0.75,
      ph: Math.random() * TAU,
      s: 0.8 + Math.random() * 2,
    }));

    // Moon
    const mr = 17 * U;
    const mx = W - Math.max(W * 0.12, 60 * U);
    const my = Math.max(H * 0.1, 40 * U) + 80 * U;
    const halo = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(200,210,255,0.22)');
    halo.addColorStop(1, 'rgba(200,210,255,0)');
    g.fillStyle = halo;
    g.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    g.fillStyle = '#E8ECFF';
    g.beginPath();
    g.arc(mx, my, mr, 0, TAU);
    g.fill();
    g.fillStyle = '#0d1433';
    g.beginPath();
    g.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.92, 0, TAU);
    g.fill();

    // Distant hills and grass silhouettes
    const hill = (base, amp, color, seed) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W + 10; x += 10) {
        const y = H - base - Math.sin(x * 0.004 + seed) * amp - Math.sin(x * 0.011 + seed * 2) * amp * 0.4;
        g.lineTo(x, y);
      }
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    };
    hill(H * 0.11, 16 * U, '#110f2b', 1.3);
    hill(H * 0.06, 12 * U, '#0a0a1c', 4.1);
    g.strokeStyle = '#07070f';
    g.lineCap = 'round';
    for (let x = 0; x < W; x += 4 * U) {
      const h = (8 + Math.random() * 22) * U;
      g.lineWidth = (1 + Math.random() * 1.5) * U;
      g.beginPath();
      g.moveTo(x, H + 2);
      g.quadraticCurveTo(x + (Math.random() - 0.5) * 8 * U, H - h * 0.6, x + (Math.random() - 0.5) * 12 * U, H - h);
      g.stroke();
    }
    this.bg = c;

    // Darkness vignette used when the lantern runs low.
    const v = makeCanvas(W * dpr * 0.5, H * dpr * 0.5);
    const vg = v.getContext('2d');
    const vw = v.width;
    const vh = v.height;
    const rad = vg.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.15, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.55);
    rad.addColorStop(0, 'rgba(0,0,6,0)');
    rad.addColorStop(0.6, 'rgba(0,0,6,0.75)');
    rad.addColorStop(1, 'rgba(0,0,6,1)');
    vg.fillStyle = rad;
    vg.fillRect(0, 0, vw, vh);
    this.vignette = v;
  }

  // ---------- helpers ----------

  text(str, x, y, size, color, { weight = 800, align = 'center', alpha = 1, glow = 0, glowColor = color, spacing = 0 } = {}) {
    const g = this.ctx;
    g.save();
    g.globalAlpha = alpha;
    g.font = `${weight} ${Math.round(size)}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    if (spacing && 'letterSpacing' in g) g.letterSpacing = `${spacing}px`;
    if (glow) {
      g.shadowColor = glowColor;
      g.shadowBlur = glow;
    }
    g.fillStyle = color;
    g.fillText(str, x, y);
    g.restore();
  }

  fitSize(str, size, maxW, weight = 800) {
    const g = this.ctx;
    g.font = `${weight} ${Math.round(size)}px ${FONT}`;
    const w = g.measureText(str).width;
    return w > maxW ? (size * maxW) / w : size;
  }

  roundRect(x, y, w, h, r) {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  sprite(img, x, y, size, alpha = 1) {
    const g = this.ctx;
    g.globalAlpha = alpha;
    g.drawImage(img, x - size / 2, y - size / 2, size, size);
  }

  shape(kind, x, y, r) {
    const g = this.ctx;
    g.beginPath();
    if (kind === 'circle') g.arc(x, y, r, 0, TAU);
    else if (kind === 'diamond') {
      g.moveTo(x, y - r * 1.35);
      g.lineTo(x + r * 1.05, y);
      g.lineTo(x, y + r * 1.35);
      g.lineTo(x - r * 1.05, y);
    } else if (kind === 'triangle') {
      g.moveTo(x, y - r * 1.3);
      g.lineTo(x + r * 1.2, y + r * 0.85);
      g.lineTo(x - r * 1.2, y + r * 0.85);
    } else g.rect(x - r * 0.95, y - r * 0.95, r * 1.9, r * 1.9);
    g.closePath();
    g.fill();
  }

  // ---------- frame ----------

  draw(game, now) {
    const g = this.ctx;
    const { W, H, dpr } = this;
    const U = game.U;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.bg, 0, 0, W, H);

    // Twinkling stars
    g.fillStyle = '#E4EAFF';
    for (const s of this.stars) {
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(now * s.s + s.ph));
      g.globalAlpha = a * 0.8;
      g.fillRect(s.x, s.y, 1.6, 1.6);
    }
    g.globalAlpha = 1;

    g.save();
    if (game.shake > 0) g.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);

    this.drawFlashes(game);
    this.drawMoths(game, now);
    this.drawFireflies(game, now);
    this.drawGolden(game, now);
    this.drawBats(game, now);
    this.drawTrail(game);
    this.drawParticles(game);
    g.restore();

    // Darkness closes in as the lantern fades.
    if (game.state === 'playing' || game.state === 'ending' || game.state === 'over') {
      const glow = game.state === 'playing' ? game.glow : 0;
      const dark = Math.pow(1 - glow / 100, 1.6) * 0.92;
      if (dark > 0.01) {
        g.globalAlpha = dark;
        g.drawImage(this.vignette, 0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    if (game.state === 'playing' || game.state === 'ending') this.drawHud(game, now);
    this.drawFlyers(game);
    this.drawPopups(game);
    if (game.state === 'playing') {
      this.drawBanner(game);
      this.drawTutorial(game, now);
    }
    if (game.state === 'title') this.drawTitle(game, now);
    if (game.state === 'playing' && game.paused) this.drawPaused(game);
    if (game.state === 'over') this.drawGameOver(game, now);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawFlashes(game) {
    const g = this.ctx;
    const U = game.U;
    for (const f of game.flashes) {
      const k = f.t / f.life;
      g.beginPath();
      f.poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.globalCompositeOperation = f.bad ? 'source-over' : 'lighter';
      g.globalAlpha = (1 - k) * (f.bad ? 0.35 : 0.28);
      g.fillStyle = f.color;
      g.fill();
      g.globalAlpha = (1 - k) * 0.9;
      g.strokeStyle = f.color;
      g.lineWidth = (3 + k * 6) * U;
      g.lineJoin = 'round';
      g.stroke();
    }
    g.globalCompositeOperation = 'lighter';
    for (const r of game.rings) {
      const k = ease(r.t / r.life);
      g.globalAlpha = (1 - r.t / r.life) * 0.7;
      g.strokeStyle = r.color;
      g.lineWidth = 2.5 * U;
      g.beginPath();
      g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * k, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawFireflies(game, now) {
    const g = this.ctx;
    const U = game.U;
    const frenzy = game.frenzy > 0;
    const size = 64 * U;
    g.globalCompositeOperation = 'lighter';
    for (const f of game.fireflies) {
      const blink = 0.55 + 0.45 * Math.sin(f.ph);
      const ci = frenzy ? Math.floor((now * 6 + f.ph) % 4) : f.c;
      this.sprite(this.glow[ci], f.x, f.y, size * (0.75 + blink * 0.45), f.alpha * (0.55 + blink * 0.45));
    }
    g.globalCompositeOperation = 'source-over';
    for (const f of game.fireflies) {
      const ci = frenzy ? Math.floor((now * 6 + f.ph) % 4) : f.c;
      g.globalAlpha = f.alpha;
      g.fillStyle = '#FFFDF2';
      this.shape(COLORS[ci].shape, f.x, f.y, 4 * U);
      g.globalAlpha = f.alpha * 0.9;
      g.fillStyle = COLORS[ci].hex;
      this.shape(COLORS[ci].shape, f.x, f.y, 2.6 * U);
    }
    g.globalAlpha = 1;
  }

  drawGolden(game, now) {
    const gd = game.golden;
    if (!gd) return;
    const g = this.ctx;
    const U = game.U;
    const fade = Math.min(1, gd.t / 0.4, (gd.life - gd.t) / 0.6);
    g.globalCompositeOperation = 'lighter';
    this.sprite(this.goldGlow, gd.x, gd.y, 90 * U * (1 + 0.1 * Math.sin(now * 12)), fade);
    g.save();
    g.translate(gd.x, gd.y);
    g.rotate(now * 2);
    g.globalAlpha = fade * 0.8;
    g.fillStyle = '#FFF3B0';
    for (let i = 0; i < 4; i++) {
      g.rotate(TAU / 4);
      g.beginPath();
      g.moveTo(0, -18 * U);
      g.lineTo(2 * U, 0);
      g.lineTo(-2 * U, 0);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = fade;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(gd.x, gd.y, 4.5 * U, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }

  drawMoths(game, now) {
    const g = this.ctx;
    const U = game.U;
    for (const m of game.moths) {
      const x = m.x;
      const y = m.y;
      this.sprite(this.darkHalo, x, y, 70 * U, 0.9);
      // Danger ring so moths read clearly on a dark sky.
      g.globalAlpha = 0.35 + 0.2 * Math.sin(now * 5 + m.ph * 0.1);
      g.strokeStyle = '#FF5A44';
      g.lineWidth = 1.5 * U;
      g.beginPath();
      g.arc(x, y, 17 * U, 0, TAU);
      g.stroke();
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(m.ph));
      const ang = Math.atan2(m.vy, m.vx);
      g.save();
      g.translate(x, y);
      g.rotate(ang + Math.PI / 2);
      g.globalAlpha = 1;
      g.fillStyle = '#2a1a24';
      g.strokeStyle = 'rgba(255,120,90,0.55)';
      g.lineWidth = 1 * U;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(side * 7 * U * flap, -1 * U, 8 * U * flap, 6 * U, side * 0.5, 0, TAU);
        g.fill();
        g.stroke();
        g.beginPath();
        g.ellipse(side * 5 * U * flap, 5 * U, 5 * U * flap, 4 * U, side * -0.4, 0, TAU);
        g.fill();
        g.stroke();
      }
      g.fillStyle = '#140c12';
      g.beginPath();
      g.ellipse(0, 1 * U, 2.6 * U, 7 * U, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#FF4A3A';
      g.beginPath();
      g.arc(-1.6 * U, -5 * U, 1.3 * U, 0, TAU);
      g.arc(1.6 * U, -5 * U, 1.3 * U, 0, TAU);
      g.fill();
      g.restore();
      g.globalCompositeOperation = 'lighter';
      this.sprite(this.redGlow, x, y - 3 * U, 14 * U, 0.8);
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
  }

  drawBats(game, now) {
    const g = this.ctx;
    const U = game.U;
    for (const b of game.bats) {
      if (b.warn > 0) {
        const x = b.dir > 0 ? 16 * U : game.W - 16 * U;
        const a = 0.5 + 0.5 * Math.sin(now * 20);
        g.globalAlpha = a;
        g.fillStyle = '#C9D4FF';
        g.beginPath();
        g.moveTo(x + b.dir * 10 * U, b.y0);
        g.lineTo(x - b.dir * 4 * U, b.y0 - 9 * U);
        g.lineTo(x - b.dir * 4 * U, b.y0 + 9 * U);
        g.closePath();
        g.fill();
        continue;
      }
      const flap = Math.sin(b.t * 22);
      g.save();
      g.translate(b.x, b.y);
      g.scale(b.dir, 1);
      g.globalAlpha = 1;
      g.fillStyle = '#0b0818';
      g.strokeStyle = 'rgba(190,180,255,0.7)';
      g.lineWidth = 1.2 * U;
      g.beginPath();
      g.moveTo(6 * U, 0);
      g.quadraticCurveTo(0, -4 * U, -6 * U, 0);
      g.lineTo(-20 * U, -12 * U * flap);
      g.lineTo(-14 * U, -2 * U * flap);
      g.lineTo(-10 * U, -6 * U * flap);
      g.lineTo(-6 * U, 3 * U);
      g.lineTo(6 * U, 3 * U);
      g.lineTo(10 * U, -6 * U * flap);
      g.lineTo(14 * U, -2 * U * flap);
      g.lineTo(20 * U, -12 * U * flap);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#FFE36E';
      g.beginPath();
      g.arc(4 * U, -1 * U, 1 * U, 0, TAU);
      g.fill();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  drawTrail(game) {
    const tr = game.trail;
    const pts = tr.pts;
    if (pts.length < 2) return;
    const g = this.ctx;
    const U = game.U;
    const fade = tr.active ? 1 : Math.max(0, 1 - (game.clock - tr.releasedAt) / tr.opts.fadeTime);
    if (fade <= 0) return;
    const n = pts.length;
    // Stack continuous strokes that start further along the line each time, so the
    // tail fades out smoothly with no seams or overlapping caps.
    const layers = Math.min(6, n - 1);
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    g.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      g.lineWidth = pass === 0 ? 13 * U : 3 * U;
      g.strokeStyle = pass === 0 ? '#FFB45A' : '#FFF6DE';
      g.globalAlpha = (fade * (pass === 0 ? 0.3 : 1)) / layers;
      for (let k = 0; k < layers; k++) {
        const s = Math.floor((k * (n - 1)) / layers);
        g.beginPath();
        g.moveTo(pts[s].x, pts[s].y);
        for (let i = s + 1; i < n; i++) g.lineTo(pts[i].x, pts[i].y);
        g.stroke();
      }
    }
    g.lineCap = 'round';
    const h = pts[n - 1];
    if (tr.active) {
      this.sprite(this.warmGlow, h.x, h.y, 60 * U, 0.9);
      // Hint: releasing near the start closes the loop.
      const p0 = pts[0];
      const gap = Math.hypot(p0.x - h.x, p0.y - h.y);
      if (n > 12 && tr.length > gap * 4 && gap < tr.opts.releaseSnap * 2.2) {
        g.globalAlpha = 0.5;
        g.setLineDash([4 * U, 5 * U]);
        g.strokeStyle = '#FFF6DE';
        g.lineWidth = 1.5 * U;
        g.beginPath();
        g.moveTo(h.x, h.y);
        g.lineTo(p0.x, p0.y);
        g.stroke();
        g.setLineDash([]);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawParticles(game) {
    const g = this.ctx;
    g.globalCompositeOperation = 'lighter';
    for (const p of game.particles) {
      g.globalAlpha = 1 - p.t / p.life;
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawFlyers(game) {
    const g = this.ctx;
    const U = game.U;
    g.globalCompositeOperation = 'lighter';
    for (const f of game.flyers) {
      if (f.t < 0) {
        this.sprite(this.glow[f.c], f.x, f.y, 40 * U, 0.8);
        continue;
      }
      this.sprite(this.glow[f.c], f.x, f.y, 36 * U, 0.9);
      g.globalAlpha = 1;
      g.fillStyle = '#FFFDF2';
      g.beginPath();
      g.arc(f.x, f.y, 2.6 * U, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawPopups(game) {
    const U = game.U;
    for (const p of game.popups) {
      const k = p.t / p.life;
      const pop = k < 0.15 ? ease(k / 0.15) : 1;
      const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      this.text(p.text, p.x, p.y - k * 26 * U, p.size * U * (0.6 + 0.4 * pop), p.color, { alpha, glow: 10 * U, glowColor: 'rgba(0,0,0,0.6)' });
    }
  }

  drawHud(game, now) {
    const g = this.ctx;
    const U = game.U;
    const h = game.hud;
    const W = game.W;
    // Score
    this.text(fmt(game.displayScore), W / 2, h.scoreY, 34 * U, '#FFF4D6', { weight: 900, glow: 16 * U, glowColor: 'rgba(255,190,90,0.55)' });
    if (game.combo >= 2) {
      const left = Math.max(0, 1 - (game.clock - game.lastLoopAt) / 2.2);
      const cx = W / 2 + 88 * U;
      g.strokeStyle = 'rgba(255,184,107,0.9)';
      g.lineWidth = 2.5 * U;
      g.beginPath();
      g.arc(cx, h.scoreY, 15 * U, -Math.PI / 2, -Math.PI / 2 + TAU * left);
      g.stroke();
      this.text(`×${Math.min(game.combo, 8)}`, cx, h.scoreY + 0.5 * U, 14 * U, '#FFB86B', { weight: 900 });
    }

    // Lantern glow bar
    const glowK = game.glow / 100;
    const low = game.glow < 25;
    g.fillStyle = 'rgba(255,255,255,0.1)';
    this.roundRect(h.barX, h.barY, h.barW, h.barH, h.barH / 2);
    g.fill();
    if (glowK > 0) {
      const grad = g.createLinearGradient(h.barX, 0, h.barX + h.barW, 0);
      if (low) {
        grad.addColorStop(0, '#FF6B4A');
        grad.addColorStop(1, '#FFB35A');
      } else if (game.frenzy > 0) {
        grad.addColorStop(0, '#FF8FD0');
        grad.addColorStop(0.5, '#FFE36E');
        grad.addColorStop(1, '#6FF0FF');
      } else {
        grad.addColorStop(0, '#FF9F43');
        grad.addColorStop(1, '#FFE9A0');
      }
      g.fillStyle = grad;
      g.globalAlpha = low ? 0.65 + 0.35 * Math.sin(now * 10) : 1;
      this.roundRect(h.barX, h.barY, Math.max(h.barH, h.barW * glowK), h.barH, h.barH / 2);
      g.fill();
      g.globalAlpha = 1;
    }

    // Lantern jar
    const jx = h.jarX;
    const jy = h.jarY;
    const pulse = game.jarPulse || 0;
    g.globalCompositeOperation = 'lighter';
    this.sprite(this.warmGlow, jx, jy, (40 + 30 * glowK + pulse * 20) * U, 0.35 + 0.6 * glowK);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,240,210,0.85)';
    g.lineWidth = 1.6 * U;
    this.roundRect(jx - 7 * U, jy - 8 * U, 14 * U, 17 * U, 4 * U);
    g.stroke();
    g.fillStyle = 'rgba(255,240,210,0.85)';
    g.fillRect(jx - 5 * U, jy - 11.5 * U, 10 * U, 3 * U);

    // Night indicator
    this.text(t('night', { n: game.level }), W / 2, h.barY + 20 * U, 11 * U, '#AEB9E8', { weight: 700, alpha: 0.7, spacing: 1 });

    // Pause button (not shown while the game is already paused)
    if (!game.paused && game.state === 'playing') {
      const p = h.pause;
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,244,214,0.85)';
      g.fillRect(p.x - 5 * U, p.y - 6 * U, 3.4 * U, 12 * U);
      g.fillRect(p.x + 1.6 * U, p.y - 6 * U, 3.4 * U, 12 * U);
    }
  }

  drawBanner(game) {
    const b = game.banners[0];
    if (!b || game.paused) return;
    const g = this.ctx;
    const U = game.U;
    const k = b.t / b.life;
    const alpha = Math.min(1, b.t / 0.25, (b.life - b.t) / 0.4);
    const y = game.hud.bottom + 26 * U - (1 - ease(b.t / 0.3)) * 10 * U;
    const size = this.fitSize(b.text, 15 * U, game.W - 70 * U, 800);
    g.font = `800 ${Math.round(size)}px ${FONT}`;
    const w = g.measureText(b.text).width + 28 * U;
    g.globalAlpha = alpha * 0.75;
    g.fillStyle = '#0b1030';
    this.roundRect(game.W / 2 - w / 2, y - 16 * U, w, 32 * U, 16 * U);
    g.fill();
    g.globalAlpha = 1;
    this.text(b.text, game.W / 2, y, size, '#FFF4D6', { alpha });
    void k;
  }

  drawGhostHand(x, y, r, phase, U) {
    const g = this.ctx;
    for (let i = 0; i < 14; i++) {
      const a = phase - i * 0.09;
      g.globalAlpha = (1 - i / 14) * 0.7;
      g.fillStyle = '#FFF6DE';
      g.beginPath();
      g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, (3.2 - i * 0.15) * U, 0, TAU);
      g.fill();
    }
    const hx = x + Math.cos(phase) * r;
    const hy = y + Math.sin(phase) * r * 0.85;
    g.globalAlpha = 0.95;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(hx, hy, 8 * U, 0, TAU);
    g.fill();
    g.globalAlpha = 0.35;
    g.beginPath();
    g.arc(hx, hy, 14 * U, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }

  drawTutorial(game, now) {
    if (!game.firstCatch || game.paused) return;
    const U = game.U;
    const y = game.H - 58 * U;
    const size = this.fitSize(t('tutorial'), 16 * U, game.W - 40 * U, 800);
    this.text(t('tutorial'), game.W / 2, y, size, '#FFF4D6', { alpha: 0.75 + 0.25 * Math.sin(now * 3), glow: 8 * U, glowColor: 'rgba(0,0,0,0.8)' });
    if (game.runTime > 1.5 && game.flocks.length && !game.pointer.down) {
      let best = game.flocks[0];
      let bd = Infinity;
      for (const fl of game.flocks) {
        const d = Math.hypot(fl.x - game.W / 2, fl.y - game.H / 2);
        if (d < bd) {
          bd = d;
          best = fl;
        }
      }
      this.drawGhostHand(best.x, best.y, 48 * U, now * 4, U);
    }
  }

  drawTitle(game, now) {
    const g = this.ctx;
    const U = game.U;
    const W = game.W;
    const H = game.H;
    const logoY = H * 0.3;
    const size = Math.min(78 * U, W * 0.17);
    g.save();
    g.font = `900 ${Math.round(size)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const tw = g.measureText('Glowloop').width;
    const grad = g.createLinearGradient(W / 2 - tw / 2, 0, W / 2 + tw / 2, 0);
    grad.addColorStop(0, '#FFE9A0');
    grad.addColorStop(0.5, '#FFD447');
    grad.addColorStop(1, '#FF8FCB');
    g.shadowColor = 'rgba(255,200,90,0.8)';
    g.shadowBlur = (18 + 6 * Math.sin(now * 2)) * U;
    g.fillStyle = grad;
    g.fillText('Glowloop', W / 2, logoY);
    g.restore();
    this.text(t('tagline').toUpperCase(), W / 2, logoY + size * 0.62, 13 * U, '#BFD0FF', { weight: 800, spacing: 3 * U, alpha: 0.9 });

    // Dashed ring around the start flock
    const fl = game.titleFlock;
    if (fl && !game.titleStartAt) {
      g.save();
      g.translate(fl.x, fl.y);
      g.rotate(now * 0.4);
      g.setLineDash([7 * U, 9 * U]);
      g.strokeStyle = 'rgba(255,246,222,0.55)';
      g.lineWidth = 2 * U;
      g.beginPath();
      g.arc(0, 0, 62 * U, 0, TAU);
      g.stroke();
      g.restore();
      const hint = t('startHint');
      const hs = this.fitSize(hint, 16 * U, W - 40 * U, 800);
      this.text(hint, W / 2, fl.y + 92 * U, hs, '#FFF4D6', { alpha: 0.7 + 0.3 * Math.sin(now * 3), glow: 8 * U, glowColor: 'rgba(0,0,0,0.8)' });
      if (game.ghost > 0) this.drawGhostHand(fl.x, fl.y, 62 * U, game.ghost * 4.5, U);
    }
    const best = game.save.best || 0;
    if (best > 0) this.text(`${t('best')}  ${fmt(best)}`, W / 2, H - 44 * U, 14 * U, '#AEB9E8', { weight: 800, spacing: 1 });
  }

  drawLoading(U, now) {
    const { W, H } = this;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.bg, 0, 0, W, H);
    const size = Math.min(78 * U, W * 0.17);
    this.text('Glowloop', W / 2, H * 0.3, size, '#FFD447', { weight: 900, glow: 18 * U, glowColor: 'rgba(255,200,90,0.8)' });
    this.text(t('loading'), W / 2, H * 0.64, 16 * U, '#BFD0FF', { weight: 700, alpha: 0.8 });
    void now;
  }

  drawPaused(game) {
    const g = this.ctx;
    const U = game.U;
    g.fillStyle = 'rgba(5,8,22,0.72)';
    g.fillRect(0, 0, game.W, game.H);
    this.text(t('paused'), game.W / 2, game.H / 2 - 16 * U, 36 * U, '#FFF4D6', { weight: 900, glow: 16 * U, glowColor: 'rgba(255,190,90,0.5)' });
    this.text(t('tapResume'), game.W / 2, game.H / 2 + 26 * U, 16 * U, '#BFD0FF', { weight: 700 });
  }

  drawGameOver(game, now) {
    const g = this.ctx;
    const U = game.U;
    const W = game.W;
    const H = game.H;
    const k = ease(game.overT / 0.5);
    g.fillStyle = `rgba(5,8,22,${0.55 * k})`;
    g.fillRect(0, 0, W, H);
    const pw = Math.min(W - 32 * U, 330 * U);
    const ph = 330 * U;
    const px = W / 2 - pw / 2;
    const py = H / 2 - ph / 2 + (1 - k) * 30 * U;
    g.globalAlpha = k;
    g.fillStyle = 'rgba(14,20,52,0.92)';
    this.roundRect(px, py, pw, ph, 22 * U);
    g.fill();
    g.strokeStyle = 'rgba(255,212,71,0.35)';
    g.lineWidth = 1.5 * U;
    g.stroke();

    const title = t('gameOver');
    this.text(title, W / 2, py + 34 * U, this.fitSize(title, 17 * U, pw - 30 * U), '#BFD0FF', { weight: 800, alpha: k });
    this.text(fmt(game.score), W / 2, py + 86 * U, 54 * U, '#FFF4D6', { weight: 900, alpha: k, glow: 18 * U, glowColor: 'rgba(255,190,90,0.6)' });
    if (game.stats.newBest) {
      const s = 1 + 0.06 * Math.sin(now * 6);
      this.text(t('newBest'), W / 2, py + 128 * U, 16 * U * s, '#FFD447', { weight: 900, alpha: k });
    } else {
      this.text(`${t('best')}  ${fmt(game.save.best || 0)}`, W / 2, py + 128 * U, 14 * U, '#AEB9E8', { weight: 800, alpha: k });
    }
    const rows = [
      [t('caught'), fmt(game.stats.caught)],
      [t('biggest'), fmt(game.stats.biggest)],
      [t('bestCombo'), `×${game.stats.bestCombo}`],
    ];
    rows.forEach(([label, value], i) => {
      const y = py + (166 + i * 28) * U;
      const ls = this.fitSize(label, 14 * U, pw - 110 * U, 700);
      this.text(label, px + 24 * U, y, ls, '#AEB9E8', { weight: 700, align: 'left', alpha: k });
      this.text(value, px + pw - 24 * U, y, 15 * U, '#FFF4D6', { weight: 800, align: 'right', alpha: k });
    });

    const bw = Math.min(pw - 48 * U, 220 * U);
    const bh = 50 * U;
    const bx = W / 2 - bw / 2;
    const by = py + ph - bh - 22 * U;
    game.ui.playAgain = { x: bx, y: by, w: bw, h: bh };
    const ready = game.overT > 0.6;
    g.globalAlpha = k * (ready ? 1 : 0.5);
    const grad = g.createLinearGradient(bx, by, bx + bw, by + bh);
    grad.addColorStop(0, '#FFD447');
    grad.addColorStop(1, '#FF9F43');
    g.fillStyle = grad;
    g.shadowColor = 'rgba(255,190,90,0.6)';
    g.shadowBlur = 16 * U;
    this.roundRect(bx, by, bw, bh, bh / 2);
    g.fill();
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
    const label = t('playAgain');
    this.text(label, W / 2, by + bh / 2 + 1, this.fitSize(label, 19 * U, bw - 24 * U, 900), '#2A1600', { weight: 900, alpha: k * (ready ? 1 : 0.5) });
    g.globalAlpha = 1;
  }
}
