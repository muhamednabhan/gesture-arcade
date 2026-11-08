import assert from "node:assert/strict";
import { PongAI, predictX } from "../src/games/pong/ai.js";
assert.ok(Math.abs(predictX({ x: 50, y: 100, vx: 0, vy: -10, r: 5 }, 0, 100) - 50) < 1e-6);
const x = predictX({ x: 90, y: 100, vx: 50, vy: -50, r: 5 }, 0, 100); assert.ok(x >= 5 && x <= 95);
const ai = new PongAI(); let miss = 0, run = 0, maxRun = 0, seq = [];
for (let i = 0; i < 2000; i++) { ai.plan(); seq.push(ai.willMiss); if (ai.willMiss) { miss++; run = 0; } else maxRun = Math.max(maxRun, ++run); }
const rate = miss / 2000; assert.ok(rate > 0.15 && rate < 0.5, "miss rate " + rate); assert.ok(maxRun <= 10, "max returns in a row " + maxRun);
const gaps = []; let g = 0; for (const m of seq) { if (m) { gaps.push(g); g = 0; } else g++; } assert.ok(new Set(gaps).size > 3, "gaps vary");
console.log("pong ok, ai miss rate", rate.toFixed(2));
const h = new PongAI(Math.random, true); let hm = 0; for (let i = 0; i < 2000; i++) { h.plan(); if (h.willMiss) hm++; }
assert.ok(hm / 2000 < 0.2 && hm > 0, "hard miss rate " + hm / 2000); console.log("hard miss rate", (hm / 2000).toFixed(2));
