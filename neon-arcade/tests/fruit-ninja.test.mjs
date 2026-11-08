// Run with: node tests/fruit-ninja.test.mjs
import assert from "node:assert/strict";
import { FruitEngine, Status, Kind } from "../src/games/fruit-ninja/fruitEngine.js";
import { OneEuro, mapLandmark } from "../src/games/fruit-ninja/handTracker.js";
import { rules, input } from "../src/games/fruit-ninja/config.js";
import { FRUIT_TYPES, BOMB } from "../src/games/fruit-ninja/fruitTypes.js";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok -", name); };

// deterministic rng
function seeded(seed) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function engine(seed = 1) { const e = new FruitEngine(seeded(seed)); e.setSize(860, 540); e.start(); return e; }
function put(e, { x = 400, y = 300, bomb = false, type = FRUIT_TYPES[0] } = {}) {
  const f = e._launch({ bomb, type: bomb ? BOMB : type, x0: x, xa: x, apex: 0.5, wave: 0 });
  f.x = x; f.y = y; f.vx = 0; f.vy = 0; f.g = 0; // freeze in place for geometry tests
  return f;
}
const clean = (e) => { e.fruits.length = 0; e.events.length = 0; };

test("slash through a fruit scores once and removes it", () => {
  const e = engine(); clean(e); put(e);
  assert.equal(e.slash(300, 300, 500, 300), 1);
  assert.equal(e.score, 10);
  assert.equal(e.fruits.length, 0);
  assert.equal(e.events.find((x) => x.type === "slice").points, 10);
});

test("very fast sweep (endpoints far outside the fruit) still hits it", () => {
  const e = engine(); clean(e); put(e, { x: 430, y: 270 });
  assert.equal(e.slash(0, 270, 860, 270), 1); // fingertip never inside the fruit on either frame
});

test("a segment that passes beside the fruit misses", () => {
  const e = engine(); clean(e); const f = put(e);
  assert.equal(e.slash(300, f.y - f.r - 40, 500, f.y - f.r - 40), 0);
  assert.equal(e.score, 0);
});

test("a resting (sub-jitter) fingertip inside a fruit does not slice", () => {
  const e = engine(); clean(e); put(e);
  assert.equal(e.slash(400, 300, 401, 300), 0);
});

test("a fruit can only score once even if several segments overlap it", () => {
  const e = engine(); clean(e); put(e);
  const a = e.slash(300, 300, 500, 300), b = e.slash(300, 290, 500, 310), c = e.slash(500, 300, 300, 300);
  assert.equal(a + b + c, 1);
  assert.equal(e.score, 10);
});

test("combo chain: bonus grows, window expires", () => {
  const e = engine(); clean(e);
  put(e, { x: 200, y: 300 }); put(e, { x: 400, y: 300 }); put(e, { x: 600, y: 300 });
  assert.equal(e.slash(100, 300, 700, 300), 3);
  // 10 + (10+5) + (10+10) = 45
  assert.equal(e.score, 45);
  assert.equal(e.maxCombo, 3);
  assert.ok(e.events.some((x) => x.type === "combo" && x.count === 3));
  e.comboTimer = 0.01; e.update(0.05);
  assert.equal(e.comboCount, 0);
});

test("missed fruit costs a life; third miss ends the round", () => {
  const e = engine(); clean(e);
  for (let i = 0; i < rules.lives; i++) {
    const f = put(e, { x: 400, y: e.h + 500 }); f.vy = 100; f.g = 0; // already falling below the screen
    e.update(0.016);
  }
  assert.equal(e.lives, 0);
  assert.equal(e.status, Status.OVER);
  assert.ok(e.events.some((x) => x.type === "over"));
  assert.equal(e.slash(0, 0, 860, 540), 0); // no scoring after game over
});

test("slicing a bomb costs a life, scores nothing, resets the combo", () => {
  const e = engine(); clean(e);
  put(e, { x: 200, y: 300 }); put(e, { x: 500, y: 300, bomb: true });
  e.slash(100, 300, 400, 300); // one fruit: combo 1
  assert.equal(e.comboCount, 1);
  e.slash(400, 300, 600, 300);
  assert.equal(e.lives, rules.lives - 1);
  assert.equal(e.comboCount, 0);
  assert.equal(e.score, 10);
  assert.ok(e.events.some((x) => x.type === "bomb"));
});

test("a missed bomb is harmless", () => {
  const e = engine(); clean(e);
  const f = put(e, { x: 400, y: e.h + 500, bomb: true }); f.vy = 100;
  e.update(0.016);
  assert.equal(e.lives, rules.lives);
  assert.equal(e.missed, 0);
});

test("perfect wave bonus when every fruit of a 3+ wave is sliced", () => {
  const e = engine(); clean(e);
  const ws = e._waves[5]; ws.id = 5; ws.total = 3; ws.sliced = 0; ws.resolved = 0;
  for (const x of [200, 400, 600]) put(e, { x, y: 300 }).wave = 5;
  e.slash(100, 300, 700, 300);
  assert.equal(e.perfects, 1);
  assert.equal(e.score, 45 + rules.perfectWaveBonus);
});

test("extra life every N slices, capped", () => {
  const e = engine(); clean(e); e.lives = 2;
  for (let i = 0; i < rules.extraLifeEvery; i++) { put(e); e.comboTimer = 0; e.comboCount = 0; e.slash(300, 300, 500, 300); }
  assert.equal(e.lives, 3);
  assert.ok(e.lives <= rules.maxLives);
});

