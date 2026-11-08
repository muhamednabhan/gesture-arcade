// Canvas renderer: neon backdrop, fruit, cut halves, juice, splats, popups and the slash trail.
// Performance notes: DPR is capped (and drops further if frames run long), all artwork is pre-rendered into
// sprites, particles live in typed arrays, pools are reused, and no per-frame shadowBlur is used for the
// playfield (glow comes from baked sprites and additive blending).
import { buildSprites, glowSprite, HALF_OFFSET, bombFuseTip } from "./fruitSprites.js";
import { TYPE_BY_ID } from "./fruitTypes.js";
import { Kind, scaleFor } from "./fruitEngine.js";

const PI = Math.PI;
const TAU = PI * 2;
const TRAIL_MAX = 28;
const TRAIL_LIFE = 0.24; // seconds a trail point stays visible
const P_HI = 340, P_LO = 160;
const HALF_MAX = 28, SPLAT_MAX = 10, POP_MAX = 14, FLASH_MAX = 10;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FruitRenderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.reduced = reducedMotion;
    this.dprCap = 1.5;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.scale = 1;
    this.sprites = null;
    this.bg = null;
    this.dirty = true;
    this.resizedAt = 0;
    this.clock = 0;
    this.slowFrames = 0;
    this.frameEma = 1 / 60;
    this.pmax = P_HI;

    // particles (structure of arrays)
    this.pn = 0;
    this.px = new Float32Array(P_HI); this.py = new Float32Array(P_HI);
    this.pvx = new Float32Array(P_HI); this.pvy = new Float32Array(P_HI);
    this.pl = new Float32Array(P_HI); this.pm = new Float32Array(P_HI);
    this.ps = new Float32Array(P_HI);
    this.pk = new Uint8Array(P_HI);        // 0 = juice drop, 1 = cyan spark, 2 = pink spark
    this.pc = new Uint8Array(P_HI);        // juice colour index
    this.colorKeys = [];

    // trail ring buffer
    this.tx = new Float32Array(TRAIL_MAX); this.ty = new Float32Array(TRAIL_MAX);
    this.tt = new Float32Array(TRAIL_MAX); this.tb = new Uint8Array(TRAIL_MAX);
    this.thead = 0; this.tcount = 0;

    this.halves = [];
    this.halfFree = [];
    this.splats = [];
    this.popups = [];
    this.flashes = [];
    this.shake = 0;
    this.shx = 0; this.shy = 0;
    this.screenFlash = 0;
    this.screenFlashColor = "255,42,74";
    this.cursor = { x: 0, y: 0, visible: false };

    this.orbs = [glowSprite(128, "#27f4ff"), glowSprite(128, "#ff3ccf"), glowSprite(128, "#ff9a2e")];
    const rnd = mulberry(77);
    this.dust = Array.from({ length: 30 }, () => ({ x: rnd(), y: rnd(), s: 0.4 + rnd() * 1.4, v: 0.01 + rnd() * 0.03, c: rnd() }));
  }

  // ------------------------------------------------------------------ layout
  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.scale = scaleFor(w, h);
    this.dirty = true;
    this.resizedAt = performance.now();
    if (!this.sprites) this._rebuild(); // first frame needs art right away; later resizes are debounced
    return { w, h, scale: this.scale };
  }

  _rebuild() {
    const k = this.scale * this.dpr;
    if (!this.sprites || Math.abs(this.sprites.k - k) / this.sprites.k > 0.03 || this.sprites.dpr !== this.dpr) {
      this.sprites = buildSprites(k, this.dpr);
      this.colorKeys = Object.keys(this.sprites.drop);
    }
    this.bg = this._buildBackground();
    this.dirty = false;
  }

  _buildBackground() {
    const { w, h, dpr } = this;
    const c = this.bg && this.bg.width === Math.round(w * dpr) && this.bg.height === Math.round(h * dpr) ? this.bg : document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry(2026);
    const horizon = h * 0.84;

    let grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#03010a");
    grad.addColorStop(0.5, "#0b0420");
    grad.addColorStop(1, "#1e0a3c");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // stars
    for (let i = 0; i < 80; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.5;
      g.fillStyle = rnd() < 0.2 ? "#ff9ae8" : rnd() < 0.5 ? "#9ef6ff" : "#ffffff";
      const s = rnd() < 0.15 ? 2 : 1;
      g.fillRect(rnd() * w, rnd() * horizon * 0.8, s, s);
    }
    g.globalAlpha = 1;

    // synthwave sun with slits, dim so fruit stays the brightest thing on screen
    const sr = Math.min(h * 0.26, w * 0.2), sx = w * 0.5, sy = horizon - sr * 0.55;
    g.save();
    g.beginPath();
    g.arc(sx, sy, sr, 0, TAU);
    g.clip();
    grad = g.createLinearGradient(0, sy - sr, 0, sy + sr);
    grad.addColorStop(0, "rgba(255,60,166,.55)");
    grad.addColorStop(1, "rgba(255,154,46,.5)");
    g.fillStyle = grad;
    g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    g.fillStyle = "#0b0420";
    for (let i = 0; i < 7; i++) {
      const y = sy + sr * (-0.05 + i * 0.16), th = 1.5 + i * 1.3;
      g.fillRect(sx - sr, y, sr * 2, th);
    }
    g.restore();

    // skyline: two parallax layers with lit windows and neon roof lines
    const layer = (base, hMin, hMax, body, edgeAlpha, winAlpha) => {
      let x = -10;
      while (x < w + 10) {
        const bw = w * (0.035 + rnd() * 0.045), bh = h * (hMin + rnd() * (hMax - hMin));
        g.fillStyle = body;
        g.fillRect(x, base - bh, bw, bh + 2);
        if (rnd() < 0.55) {
          g.fillStyle = rnd() < 0.5 ? `rgba(39,244,255,${edgeAlpha})` : `rgba(255,60,204,${edgeAlpha})`;
          g.fillRect(x, base - bh, bw, 1.5);
        }
        const cols = Math.max(2, Math.floor(bw / 9)), rows = Math.floor(bh / 12);
        for (let r = 0; r < rows; r++) {
          for (let cc = 0; cc < cols; cc++) {
            if (rnd() < 0.2) {
              const pick = rnd();
              g.fillStyle = pick < 0.45 ? `rgba(39,244,255,${winAlpha})` : pick < 0.8 ? `rgba(255,60,204,${winAlpha})` : `rgba(255,170,60,${winAlpha})`;
              g.fillRect(x + 3 + cc * ((bw - 6) / cols), base - bh + 6 + r * 12, 3, 4);
            }
          }
        }
        x += bw + w * 0.004;
      }
    };
    layer(horizon, 0.1, 0.3, "#140832", 0.35, 0.28);
    layer(horizon + 4, 0.05, 0.2, "#0a031a", 0.55, 0.45);

    // floor
    grad = g.createLinearGradient(0, horizon, 0, h);
    grad.addColorStop(0, "#1a0838");
    grad.addColorStop(1, "#05010d");
    g.fillStyle = grad;
    g.fillRect(0, horizon + 4, w, h - horizon);
    g.strokeStyle = "rgba(167,80,255,.35)";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = -14; i <= 14; i++) {
      g.moveTo(w / 2 + i * w * 0.012, horizon + 4);
      g.lineTo(w / 2 + i * w * 0.14, h);
    }
    g.stroke();
    g.fillStyle = "rgba(39,244,255,.8)"; // horizon line
    g.fillRect(0, horizon + 3, w, 1.5);

    // vignette
    grad = g.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.72);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,.6)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return c;
  }

  // ------------------------------------------------------------------ trail / cursor
  addTrailPoint(x, y, breakBefore = false) {
    const i = (this.thead + this.tcount) % TRAIL_MAX;
    if (this.tcount < TRAIL_MAX) this.tcount++;
    else this.thead = (this.thead + 1) % TRAIL_MAX;
    this.tx[i] = x; this.ty[i] = y; this.tt[i] = this.clock; this.tb[i] = breakBefore ? 1 : 0;
  }

  clearTrail() {
    this.tcount = 0;
    this.thead = 0;
  }

  setCursor(x, y, visible) {
    this.cursor.x = x;
    this.cursor.y = y;
    this.cursor.visible = visible;
  }

  // ------------------------------------------------------------------ effects
  clearEffects() {
    this.pn = 0;
    for (const h of this.halves) this.halfFree.push(h);
    this.halves.length = 0;
    this.splats.length = 0;
    this.popups.length = 0;
    this.flashes.length = 0;
    this.shake = 0;
    this.screenFlash = 0;
    this.clearTrail();
  }

  _particle(x, y, vx, vy, life, size, kind, color) {
    if (this.pn >= this.pmax) return;
    const i = this.pn++;
    this.px[i] = x; this.py[i] = y; this.pvx[i] = vx; this.pvy[i] = vy;
    this.pl[i] = life; this.pm[i] = life; this.ps[i] = size; this.pk[i] = kind;
    this.pc[i] = color;
  }

  _colorIndex(color) {
    const i = this.colorKeys.indexOf(color);
    return i < 0 ? 0 : i;
  }

  _juice(x, y, color, angle, count, speed) {
    const ci = this._colorIndex(color), s = this.scale;
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const sp = speed * (0.35 + Math.random() * 0.9);
      const spread = (Math.random() - 0.5) * 1.2;
      const vx = (nx * side + Math.cos(angle) * spread) * sp;
      const vy = (ny * side + Math.sin(angle) * spread) * sp - 70 * s;
      this._particle(x, y, vx, vy, 0.5 + Math.random() * 0.55, (4 + Math.random() * 7) * s, 0, ci);
    }
  }

  _sparks(x, y, count, speed, kind = 1) {
    const s = this.scale;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU, sp = speed * (0.3 + Math.random());
      this._particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.22 + Math.random() * 0.3, (5 + Math.random() * 6) * s, kind === 1 && Math.random() < 0.4 ? 2 : kind, 0);
    }
  }

  _pop(x, y, text, color, size, life = 0.8, kind = 0) {
    let p = this.popups.length < POP_MAX ? null : this.popups[0];
    if (!p) {
      p = {};
      this.popups.push(p);
    } else {
      this.popups.shift();
      this.popups.push(p);
    }
    p.x = x; p.y = y; p.vy = -50 * this.scale; p.life = life; p.max = life; p.text = text; p.color = color; p.size = size; p.kind = kind;
  }

  _halfPair(ev) {
    const a = ev.angle, nx = -Math.sin(a), ny = Math.cos(a), s = this.scale;
    for (const side of [1, -1]) {
      if (this.halves.length >= HALF_MAX) break;
      const h = this.halfFree.pop() || {};
      const off = ev.r * HALF_OFFSET;
      const sp = (110 + Math.random() * 90) * s;
      h.x = ev.x + side * nx * off;
      h.y = ev.y + side * ny * off;
      h.vx = ev.vx * 0.6 + side * nx * sp;
      h.vy = ev.vy * 0.45 + side * ny * sp - 40 * s;
      h.rot = side > 0 ? a - PI / 2 : a + PI / 2;
      h.vr = ev.vr * 0.5 + side * (1.2 + Math.random() * 2.2);
      h.typeId = ev.typeId;
      h.g = this.h * 2.3;
      this.halves.push(h);
    }
  }

  handleEvent(ev) {
    const s = this.scale, calm = this.reduced;
    switch (ev.type) {
      case "slice": {
        const t = TYPE_BY_ID[ev.typeId];
        this._halfPair(ev);
        this._juice(ev.x, ev.y, t.juice, ev.angle, calm ? 8 : 20, 330 * s);
        this._sparks(ev.x, ev.y, calm ? 3 : 8, 300 * s);
        if (this.splats.length >= SPLAT_MAX) this.splats.shift();
        this.splats.push({ x: ev.x, y: ev.y, rot: Math.random() * TAU, sc: (0.8 + Math.random() * 0.5) * (ev.r / (46 * s)) * 0.9 + 0.3, life: 1.5, max: 1.5, color: t.juice, v: Math.random() < 0.5 ? 0 : 1 });
        if (this.flashes.length >= FLASH_MAX) this.flashes.shift();
        this.flashes.push({ x: ev.x, y: ev.y, a: ev.angle, r: ev.r, life: 0.2, max: 0.2 });
        this._pop(ev.x, ev.y - ev.r * 0.35, `+${ev.points + ev.bonus}`, "#ffffff", 22 * s + 4);
        break;
      }
      case "combo":
        this._pop(ev.x, ev.y - 52 * s, `COMBO ×${ev.count}`, ev.count >= 4 ? "#ffb02e" : "#ff4fd8", (22 + Math.min(ev.count, 6) * 2.5) * s + 3, 1.05);
        break;
      case "bomb":
        this._sparks(ev.x, ev.y, calm ? 18 : 46, 520 * s, 1);
        this._sparks(ev.x, ev.y, calm ? 8 : 20, 380 * s, 2);
        this.screenFlash = calm ? 0.35 : 0.7;
        this.screenFlashColor = "255,42,74";
        if (!calm) this.shake = 16 * s;
        this._pop(ev.x, ev.y, "BOMB!", "#ff3355", 32 * s + 4, 1.0);
        break;
      case "miss":
        this._pop(ev.x, ev.y - 34 * s, "✕", "#ff3355", 42 * s + 6, 0.9, 1);
        this.screenFlash = Math.max(this.screenFlash, 0.22);
        this.screenFlashColor = "255,42,74";
        break;
      case "perfect":
        this._pop(this.w / 2, this.h * 0.36, `PERFECT WAVE  +${ev.bonus}`, "#caff32", 28 * s + 4, 1.3);
        this._sparks(this.w / 2, this.h * 0.36, calm ? 6 : 18, 360 * s, 2);
        break;
      case "life":
        this._pop(this.w / 2, this.h * 0.5, "+1 LIFE", "#7dff9a", 30 * s + 4, 1.2);
        break;
      case "frenzy":
        this._pop(this.w / 2, this.h * 0.24, "FRUIT FRENZY!", "#27f4ff", 34 * s + 4, 1.4);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ simulation of visuals
  update(dt) {
    this.clock += dt;
    // Quality governor: if frames run long for ~2 seconds, trade resolution + particle count for speed.
    this.frameEma += (dt - this.frameEma) * 0.05;
    if (this.dprCap > 1 && this.frameEma > 0.026) {
      if (++this.slowFrames > 120) {
        this.dprCap = 1;
        this.pmax = P_LO;
        this.pn = Math.min(this.pn, this.pmax);
        this.resize(this.w, this.h);
        this.slowFrames = 0;
      }
    } else this.slowFrames = Math.max(0, this.slowFrames - 2);

    const g = this.h * 1.6;
    for (let i = this.pn - 1; i >= 0; i--) {
      this.pl[i] -= dt;
      if (this.pl[i] <= 0) {
        const last = --this.pn;
        if (i !== last) {
          this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pvx[i] = this.pvx[last]; this.pvy[i] = this.pvy[last];
          this.pl[i] = this.pl[last]; this.pm[i] = this.pm[last]; this.ps[i] = this.ps[last]; this.pk[i] = this.pk[last]; this.pc[i] = this.pc[last];
        }
        continue;
      }
      if (this.pk[i] === 0) this.pvy[i] += g * dt;
      const drag = 1 - dt * (this.pk[i] === 0 ? 0.5 : 2.2);
      this.pvx[i] *= drag;
      this.pvy[i] *= this.pk[i] === 0 ? 1 : drag;
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
    }

    for (let i = this.halves.length - 1; i >= 0; i--) {
      const h = this.halves[i];
      h.vy += h.g * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
      if (h.y > this.h + 120 * this.scale) {
        this.halves[i] = this.halves[this.halves.length - 1];
        this.halves.pop();
        this.halfFree.push(h);
      }
    }
    for (let i = this.splats.length - 1; i >= 0; i--) if ((this.splats[i].life -= dt) <= 0) this.splats.splice(i, 1);
    for (let i = this.flashes.length - 1; i >= 0; i--) if ((this.flashes[i].life -= dt) <= 0) this.flashes.splice(i, 1);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 1.5;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    if (this.shake > 0.1) {
      this.shake *= Math.max(0, 1 - dt * 9);
      this.shx = (Math.random() - 0.5) * this.shake;
      this.shy = (Math.random() - 0.5) * this.shake;
    } else this.shx = this.shy = this.shake = 0;
    if (this.screenFlash > 0) this.screenFlash = Math.max(0, this.screenFlash - dt * 2.2);
  }

  // ------------------------------------------------------------------ drawing
  render(engine, now) {
    if (this.dirty && (!this.bg || now - this.resizedAt > 160)) this._rebuild();
    const ctx = this.ctx, dpr = this.dpr, w = this.w, h = this.h;
    if (!this.sprites || !w) return;
    const sp = this.sprites;
    const t = this.reduced ? 0 : now / 1000;
    const sx = this.shx, sy = this.shy;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.bg, 0, 0, w, h);

    this._drawAmbient(ctx, t);

    // splats sit behind the fruit
    for (const s of this.splats) {
      const sprite = sp.splat[s.color][s.v];
      const size = (sprite.width / dpr) * s.sc;
      ctx.globalAlpha = Math.min(0.5, (s.life / s.max) * 0.7);
      const c = Math.cos(s.rot) * dpr, n = Math.sin(s.rot) * dpr;
      ctx.setTransform(c, n, -n, c, (s.x + sx) * dpr, (s.y + sy) * dpr);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // targets
    if (engine) {
      for (const f of engine.fruits) {
        const bomb = f.kind === Kind.BOMB;
        const c = Math.cos(f.rot) * dpr, n = Math.sin(f.rot) * dpr;
        const info = bomb ? sp.size.bomb : sp.size[f.type.id];
        const px = f.x + sx, py = f.y + sy;
        if (bomb) { // pulsing danger ring (unrotated)
          ctx.setTransform(dpr, 0, 0, dpr, px * dpr, py * dpr);
          ctx.strokeStyle = `rgba(255,42,74,${0.35 + 0.25 * Math.sin(t * 9)})`;
          ctx.lineWidth = 2.5 * this.scale;
          ctx.beginPath();
          ctx.arc(0, 0, f.r * (1.28 + 0.06 * Math.sin(t * 9)), 0, TAU);
          ctx.stroke();
        }
        ctx.setTransform(c, n, -n, c, px * dpr, py * dpr);
        ctx.drawImage(bomb ? sp.bomb : sp.whole[f.type.id], -info.css / 2, -info.css / 2, info.css, info.css);
        if (bomb) {
          const tip = bombFuseTip(info.R / dpr), fl = 1 + 0.3 * Math.sin(t * 38 + f.rot * 3), fs = sp.fuseCss * fl;
          ctx.globalCompositeOperation = "lighter";
          ctx.drawImage(sp.fuse, tip.x - fs / 2, tip.y - fs / 2, fs, fs);
          ctx.globalCompositeOperation = "source-over";
        }
      }
    }

    // halves
    for (const hf of this.halves) {
      const info = sp.size[hf.typeId];
      const c = Math.cos(hf.rot) * dpr, n = Math.sin(hf.rot) * dpr;
      ctx.setTransform(c, n, -n, c, (hf.x + sx) * dpr, (hf.y + sy) * dpr);
      ctx.drawImage(sp.half[hf.typeId], -info.css / 2, -info.css / 2, info.css, info.css);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // slice flashes
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.flashes) {
      const k = f.life / f.max, len = f.r * (2.6 + (1 - k) * 1.4);
      ctx.save();
      ctx.translate(f.x + sx, f.y + sy);
      ctx.rotate(f.a);
      ctx.globalAlpha = k;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.quadraticCurveTo(0, -f.r * 0.1 * k - 1, len, 0);
      ctx.quadraticCurveTo(0, f.r * 0.1 * k + 1, -len, 0);
      ctx.fill();
      ctx.restore();
      const gs = f.r * (1.6 + (1 - k)) * 2;
      ctx.drawImage(sp.spark, f.x + sx - gs / 2, f.y + sy - gs / 2, gs, gs);
    }
    ctx.globalAlpha = 1;

    // particles: juice (normal blend) then sparks (additive)
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < this.pn; i++) {
      if (this.pk[i] !== 0) continue;
      const a = Math.min(1, (this.pl[i] / this.pm[i]) * 1.8), s = this.ps[i] * (0.6 + 0.4 * a);
      ctx.globalAlpha = a;
      ctx.drawImage(sp.drop[this.colorKeys[this.pc[i]]], this.px[i] + sx - s / 2, this.py[i] + sy - s / 2, s, s);
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.pn; i++) {
      if (this.pk[i] === 0) continue;
      const a = this.pl[i] / this.pm[i], s = this.ps[i] * (0.5 + a);
      ctx.globalAlpha = a;
      ctx.drawImage(this.pk[i] === 2 ? sp.sparkPink : sp.spark, this.px[i] + sx - s / 2, this.py[i] + sy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    this._drawTrail(ctx, sp, sx, sy);
    ctx.globalCompositeOperation = "source-over";
    this._drawPopups(ctx);

    if (this.screenFlash > 0) {
      ctx.fillStyle = `rgba(${this.screenFlashColor},${this.screenFlash * 0.45})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  _drawAmbient(ctx, t) {
    const { w, h } = this;
    // drifting colour orbs
    ctx.globalCompositeOperation = "lighter";
    const orb = (img, cx, cy, r, a) => {
      ctx.globalAlpha = a;
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    };
    orb(this.orbs[0], w * (0.2 + 0.05 * Math.sin(t * 0.25)), h * (0.3 + 0.04 * Math.cos(t * 0.31)), h * 0.5, 0.16);
    orb(this.orbs[1], w * (0.8 + 0.05 * Math.cos(t * 0.22)), h * (0.35 + 0.04 * Math.sin(t * 0.27)), h * 0.55, 0.15);
    orb(this.orbs[2], w * 0.5, h * 0.86, h * 0.45, 0.1 + 0.03 * Math.sin(t * 0.9));

    // floor grid lines rolling toward the viewer
    const horizon = h * 0.84 + 4;
    ctx.strokeStyle = "#b45cff";
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const p = (i / 7 + t * 0.12) % 1, depth = p * p;
      ctx.globalAlpha = 0.12 + depth * 0.3;
      const y = horizon + (h - horizon) * depth;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // data dust
    ctx.globalAlpha = 0.5;
    for (const d of this.dust) {
      const y = ((d.y - t * d.v) % 1 + 1) % 1;
      ctx.fillStyle = d.c < 0.5 ? "#27f4ff" : "#ff4fd8";
      ctx.fillRect(d.x * w, y * h * 0.85, d.s, d.s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  _drawTrail(ctx, sp, sx, sy) {
    const n = this.tcount;
    const s = this.scale;
    let drew = false;
    if (n > 1) {
      // collect alive points (oldest -> newest)
      const idx = this._ti || (this._ti = new Int16Array(TRAIL_MAX));
      let m = 0;
      for (let k = 0; k < n; k++) {
        const i = (this.thead + k) % TRAIL_MAX;
        if (this.clock - this.tt[i] < TRAIL_LIFE) idx[m++] = i;
      }
      if (m > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = "lighter";
        const passes = [
          ["rgba(255,60,200,0.30)", 3.6],
          ["rgba(39,244,255,0.78)", 1.7],
          ["rgba(255,255,255,0.98)", 0.62]
        ];
        for (const [color, mul] of passes) {
          ctx.strokeStyle = color;
          for (let k = 1; k < m; k++) {
            const i0 = idx[k - 1], i1 = idx[k];
            if (this.tb[i1]) continue; // a break: never connect across a jump or a lost hand
            const age = (this.clock - this.tt[i1]) / TRAIL_LIFE;
            const wd = Math.max(0.6, 11 * s * (1 - age) * mul);
            ctx.lineWidth = wd;
            ctx.beginPath();
            const prev = k > 1 && !this.tb[i0] ? idx[k - 2] : i0;
            const next = k < m - 1 && !this.tb[idx[k + 1]] ? idx[k + 1] : i1;
            ctx.moveTo((this.tx[prev] + this.tx[i0]) / 2 + sx, (this.ty[prev] + this.ty[i0]) / 2 + sy);
            ctx.quadraticCurveTo(this.tx[i0] + sx, this.ty[i0] + sy, (this.tx[i0] + this.tx[i1]) / 2 + sx, (this.ty[i0] + this.ty[i1]) / 2 + sy);
            ctx.quadraticCurveTo(this.tx[i1] + sx, this.ty[i1] + sy, (this.tx[i1] + this.tx[next]) / 2 + sx, (this.ty[i1] + this.ty[next]) / 2 + sy);
            ctx.stroke();
            drew = true;
          }
        }
      }
    }
    const c = this.cursor;
    if (c.visible) {
      ctx.globalCompositeOperation = "lighter";
      const gs = (drew ? 40 : 34) * s;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(sp.spark, c.x + sx - gs / 2, c.y + sy - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(c.x + sx, c.y + sy, 3.2 * s + 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawPopups(ctx) {
    for (const p of this.popups) {
      const k = p.life / p.max, a = Math.min(1, k * 2.2);
      const pop = 1 + Math.max(0, k - 0.82) * 2.2; // quick scale-in
      ctx.globalAlpha = a;
      if (p.kind === 1) { // miss mark
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(pop, pop);
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(10,2,30,.9)";
        const r = p.size * 0.38;
        ctx.lineWidth = p.size * 0.3;
        ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(r, -r); ctx.lineTo(-r, r); ctx.stroke();
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.size * 0.5;
        ctx.lineWidth = p.size * 0.17;
        ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(r, -r); ctx.lineTo(-r, r); ctx.stroke();
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(pop, pop);
      ctx.font = `900 ${Math.round(p.size)}px Orbitron, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = p.size * 0.2;
      ctx.strokeStyle = "rgba(10,2,30,.92)";
      ctx.strokeText(p.text, 0, 0);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 0.55;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  dispose() {
    this.sprites = null;
    this.bg = null;
    this.halves.length = 0;
    this.halfFree.length = 0;
    this.splats.length = 0;
    this.popups.length = 0;
    this.flashes.length = 0;
    this.canvas.width = this.canvas.height = 0; // release the backing store
  }
}
