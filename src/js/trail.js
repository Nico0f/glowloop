// The glowing line the player draws. Detects when it closes into a loop.
// Pure logic (no DOM), unit-tested in tests/trail.test.mjs.

import { segmentIntersection, polygonArea } from './geometry.js';

const DEFAULTS = {
  maxLength: 900, // longest trail allowed, in px; the tail is trimmed beyond it
  lifetime: 2.2, // seconds a point survives before the tail fades away
  minStep: 5, // minimum px between recorded points
  snap: 10, // px: the head this close to an older point closes the loop while drawing
  releaseSnap: 30, // px: more forgiving closure when the finger lifts
  minArea: 900, // px²: smaller loops are treated as jitter
  minLoopPoints: 6, // points between head and the snapped point before snapping counts
  fadeTime: 0.28, // seconds the released trail takes to fade out
};

export class Trail {
  constructor(options = {}) {
    this.pts = [];
    this.length = 0;
    this.active = false;
    this.releasedAt = 0;
    this.configure(options);
  }

  configure(options) {
    this.opts = { ...DEFAULTS, ...this.opts, ...options };
  }

  get head() {
    return this.pts[this.pts.length - 1];
  }

  begin(x, y, t) {
    this.pts = [{ x, y, t }];
    this.length = 0;
    this.active = true;
  }

  /** Adds a point. Returns a loop `{ poly, x, y }` when the trail closes, else null. */
  add(x, y, t) {
    if (!this.active) return null;
    const last = this.head;
    const d = Math.hypot(x - last.x, y - last.y);
    if (d < this.opts.minStep) return null;
    this.pts.push({ x, y, t });
    this.length += d;
    this.trimToLength();
    return this.detectLoop();
  }

  /** Finger lifted. Returns a loop if the end is close enough to an earlier point. */
  end(t) {
    if (!this.active) return null;
    this.active = false;
    this.releasedAt = t;
    // Long loops get a proportionally bigger gap allowance.
    const radius = Math.max(this.opts.releaseSnap, Math.min(this.length * 0.12, this.opts.releaseSnap * 2.5));
    const loop = this.findSnap(radius);
    if (loop) this.pts = [];
    return loop;
  }

  /** Something broke the line: drop it but keep drawing from the head. */
  cut() {
    const h = this.head;
    this.pts = h ? [{ ...h }] : [];
    this.length = 0;
  }

  clear() {
    this.pts = [];
    this.length = 0;
    this.active = false;
  }

  update(t) {
    if (this.active) {
      while (this.pts.length > 2 && t - this.pts[0].t > this.opts.lifetime) this.dropTail();
    } else if (this.pts.length && t - this.releasedAt > this.opts.fadeTime) {
      this.pts = [];
      this.length = 0;
    }
  }

  dropTail() {
    const a = this.pts[0];
    const b = this.pts[1];
    this.length -= Math.hypot(b.x - a.x, b.y - a.y);
    this.pts.shift();
  }

  trimToLength() {
    while (this.length > this.opts.maxLength && this.pts.length > 2) this.dropTail();
  }

  detectLoop() {
    const pts = this.pts;
    const n = pts.length;
    if (n < 4) return null;
    const a = pts[n - 2];
    const b = pts[n - 1];
    // Newest segment against older ones, most recent first: the tightest loop wins.
    for (let i = n - 4; i >= 0; i--) {
      const p = pts[i];
      const q = pts[i + 1];
      const hit = segmentIntersection(a.x, a.y, b.x, b.y, p.x, p.y, q.x, q.y);
      if (!hit) continue;
      const poly = [{ x: hit.x, y: hit.y }];
      for (let k = i + 1; k <= n - 2; k++) poly.push({ x: pts[k].x, y: pts[k].y });
      if (poly.length >= 3 && polygonArea(poly) >= this.opts.minArea) {
        return this.restartFrom(b, poly, hit.x, hit.y);
      }
    }
    const snapped = this.findSnap(this.opts.snap);
    return snapped ? this.restartFrom(b, snapped.poly, snapped.x, snapped.y) : null;
  }

  /** Closest older point within `radius` of the head that forms a big enough loop. */
  findSnap(radius) {
    const pts = this.pts;
    const n = pts.length;
    if (n <= this.opts.minLoopPoints) return null;
    const h = pts[n - 1];
    // Path length from each point to the head, so a point we just drew past
    // (close in space but also close along the line) is not mistaken for a loop.
    const arc = new Array(n).fill(0);
    for (let i = n - 2; i >= 0; i--) {
      arc[i] = arc[i + 1] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    let best = null;
    let bestD = radius;
    for (let i = 0; i <= n - this.opts.minLoopPoints; i++) {
      const d = Math.hypot(pts[i].x - h.x, pts[i].y - h.y);
      if (d > bestD || arc[i] < d * 4) continue;
      const poly = pts.slice(i).map((p) => ({ x: p.x, y: p.y }));
      if (polygonArea(poly) < this.opts.minArea) continue;
      best = poly;
      bestD = d;
    }
    return best ? { poly: best, x: h.x, y: h.y } : null;
  }

  restartFrom(head, poly, x, y) {
    this.pts = [{ x: head.x, y: head.y, t: head.t }];
    this.length = 0;
    return { poly, x, y };
  }
}
