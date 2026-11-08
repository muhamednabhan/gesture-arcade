import assert from "node:assert/strict";
import { BlinkStateMachine, BlinkState } from "../src/games/flappy-bird/blinkDetection.js";
import { FlappyEngine, Status } from "../src/games/flappy-bird/gameEngine.js";

// Helper: feed frames at ~30fps from a list of [score, durationMs] segments.
function run(segments, machine, t0 = 0) {
  let t = t0;
  for (const [score, ms] of segments) {
    const end = t + ms;
    for (; t < end; t += 33) machine.update(score, t);
  }
  return t;
}
const calibrate = (m) => run([[0.08, 1000]], m); // 24+ open-eye frames
const make = () => { const jumps = []; const m = new BlinkStateMachine({}, (t) => jumps.push(t)); return { m, jumps }; };

{ // Calibration gates detection
  const { m } = make();
  m.update(0.08, 0);
  assert.equal(m.state, BlinkState.CALIBRATING);
  calibrate(m);
  assert.equal(m.state, BlinkState.READY);
}
{ // A complete blink (~200ms closed) => exactly one jump
  const { m, jumps } = make(); let t = calibrate(m);
  run([[0.9, 200], [0.05, 600]], m, t);
  assert.equal(jumps.length, 1);
}
{ // Eyes held closed for 3s => exactly ONE jump (at closure), never repeated
  const { m, jumps } = make(); let t = calibrate(m);
  t = run([[0.95, 3000]], m, t);
  assert.equal(jumps.length, 1);
  t = run([[0.05, 600]], m, t); // reopening fires nothing
  assert.equal(jumps.length, 1);
  run([[0.9, 200], [0.05, 400]], m, t); // next real blink works
  assert.equal(jumps.length, 2);
}
{ // No cooldown: fast consecutive blinks each count
  const { m, jumps } = make(); let t = calibrate(m);
  t = run([[0.9, 100], [0.05, 66], [0.9, 100], [0.05, 66], [0.9, 100], [0.05, 200]], m, t);
  assert.equal(jumps.length, 3);
}
{ // Fires immediately on the first closed frame (before the eyes reopen)
  const { m, jumps } = make(); let t = calibrate(m);
  run([[0.9, 40]], m, t);
  assert.equal(jumps.length, 1);
}
{ // Hysteresis: hovering between open and close thresholds does not trigger or re-arm early
  const { m, jumps } = make(); let t = calibrate(m);
  run([[0.9, 150], [0.4, 500], [0.05, 300]], m, t);
  assert.equal(jumps.length, 1); // hovering between thresholds neither repeats nor re-arms
}
{ // Face lost mid-closure => no extra blink when it returns
  const { m, jumps } = make(); let t = calibrate(m);
  t = run([[0.9, 100]], m, t);
  t = run([[null, 1000]], m, t);
  assert.equal(m.state, BlinkState.NO_FACE);
  run([[0.05, 500]], m, t);
  assert.equal(jumps.length, 1);
  assert.equal(m.state, BlinkState.READY);
}
{ // Squinting player: thresholds adapt upward
  const { m, jumps } = make(); let t = run([[0.35, 1000]], m);
  assert.ok(m.openThreshold > 0.3 && m.closeThreshold > 0.5);
  run([[0.95, 200], [0.3, 400]], m, t);
  assert.equal(jumps.length, 1);
}

// Engine
{
  const e = new FlappyEngine(400, () => 0.5);
  assert.equal(e.status, Status.READY);
  for (let i = 0; i < 120; i++) e.update(1 / 60);
  assert.equal(e.status, Status.READY, "bird hovers until first jump");
  e.jump(); e.update(1 / 60);
  assert.equal(e.status, Status.PLAYING);
  assert.ok(e.bird.vy < 0);
  for (let i = 0; i < 600 && e.status === Status.PLAYING; i++) e.update(1 / 60); // no input => falls and dies
  assert.equal(e.status, Status.DEAD);
  const dead = e.score; e.jump(); e.update(1 / 60);
  assert.equal(e.score, dead, "no input accepted when dead");
  e.reset(); assert.equal(e.status, Status.READY); assert.equal(e.score, 0);
}
{ // Scoring: a simple autopilot flies the gap centers
  const e = new FlappyEngine(400, () => 0.5); e.jump();
  for (let i = 0; i < 60 * 40 && e.status !== Status.DEAD; i++) {
    const next = e.pipes.find((p) => p.x + 62 > e.bird.x - 12);
    if (next && e.bird.y > next.gapY + 10 && e.bird.vy > -50) e.jump();
    e.update(1 / 60);
  }
  assert.ok(e.score >= 5, `autopilot scored ${e.score}`);
}
{ // Huge dt (stalled tab) is clamped: bird can't tunnel
  const e = new FlappyEngine(400, () => 0.5); e.jump(); e.update(0.016);
  e.update(5);
  assert.ok(e.bird.y < 480);
}
console.log("all tests passed");
