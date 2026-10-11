import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Trail } from '../src/js/trail.js';
import {
  segmentIntersection,
  pointInPolygon,
  polygonArea,
  distSqToSegment,
} from '../src/js/geometry.js';

/** Feeds a circle into the trail, starting at angle 0, going `turns` times around. */
function drawCircle(trail, cx, cy, r, turns = 1.15, steps = 60) {
  let t = 0;
  trail.begin(cx + r, cy, t);
  const loops = [];
  const total = Math.round(steps * turns);
  for (let i = 1; i <= total; i++) {
    t += 0.01;
    const a = (i / steps) * Math.PI * 2;
    const loop = trail.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.97 + i * 0.05, t);
    if (loop) loops.push(loop);
  }
  return loops;
}

test('segments that cross intersect at the right point', () => {
  const hit = segmentIntersection(0, 0, 10, 10, 0, 10, 10, 0);
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 5) < 1e-9 && Math.abs(hit.y - 5) < 1e-9);
  assert.equal(segmentIntersection(0, 0, 10, 0, 0, 1, 10, 1), null);
  assert.equal(segmentIntersection(0, 0, 1, 1, 5, 0, 6, -1), null);
});

test('point in polygon and area', () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(polygonArea(sq), 100);
  assert.equal(pointInPolygon(5, 5, sq), true);
  assert.equal(pointInPolygon(15, 5, sq), false);
  assert.equal(distSqToSegment(5, 5, 0, 0, 10, 0), 25);
});

test('drawing a full circle closes exactly one loop around the center', () => {
  const trail = new Trail();
  const loops = drawCircle(trail, 200, 200, 80);
  assert.equal(loops.length, 1);
  const { poly } = loops[0];
  assert.equal(pointInPolygon(200, 200, poly), true);
  assert.equal(pointInPolygon(200, 330, poly), false);
  const area = polygonArea(poly);
  assert.ok(area > Math.PI * 80 * 80 * 0.8 && area < Math.PI * 80 * 80 * 1.1, `area ${area}`);
});

test('two turns in one stroke close two loops (combo chaining)', () => {
  const trail = new Trail();
  const loops = drawCircle(trail, 200, 200, 80, 2.3);
  assert.equal(loops.length, 2);
});

test('a straight line never closes', () => {
  const trail = new Trail();
  trail.begin(0, 0, 0);
  for (let i = 1; i < 100; i++) assert.equal(trail.add(i * 6, i * 2, i * 0.01), null);
});

test('tiny jitter loops are ignored', () => {
  const trail = new Trail();
  const loops = drawCircle(trail, 50, 50, 12, 1.5, 12);
  assert.equal(loops.length, 0);
});

test('lifting the finger near the start closes the loop', () => {
  const trail = new Trail();
  let t = 0;
  trail.begin(300, 200, t);
  // 330 degrees of a circle: the end stops short of the start
  for (let i = 1; i <= 55; i++) {
    t += 0.01;
    const a = (i / 60) * Math.PI * 2;
    assert.equal(trail.add(200 + Math.cos(a) * 100, 200 + Math.sin(a) * 100, t), null);
  }
  const loop = trail.end(t);
  assert.ok(loop, 'expected a loop on release');
  assert.equal(pointInPolygon(200, 200, loop.poly), true);
});

test('the tail is trimmed to the max length', () => {
  const trail = new Trail({ maxLength: 200 });
  trail.begin(0, 0, 0);
  for (let i = 1; i < 200; i++) trail.add(i * 6, 0, i * 0.001);
  assert.ok(trail.length <= 200);
});

test('old points expire while drawing', () => {
  const trail = new Trail({ lifetime: 1 });
  trail.begin(0, 0, 0);
  for (let i = 1; i < 50; i++) trail.add(i * 6, 0, i * 0.1);
  trail.update(5);
  assert.ok(trail.pts.length <= 12, `kept ${trail.pts.length} points`);
});
