// Webcam gesture feed: MediaPipe Hand Landmarker -> onGesture(move|null, t). Reuses the vendored library and
// model URL from Fruit Ninja's config (read-only import). Everything is released in destroy().
import { mediapipe } from "../fruit-ninja/config.js";
import { classifyHand } from "./rules.js";

let visionP = null, modelP = null;
const getVision = () => (visionP ||= (async () => {
  const vision = await import(/* @vite-ignore */ mediapipe.bundle);
  return { vision, fileset: await vision.FilesetResolver.forVisionTasks(mediapipe.wasmRoot) };
})().catch((e) => { visionP = null; throw e; }));
const getModel = () => (modelP ||= (async () => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), mediapipe.loadTimeoutMs);
  try {
    const res = await fetch(mediapipe.modelUrl, { signal: ctrl.signal, cache: "force-cache" });
    if (!res.ok) throw new Error("Model download failed");
    return new Uint8Array(await res.arrayBuffer());
  } finally { clearTimeout(t); }
})().catch((e) => { modelP = null; throw e; }));

export const preload = () => Promise.all([getVision(), getModel()]).catch(() => {});

async function make(delegate) {
  const [{ vision, fileset }, bytes] = await Promise.all([getVision(), getModel()]);
  return vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: bytes.slice(), delegate },
    runningMode: "VIDEO", numHands: 1,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
  });
}

export class GestureTracker {
  constructor(video, { onGesture, onError }) {
    this.video = video; this.onGesture = onGesture; this.onError = onError;
    this.lm = null; this.running = false; this.handle = 0; this.lastT = -1; this.lastTs = 0; this.fails = 0;
    this._tick = this._tick.bind(this);
  }
  async init() {
    try { this.lm = await make("GPU"); } catch { this.lm = await make("CPU"); }
  }
  start() { if (!this.running && this.lm) { this.running = true; this._next(); } }
  _next() {
    if (!this.running) return;
    const v = this.video;
    this.vfc = typeof v.requestVideoFrameCallback === "function";
    this.handle = this.vfc ? v.requestVideoFrameCallback(this._tick) : requestAnimationFrame(this._tick);
  }
  _tick() {
    this.handle = 0;
    if (!this.running) return;
    const v = this.video;
    try {
      if (v.readyState >= 2 && v.videoWidth && v.currentTime !== this.lastT) {
        this.lastT = v.currentTime;
        const now = performance.now();
        const ts = Math.max(now, this.lastTs + 1);
        this.lastTs = ts;
        const res = this.lm.detectForVideo(v, ts);
        const l = res && res.landmarks && res.landmarks[0];
        this.onGesture(classifyHand(l), now, l || null);
      }
      this.fails = 0;
    } catch (e) {
      if (++this.fails >= 5) { this.running = false; this.onError(e); return; }
    }
    this._next();
  }
  destroy() {
    this.running = false;
    if (this.handle) {
      if (this.vfc && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.handle);
      else cancelAnimationFrame(this.handle);
    }
    try { this.lm && this.lm.close(); } catch { /* closed */ }
    this.lm = null;
    this.onGesture = this.onError = () => {};
  }
}