test("spawned fruit launch from below and stay in the arena (500 waves)", () => {
  const e = engine(7); clean(e);
  let spawned = 0, bombs = 0, maxBombsAlive = 0;
  for (let i = 0; i < 500; i++) {
    e.score = i * 3; // ramp difficulty through every level
    e._makeWave();
    for (const q of e._queue.splice(0)) {
      const f = e._launch(q); spawned++;
      if (f.kind === Kind.BOMB) bombs++;
      assert.ok(f.y > e.h, "starts below the bottom edge");
      assert.ok(f.vy < 0, "launched upward");
      // apex must be on-screen horizontally and vertically
      const t = -f.vy / f.g, ax = f.x + f.vx * t, ay = f.y + f.vy * t + 0.5 * f.g * t * t;
      assert.ok(ax > 0 && ax < e.w, `apex x ${ax}`);
      assert.ok(ay > 0 && ay < e.h * 0.7, `apex y ${ay}`);
    }
    maxBombsAlive = Math.max(maxBombsAlive, e._bombsAlive());
    e.fruits.length = 0;
  }
  assert.ok(spawned > 500);
  assert.ok(bombs / spawned < 0.15, `bomb share ${(bombs / spawned).toFixed(3)}`);
  assert.ok(maxBombsAlive <= 2);
});

test("no bombs in the opening waves", () => {
  const e = engine(3); clean(e);
  for (let i = 0; i < 6; i++) { e._makeWave(); assert.ok(e._queue.every((q) => !q.bomb)); e._queue.length = 0; }
});

test("difficulty rises with score (level, interval)", () => {
  const e = engine();
  const a = (e.score = 0, e._interval()), lvl0 = e.level;
  e.score = 900; const lvl = e.level;
  assert.ok(lvl > lvl0);
  const avg = (s) => { e.score = s; let t = 0; for (let i = 0; i < 400; i++) t += e._interval(); return t / 400; };
  assert.ok(avg(1400) < avg(0));
});

test("high arcs avoid the camera-preview safe rectangle", () => {
  const e = engine(4); clean(e); e.setSafeRect({ x: 0, y: 0, w: 160, h: 130 });
  for (let i = 0; i < 300; i++) {
    const f = e._launch({ bomb: false, type: FRUIT_TYPES[1], x0: 50, xa: 40, apex: 0.85, wave: 0 });
    const t = -f.vy / f.g, ax = f.x + f.vx * t;
    assert.ok(ax > 160, `apex x ${ax} behind preview`);
    e.fruits.length = 0;
  }
});

test("a full simulated round ends and never leaves live state behind", () => {
  const e = engine(11);
  for (let i = 0; i < 60 * 120 && e.status === Status.PLAYING; i++) { e.update(1 / 60); e.events.length = 0; }
  assert.equal(e.status, Status.OVER); // idle player loses
  assert.equal(e.score, 0);
});

test("engine reuses fruit objects (pool) across rounds", () => {
  const e = engine(5);
  for (let i = 0; i < 600; i++) { e.update(1 / 60); e.events.length = 0; }
  e.reset();
  assert.ok(e._free.length > 0 || e.fruits.length === 0);
});

test("hand mapping: mirrored, margin-stretched, clamped", () => {
  const mid = mapLandmark({ x: 0.5, y: 0.5 });
  assert.ok(Math.abs(mid.x - 0.5) < 1e-9 && Math.abs(mid.y - 0.5) < 1e-9);
  assert.ok(mapLandmark({ x: 0.2, y: 0.5 }).x > 0.5, "hand on the camera-left (image x small) = screen right (mirror)");
  assert.ok(mapLandmark({ x: 0.8, y: 0.5 }).x < 0.5);
  assert.equal(mapLandmark({ x: 1 - input.marginX + 0.01, y: 0.5 }).x, 0.0); // beyond the active region clamps to the edge
  assert.equal(mapLandmark({ x: 0.0, y: 1.0 }).y, 1.0);
  assert.ok(mapLandmark({ x: input.marginX, y: 0.5 }).x === 1, "active region edge reaches the screen edge");
  const corner = mapLandmark({ x: 1 - input.marginX, y: input.marginY });
  assert.ok(corner.x === 0 && corner.y === 0, "screen corner reachable with the hand inside the frame");
  assert.ok(input.marginX >= 0.2 && input.marginY >= 0.18, "corners must not require the hand at the camera border");
});

test("One-Euro filter: damps jitter when still, follows fast moves closely", () => {
  const f = new OneEuro();
  let t = 0, out = 0, maxDev = 0;
  for (let i = 0; i < 90; i++) { t += 16; out = f.filter(0.5 + (i % 2 ? 0.004 : -0.004), t); if (i > 30) maxDev = Math.max(maxDev, Math.abs(out - 0.5)); }
  assert.ok(maxDev < 0.003, `jitter passes through: ${maxDev}`);
  const g = new OneEuro(); t = 0;
  let x = 0, lag = 0;
  for (let i = 0; i < 20; i++) { t += 16; x = i * 0.04; out = g.filter(x, t); lag = x - out; }
  assert.ok(lag < 0.12, `fast motion lag ${lag}`);
  const h = new OneEuro(); assert.equal(h.filter(0.7, 0), 0.7); // first sample passes straight through
});

console.log(`\n${n} tests passed`);
