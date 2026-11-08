// Pure game rules: spawning, ballistic motion, slash collision, scoring, combos, lives.
// No DOM, no canvas: FruitEngine can run (and be tested) in Node. It reports what happened through
// `events`, which the game drains every frame (the renderer turns them into halves / juice / popups).
import { FRUIT_TYPES, BOMB } from "./fruitTypes.js";
import { rules } from "./config.js";

export const Status = Object.freeze({ READY: "ready", PLAYING: "playing", OVER: "over" });
export const Kind = Object.freeze({ FRUIT: 0, BOMB: 1 });

const WAVE_RING = 24;
const TOTAL_WEIGHT = FRUIT_TYPES.reduce((s, t) => s + t.weight, 0);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Design-pixel -> screen-pixel factor, shared by the engine and the renderer so hitboxes match the artwork. */
export const scaleFor = (w, h) => clamp(Math.min(w / 860, h / 540), 0.55, 1.6);

export class FruitEngine {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.w = 800;
    this.h = 500;
    this.scale = 1;
    this.safe = null; // {x,y,w,h}: area (camera preview) that high arcs avoid
    this.fruits = [];
    this.events = [];
    this._free = [];
    this._queue = [];
    this._hits = [];
    this._waves = Array.from({ length: WAVE_RING }, () => ({ id: -1, total: 0, sliced: 0, resolved: 0 }));
    this.reset();
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    this.scale = scaleFor(w, h);
  }

  setSafeRect(rect) {
    this.safe = rect || null;
  }

  reset() {
    for (const f of this.fruits) this._free.push(f);
    this.fruits.length = 0;
    this._queue.length = 0;
    this.events.length = 0;
    this.status = Status.READY;
    this.score = 0;
    this.lives = rules.lives;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.sliced = 0;
    this.missed = 0;
    this.bombsHit = 0;
    this.perfects = 0;
    this.time = 0;
    this._nextWave = 0;
    this._waveSeq = 0;
    this._waveCount = 0;
    this._sinceFrenzy = 0;
    for (const w of this._waves) w.id = -1;
  }

  start() {
    if (this.status === Status.PLAYING) return;
    this.reset();
    this.status = Status.PLAYING;
    this._nextWave = 0.45; // first fruit arrives almost immediately
  }

  get level() {
    return Math.min(rules.maxLevel, Math.floor(this.score / rules.pointsPerLevel));
  }

  get minSlice() {
    return 5 * this.scale; // ignore sub-jitter movement so a resting fingertip never slices
  }

  // ---------------- events ----------------
  drainEvents(fn) {
    const ev = this.events;
    for (let i = 0; i < ev.length; i++) fn(ev[i]);
    ev.length = 0;
  }

  // ---------------- update ----------------
  update(dt) {
    if (this.status === Status.READY) return;
    this.time += dt;
    const live = this.status === Status.PLAYING;

    if (live) {
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.comboCount = 0;
      }
      this._nextWave -= dt;
      if (this._nextWave <= 0) {
        this._makeWave();
        this._nextWave = this._interval();
      }
      for (let i = this._queue.length - 1; i >= 0; i--) {
        const q = this._queue[i];
        q.delay -= dt;
        if (q.delay <= 0) {
          this._queue.splice(i, 1);
          this._launch(q);
        }
      }
    }

    const fr = this.fruits;
    for (let i = fr.length - 1; i >= 0; i--) {
      const f = fr[i];
      f.vy += f.g * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      f.age += dt;
      const out = f.vy > 0 && (f.y > this.h + f.r * 1.6 || f.x < -f.r * 4 || f.x > this.w + f.r * 4);
      if (out) {
        fr[i] = fr[fr.length - 1];
        fr.pop();
        this._free.push(f);
        if (this.status === Status.PLAYING && f.kind === Kind.FRUIT) this._miss(f);
      }
    }
  }

  // ---------------- slash ----------------
  /** Test one slash segment against every live target. Returns how many were sliced. */
  slash(x0, y0, x1, y1) {
    if (this.status !== Status.PLAYING) return 0;
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 < this.minSlice * this.minSlice) return 0;
    const len = Math.sqrt(len2);
    const angle = Math.atan2(dy, dx);
    const blade = rules.bladeWidth * this.scale;
    const hits = this._hits;
    hits.length = 0;
    for (const f of this.fruits) {
      if (f.sliced) continue;
      // Closest point on the SEGMENT (not just the endpoint), so a fast sweep across a fruit still hits.
      const t = clamp(((f.x - x0) * dx + (f.y - y0) * dy) / len2, 0, 1);
      const cx = x0 + dx * t - f.x, cy = y0 + dy * t - f.y;
      const rr = f.r + blade;
      if (cx * cx + cy * cy <= rr * rr) hits.push({ f, t });
    }
    if (!hits.length) return 0;
    hits.sort((a, b) => a.t - b.t); // chain in the order the blade passed through them
    let n = 0;
    for (const { f } of hits) {
      if (this.status !== Status.PLAYING) break; // a bomb earlier in this swipe may have ended the round
      if (f.sliced) continue;
      f.sliced = true; // flag first: a fruit can score only once even if later segments overlap it
      this._hit(f, angle, len);
      n++;
    }
    for (let i = this.fruits.length - 1; i >= 0; i--) {
      const f = this.fruits[i];
      if (f.sliced) {
        this.fruits[i] = this.fruits[this.fruits.length - 1];
        this.fruits.pop();
        this._free.push(f);
      }
    }
    return n;
  }

  _hit(f, angle) {
    if (f.kind === Kind.BOMB) {
      this.bombsHit++;
      this.lives--;
      this.comboCount = 0;
      this.comboTimer = 0;
      this.events.push({ type: "bomb", x: f.x, y: f.y, r: f.r, lives: this.lives });
      if (this.lives <= 0) this._gameOver("bomb");
      return;
    }
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = rules.comboWindow;
    if (this.comboCount > this.maxCombo) this.maxCombo = this.comboCount;
    const bonus = this.comboCount >= 2 ? Math.min(rules.comboBonusCap, (this.comboCount - 1) * rules.comboBonusStep) : 0;
    const type = f.type;
    this.score += type.points + bonus;
    this.sliced++;
    this._resolveWave(f, true);
    this.events.push({
      type: "slice", x: f.x, y: f.y, r: f.r, typeId: type.id, angle,
      vx: f.vx, vy: f.vy, rot: f.rot, vr: f.vr,
      points: type.points, bonus, combo: this.comboCount, score: this.score
    });
    if (this.comboCount >= 2) this.events.push({ type: "combo", x: f.x, y: f.y, count: this.comboCount, bonus });
    if (this.sliced % rules.extraLifeEvery === 0 && this.lives < rules.maxLives) {
      this.lives++;
      this.events.push({ type: "life", lives: this.lives, x: f.x, y: f.y });
    }
  }

  _miss(f) {
    this.missed++;
    this.lives--;
    this.comboCount = 0;
    this.comboTimer = 0;
    this._resolveWave(f, false);
    this.events.push({ type: "miss", x: clamp(f.x, 30 * this.scale, this.w - 30 * this.scale), y: this.h, lives: this.lives });
    if (this.lives <= 0) this._gameOver("miss");
  }

  _gameOver(reason) {
    if (this.status === Status.OVER) return;
    this.status = Status.OVER;
    this._queue.length = 0;
    this.events.push({ type: "over", reason, score: this.score });
  }

  _resolveWave(f, sliced) {
    const ws = this._waves[f.wave % WAVE_RING];
    if (!ws || ws.id !== f.wave) return;
    ws.resolved++;
    if (sliced) ws.sliced++;
    if (ws.resolved === ws.total && ws.sliced === ws.total && ws.total >= 3) {
      this.perfects++;
      this.score += rules.perfectWaveBonus;
      this.events.push({ type: "perfect", x: f.x, y: f.y, bonus: rules.perfectWaveBonus, score: this.score });
    }
  }

  // ---------------- spawning ----------------
  _interval() {
    const L = this.level;
    const base = Math.max(0.62, 1.55 - L * 0.075);
    return base * (0.85 + this.rng() * 0.35);
  }

  _pickType() {
    let r = this.rng() * TOTAL_WEIGHT;
    for (const t of FRUIT_TYPES) {
      r -= t.weight;
      if (r <= 0) return t;
    }
    return FRUIT_TYPES[0];
  }

  _bombsAlive() {
    let n = 0;
    for (const f of this.fruits) if (f.kind === Kind.BOMB && !f.sliced) n++;
    for (const q of this._queue) if (q.bomb) n++;
    return n;
  }

  _makeWave() {
    const L = this.level, rng = this.rng, w = this.w;
    const id = ++this._waveSeq;
    this._waveCount++;
    this._sinceFrenzy++;

    const frenzy = L >= 2 && this._sinceFrenzy >= 8 && rng() < 0.4;
    let n;
    if (frenzy) n = 6 + ((rng() * 3) | 0);
    else if (this._waveCount <= 2) n = 1;
    else n = 1 + ((rng() * Math.min(5, 2 + (L >> 1))) | 0);

    let pattern = "scatter";
    if (frenzy) { pattern = "fan"; this._sinceFrenzy = 0; this.events.push({ type: "frenzy" }); }
    else if (n === 2 && rng() < 0.35) pattern = "cross";
    else if (n >= 3 && rng() < 0.2) pattern = "fan";

    // Bombs: never early, never excessive, never an all-bomb wave, at most 2 on screen.
    const bombs = new Array(n).fill(false);
    if (!frenzy && L >= 1 && n >= 2) {
      const p = Math.min(0.2, 0.05 + 0.012 * L);
      const maxBombs = L >= 8 && n >= 4 ? 2 : 1;
      let placed = 0;
      for (let i = 0; i < n && placed < maxBombs; i++) {
        if (n - placed > 1 && rng() < p && this._bombsAlive() + placed < 2) { bombs[i] = true; placed++; }
      }
    }

    const total = bombs.filter((b) => !b).length;
    const ws = this._waves[id % WAVE_RING];
    ws.id = id; ws.total = total; ws.sliced = 0; ws.resolved = 0;

    const fanSpread = w * (frenzy ? 0.1 : 0.13);
    const fanX = w * (0.32 + rng() * 0.36);
    const fanApex = frenzy ? 0.62 + rng() * 0.18 : 0.58 + rng() * 0.2;
    for (let i = 0; i < n; i++) {
      const bomb = bombs[i];
      let x0, xa, apex, delay;
      if (pattern === "cross") {
        const left = i === 0;
        x0 = w * (left ? 0.1 : 0.9);
        xa = w * (left ? 0.58 : 0.42) + (rng() - 0.5) * w * 0.08;
        apex = 0.6 + rng() * 0.22;
        delay = i * 0.1;
      } else if (pattern === "fan") {
        x0 = fanX + (rng() - 0.5) * 40;
        xa = fanX + (i - (n - 1) / 2) * fanSpread;
        apex = fanApex + (rng() - 0.5) * 0.08;
        delay = i * (frenzy ? 0.09 : 0.05);
      } else {
        x0 = w * (0.12 + rng() * 0.76);
        xa = w * (0.15 + rng() * 0.7);
        apex = 0.54 + rng() * 0.3;
        delay = i * (0.12 + rng() * 0.18);
      }
      this._queue.push({ bomb, type: bomb ? BOMB : this._pickType(), x0, xa, apex, delay, wave: id });
    }
  }

  _launch(q) {
    const f = this._free.pop() || {};
    const r = q.type.r * this.scale;
    const g = this.h * (2.3 + this.level * 0.045);
    const y0 = this.h + r * 1.3;
    let xa = q.xa;
    const margin = r * 1.4;
    let apexY = this.h * (1 - q.apex);

    // Keep high arcs out from behind the camera preview.
    const s = this.safe;
    if (s && apexY < s.y + s.h + r && xa < s.x + s.w + r * 1.5) xa = Math.min(this.w - margin, s.x + s.w + r * 1.5 + this.rng() * this.w * 0.1);
    xa = clamp(xa, margin, this.w - margin);

    const vy = -Math.sqrt(2 * g * (y0 - apexY));
    const tApex = -vy / g;
    f.kind = q.bomb ? Kind.BOMB : Kind.FRUIT;
    f.type = q.type;
    f.r = r;
    f.g = g;
    f.x = clamp(q.x0, margin, this.w - margin);
    f.y = y0;
    f.vx = (xa - f.x) / tApex;
    f.vy = vy;
    f.rot = this.rng() * Math.PI * 2;
    f.vr = (this.rng() < 0.5 ? -1 : 1) * (1.5 + this.rng() * 4);
    f.age = 0;
    f.sliced = false;
    f.wave = q.wave;
    this.fruits.push(f);
    return f;
  }
}
