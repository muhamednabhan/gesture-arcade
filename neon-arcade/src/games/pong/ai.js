// Pong AI. It tracks the predicted landing spot but, at random, deliberately misses a return.
// The miss chance is re-rolled per return from a random range (no fixed "miss every N" pattern) and rises
// after a long run of successful returns so a rally can never go on forever.
export function predictX(ball, targetY, w) {
  if (ball.vy === 0) return ball.x;
  const t = (targetY - ball.y) / ball.vy;
  if (t < 0) return ball.x;
  let x = ball.x + ball.vx * t;
  const span = w - 2 * ball.r;
  x = ((x - ball.r) % (2 * span) + 2 * span) % (2 * span);
  return (x > span ? 2 * span - x : x) + ball.r;
}

export class PongAI {
  constructor(rnd = Math.random, hard = false) { this.rnd = rnd; this.hard = hard; this.streak = 0; this.reset(); }
  reset() { this.willMiss = false; this.jitter = 0; this.missDir = 1; }
  /** Call each time the ball starts heading toward the AI. */
  plan() {
    // easy: 15–40 % per return; hard: 3–12 %. Re-rolled every time, never a fixed pattern.
    const base = this.hard ? 0.03 + this.rnd() * 0.09 : 0.15 + this.rnd() * 0.25;
    const p = this.streak >= (this.hard ? 9 : 4) ? Math.max(base, this.hard ? 0.6 : 0.75) : base;
    this.willMiss = this.rnd() < p;
    this.streak = this.willMiss ? 0 : this.streak + 1;
    this.jitter = (this.rnd() * 2 - 1) * (this.hard ? 0.7 : 0.3); // hard: aims for the edges to send sharp angles                // fraction of half-paddle: still a legal hit
    this.missDir = this.rnd() < 0.5 ? -1 : 1;
    this.speedMul = this.hard ? 1.3 + this.rnd() * 0.3 : 0.8 + this.rnd() * 0.35;
  }
  /** Desired paddle centre for this moment. */
  target(ball, y, w, pw) {
    const lx = predictX(ball, y, w);
    if (!this.willMiss) return lx + this.jitter * (pw / 2);
    let t = lx + this.missDir * (pw / 2 + ball.r + pw * (0.12 + this.rnd() * 0 + 0.1));
    if (t < pw / 2 || t > w - pw / 2) t = lx - this.missDir * (pw / 2 + ball.r + pw * 0.2);
    return t;
  }
}
