// Canvas renderer for Blink Bird. Reads engine state; owns only visuals (scenery, particles).
import { physics as P } from "./config.js";

const TAU = Math.PI * 2;

// Deterministic skyline so it never flickers between frames or restarts.
function makeSkyline(seed, count, minH, maxH) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    const w = 26 + rnd() * 34;
    const h = minH + rnd() * (maxH - minH);
    const windows = [];
    for (let wy = 10; wy < h - 6; wy += 11) for (let wx = 5; wx < w - 6; wx += 9) if (rnd() > 0.55) windows.push([wx, wy, rnd() > 0.5]);
    out.push({ x, w, h, windows });
    x += w + 2 + rnd() * 6;
  }
  return { items: out, width: x };
}

export class FlappyRenderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.reducedMotion = reducedMotion;
    this.particles = [];
    this.shake = 0;
    this.far = makeSkyline(7, 22, 60, 150);
    this.near = makeSkyline(21, 18, 40, 110);
    this.stars = Array.from({ length: 46 }, (_, i) => ({ x: (i * 97.3) % 1, y: ((i * 53.7) % 1) * 0.6, r: 0.5 + ((i * 31) % 7) / 7 }));
    this.width = 400;
    this.scale = 1;
    this.blinkUntil = 0;
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.scale = cssH / P.worldHeight;
    this.dpr = dpr;
    this.width = cssW / this.scale;
    this._buildGradients();
    return this.width;
  }

  _buildGradients() {
    const c = this.ctx, H = P.worldHeight;
    this.sky = c.createLinearGradient(0, 0, 0, H);
    this.sky.addColorStop(0, "#07143f");
    this.sky.addColorStop(0.55, "#0a4b7d");
    this.sky.addColorStop(1, "#13b8d6");
  }

  burst(x, y, count, colors, speed = 140, life = 0.6) {
    if (this.reducedMotion) count = Math.ceil(count / 4);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU, v = speed * (0.3 + Math.random() * 0.9);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.6), max: life, size: 1.5 + Math.random() * 2.5, color: colors[(Math.random() * colors.length) | 0] });
    }
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
  }

  handleEvents(engine) {
    for (const ev of engine.events) {
      if (ev.type === "jump") {
        for (let i = 0; i < (this.reducedMotion ? 1 : 5); i++) {
          this.particles.push({ x: ev.x - 8, y: ev.y + 6, vx: -40 - Math.random() * 40, vy: 30 + Math.random() * 60, life: 0.4, max: 0.4, size: 2 + Math.random() * 2, color: i % 2 ? "#25eaff" : "#ff2acb" });
        }
      } else if (ev.type === "score") {
        this.burst(engine.bird.x, engine.bird.y, 14, ["#caff32", "#25eaff", "#fff"], 120, 0.5);
      } else if (ev.type === "hit") {
        this.burst(ev.x, ev.y, 34, ["#ff2acb", "#ffb52c", "#fff"], 260, 0.8);
        if (!this.reducedMotion) this.shake = 0.35;
      }
    }
    engine.events.length = 0;
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
    }
  }

  render(engine, now) {
    const c = this.ctx, W = this.width, H = P.worldHeight, gy = engine.groundY;
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    if (this.shake > 0) c.translate((Math.random() - 0.5) * this.shake * 14, (Math.random() - 0.5) * this.shake * 14);

    c.fillStyle = this.sky;
    c.fillRect(-20, -20, W + 40, H + 40);

    // Stars
    c.fillStyle = "#cdf8ff";
    for (const s of this.stars) {
      c.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(now / 900 + s.x * 20));
      c.fillRect(s.x * W, s.y * H, s.r, s.r);
    }
    c.globalAlpha = 1;

    // Moon glow
    const mg = c.createRadialGradient(W * 0.8, H * 0.2, 2, W * 0.8, H * 0.2, 70);
    mg.addColorStop(0, "rgba(255,120,230,.55)");
    mg.addColorStop(1, "rgba(255,120,230,0)");
    c.fillStyle = mg;
    c.fillRect(W * 0.8 - 70, H * 0.2 - 70, 140, 140);

    this._skyline(this.far, engine.scroll * 0.12, gy, "#14295f", "#25eaff", 0.35);
    this._skyline(this.near, engine.scroll * 0.3, gy, "#0b1442", "#ff2acb", 0.55);

    for (const pipe of engine.pipes) this._pipe(pipe, gy);
    this._ground(engine, W, H, gy);
    this._particles();
    this._bird(engine, now);
  }

  _skyline(layer, offset, gy, fill, windowColor, windowAlpha) {
    const c = this.ctx, span = layer.width;
    const start = -((offset % span) + span) % span;
    for (let rep = 0; start + rep * span < this.width + 80; rep++) {
      const ox = start + rep * span;
      for (const b of layer.items) {
        const x = ox + b.x;
        if (x > this.width + 4 || x + b.w < -4) continue;
        c.fillStyle = fill;
        c.fillRect(x, gy - b.h, b.w, b.h);
        c.fillStyle = windowColor;
        c.globalAlpha = windowAlpha;
        for (const [wx, wy, lit] of b.windows) if (lit) c.fillRect(x + wx, gy - b.h + wy, 4, 5);
        c.globalAlpha = 1;
      }
    }
  }

  _pipe(pipe, gy) {
    const c = this.ctx, w = P.pipeWidth, top = pipe.gapY - P.pipeGap / 2, bottom = pipe.gapY + P.pipeGap / 2;
    const g = c.createLinearGradient(pipe.x, 0, pipe.x + w, 0);
    g.addColorStop(0, "#0a5b83"); g.addColorStop(0.3, "#23f6ff"); g.addColorStop(0.65, "#087a9e"); g.addColorStop(1, "#052746");
    c.fillStyle = g;
    c.fillRect(pipe.x + 4, -10, w - 8, top + 10 - 20);
    c.fillRect(pipe.x + 4, bottom + 20, w - 8, gy - bottom - 20);
    c.fillRect(pipe.x, top - 20, w, 20);
    c.fillRect(pipe.x, bottom, w, 20);
    // Dimension: highlight + shadow edges and neon trim on the lips
    c.fillStyle = "rgba(255,255,255,.35)";
    c.fillRect(pipe.x + 10, -10, 3, top);
    c.fillRect(pipe.x + 10, bottom + 20, 3, gy - bottom - 20);
    c.fillStyle = "rgba(2,10,40,.35)";
    c.fillRect(pipe.x + w - 14, -10, 6, top);
    c.fillRect(pipe.x + w - 14, bottom + 20, 6, gy - bottom - 20);
    c.strokeStyle = "#ff2acb"; c.lineWidth = 2;
    c.strokeRect(pipe.x + 1, top - 19, w - 2, 18);
    c.strokeRect(pipe.x + 1, bottom + 1, w - 2, 18);
  }

  _ground(engine, W, H, gy) {
    const c = this.ctx;
    c.fillStyle = "#12072a";
    c.fillRect(-20, gy, W + 40, H - gy + 20);
    c.fillStyle = "#25eaff";
    c.fillRect(-20, gy, W + 40, 3);
    c.strokeStyle = "rgba(255,42,203,.55)"; c.lineWidth = 2;
    const step = 28, off = engine.scroll % step;
    c.beginPath();
    for (let x = -off; x < W + step; x += step) { c.moveTo(x, gy + 4); c.lineTo(x - 16, H); }
    c.stroke();
  }

  _particles() {
    const c = this.ctx;
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
  }

  _bird(engine, now) {
    const c = this.ctx, b = engine.bird, r = P.birdRadius;
    const eyeClosed = now < this.blinkUntil;
    c.save();
    c.translate(b.x, b.y);
    c.rotate(b.rotation);
    c.shadowColor = "#ffb52c"; c.shadowBlur = 14;
    const g = c.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#fff8a2"); g.addColorStop(0.5, "#ffb52c"); g.addColorStop(1, "#ff4e7a");
    c.fillStyle = g;
    c.beginPath(); c.ellipse(0, 0, r * 1.25, r, 0, 0, TAU); c.fill();
    c.shadowBlur = 0;
    // Beak
    c.fillStyle = "#ff3ca6";
    c.beginPath(); c.moveTo(r * 1.05, -2.5); c.lineTo(r * 1.9, 1); c.lineTo(r * 1.05, 4.5); c.closePath(); c.fill();
    // Wing (flaps on jump, idles slowly)
    const flap = engine.status === "dead" ? 0.2 : b.flap > 0 ? -0.9 * b.flap : Math.sin(now / 90) * 0.15;
    c.save(); c.translate(-r * 0.35, r * 0.15); c.rotate(flap);
    c.fillStyle = "#25eaff"; c.strokeStyle = "#bff8ff"; c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(-r * 0.35, 0, r * 0.85, r * 0.42, -0.3, 0, TAU); c.fill(); c.stroke();
    c.restore();
    // Eye (closes when the player blinks: instant visual feedback)
    c.fillStyle = "#fff";
    c.beginPath(); c.arc(r * 0.5, -r * 0.35, r * 0.4, 0, TAU); c.fill();
    if (eyeClosed) {
      c.strokeStyle = "#12062a"; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(r * 0.2, -r * 0.35); c.lineTo(r * 0.8, -r * 0.35); c.stroke();
    } else {
      c.fillStyle = "#12062a";
      c.beginPath(); c.arc(r * 0.6, -r * 0.35, r * 0.2, 0, TAU); c.fill();
    }
    c.restore();
  }
}
