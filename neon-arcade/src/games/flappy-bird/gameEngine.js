// Pure game logic: no DOM, no canvas. Delta-time based so physics is frame-rate independent.
import { physics as P } from "./config.js";

export const Status = Object.freeze({ READY: "ready", PLAYING: "playing", DEAD: "dead" });

export class FlappyEngine {
  constructor(width, rng = Math.random) {
    this.rng = rng;
    this.width = width;
    this.reset();
  }

  setWidth(width) {
    this.width = width;
    this.bird.x = width * P.birdX;
  }

  reset() {
    this.status = Status.READY;
    this.score = 0;
    this.time = 0;
    this.scroll = 0;
    this.jumpQueued = false;
    this.bird = { x: this.width * P.birdX, y: P.worldHeight * 0.45, vy: 0, rotation: 0, flap: 0 };
    this.pipes = [];
    this.events = []; // drained by the renderer: "jump", "score", "hit"
    this.nextPipeX = this.width + 80;
    while (this.nextPipeX < this.width * 2) this._spawnPipe();
  }

  get groundY() {
    return P.worldHeight - P.groundHeight;
  }

  jump() {
    if (this.status === Status.DEAD) return;
    this.jumpQueued = true;
  }

  _spawnPipe() {
    const min = P.gapMargin + P.pipeGap / 2;
    const max = this.groundY - P.gapMargin - P.pipeGap / 2;
    const gapY = min + this.rng() * (max - min);
    this.pipes.push({ x: this.nextPipeX, gapY, scored: false });
    this.nextPipeX += P.pipeSpacing;
  }

  update(rawDt) {
    const dt = Math.min(Math.max(rawDt, 0), P.maxDt);
    this.time += dt;
    const b = this.bird;

    if (this.status === Status.DEAD) {
      // Bird keeps falling to the ground after a hit.
      b.vy = Math.min(b.vy + P.gravity * dt, P.maxFallSpeed);
      b.y = Math.min(b.y + b.vy * dt, this.groundY - P.birdRadius);
      b.rotation = Math.min(b.rotation + 6 * dt, Math.PI / 2);
      return;
    }

    if (this.jumpQueued) {
      this.jumpQueued = false;
      b.vy = P.jumpVelocity;
      b.flap = 1;
      this.events.push({ type: "jump", x: b.x, y: b.y });
      if (this.status === Status.READY) this.status = Status.PLAYING;
    }
    b.flap = Math.max(0, b.flap - dt * 4);

    if (this.status === Status.READY) {
      // Gentle hover until the first jump so the player is never killed before they start.
      b.y = P.worldHeight * 0.45 + Math.sin(this.time * 3.2) * 6;
      this.scroll += P.pipeSpeed * 0.4 * dt;
      b.rotation = Math.sin(this.time * 3.2) * 0.08;
      return;
    }

    b.vy = Math.min(b.vy + P.gravity * dt, P.maxFallSpeed);
    b.y += b.vy * dt;
    b.rotation = Math.max(-0.5, Math.min(1.2, b.vy / 520));

    const dx = P.pipeSpeed * dt;
    this.scroll += dx;
    for (const pipe of this.pipes) pipe.x -= dx;
    this.nextPipeX -= dx;
    while (this.pipes.length && this.pipes[0].x + P.pipeWidth < -20) this.pipes.shift();
    while (this.nextPipeX < this.width + P.pipeSpacing) this._spawnPipe();

    for (const pipe of this.pipes) {
      if (!pipe.scored && pipe.x + P.pipeWidth < b.x - P.birdRadius) {
        pipe.scored = true;
        this.score += 1;
        this.events.push({ type: "score", score: this.score });
      }
    }

    if (this._collides()) this._die();
  }

  _collides() {
    const b = this.bird;
    const r = P.birdRadius * 0.85; // slightly forgiving hitbox
    if (b.y + r >= this.groundY || b.y - r <= 0) return true;
    for (const pipe of this.pipes) {
      if (b.x + r > pipe.x && b.x - r < pipe.x + P.pipeWidth) {
        const top = pipe.gapY - P.pipeGap / 2;
        const bottom = pipe.gapY + P.pipeGap / 2;
        if (b.y - r < top || b.y + r > bottom) return true;
      }
    }
    return false;
  }

  _die() {
    this.status = Status.DEAD;
    this.bird.vy = Math.max(this.bird.vy, 0);
    this.events.push({ type: "hit", x: this.bird.x, y: this.bird.y });
  }
}
