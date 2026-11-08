// Generated sound effects (WebAudio). No audio files, no microphone, and the AudioContext is only created after
// a user gesture (unlock()). The game is fully playable with sound muted or unavailable.
const MUTE_KEY = "neonArcade.settings.v1.fruit-ninja.muted";

function readMuted() {
  try { return window.localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = readMuted();
    this.lastSlice = 0;
  }

  /** Call from a click/keypress handler. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = !!m;
    try { window.localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch { /* storage blocked: still muted this session */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  }

  _tone(freq, end, dur, type = "sine", vol = 0.25, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(from, to, dur, vol = 0.3, q = 1.2, delay = 0) {
    if (!this.ctx || this.muted || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  slice(combo = 1) {
    const now = performance.now();
    if (now - this.lastSlice < 35) return; // many fruit in one swipe: don't stack into noise
    this.lastSlice = now;
    const up = 1 + Math.min(combo - 1, 6) * 0.06;
    this._noise(2200 * up, 7000 * up, 0.14, 0.35);
    this._tone(520 * up, 980 * up, 0.09, "triangle", 0.12);
    this._tone(180, 80, 0.12, "sine", 0.18); // juicy thump
  }
  combo(n) {
    const base = 520 * (1 + Math.min(n, 8) * 0.08);
    this._tone(base, base * 1.5, 0.12, "square", 0.08, 0.03);
    this._tone(base * 1.5, base * 2, 0.14, "square", 0.08, 0.1);
  }
  bomb() {
    this._noise(900, 60, 0.6, 0.7, 0.5);
    this._tone(110, 30, 0.55, "sawtooth", 0.35);
  }
  miss() { this._tone(300, 120, 0.25, "sawtooth", 0.14); }
  life() { [660, 880, 1320].forEach((f, i) => this._tone(f, f * 1.01, 0.12, "triangle", 0.15, i * 0.07)); }
  tick() { this._tone(880, 860, 0.08, "square", 0.1); }
  go() { this._tone(880, 1760, 0.3, "square", 0.14); }
  ui() { this._tone(700, 520, 0.06, "square", 0.08); }
  over() { [392, 330, 262, 196].forEach((f, i) => this._tone(f, f * 0.98, 0.28, "sawtooth", 0.13, i * 0.17)); }
  record() { [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone(f, f, 0.2, "triangle", 0.16, i * 0.1)); }

  destroy() {
    if (this.ctx) {
      try { this.ctx.close(); } catch { /* already closed */ }
    }
    this.ctx = this.master = this.noise = null;
  }
}
