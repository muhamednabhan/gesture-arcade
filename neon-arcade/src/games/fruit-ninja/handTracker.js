// Webcam hand tracking with MediaPipe Hand Landmarker. The index fingertip (landmark 8) is the blade.
//
//  - Library + wasm are vendored; the model file is downloaded ONCE per page session and kept as bytes,
//    so re-entering the game never downloads it again (the landmarker itself is closed on every exit).
//  - Output coordinates are normalised 0..1 across the whole play area: mirrored (the preview is mirrored),
//    stretched from the central part of the camera frame so the fingertip can reach every edge, then smoothed
//    with a One-Euro filter (steady when slow, almost no lag when fast).
//  - Only new video frames are processed, at a capped rate that backs off if inference is slow.
import { input, mediapipe } from "./config.js";

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];
export const INDEX_TIP = 8;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Camera landmark (0..1, un-mirrored) -> play-area coordinate (0..1, mirrored, margin-stretched). */
export function mapLandmark(lm, mx = input.marginX, my = input.marginY) {
  return {
    x: clamp01((1 - lm.x - mx) / (1 - 2 * mx)),
    y: clamp01((lm.y - my) / (1 - 2 * my))
  };
}

// ---------- One-Euro filter ----------
const alphaFor = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

export class OneEuro {
  constructor({ minCutoff, beta, dCutoff } = input.oneEuro) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }
  filter(value, tMs) {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1 / 240, Math.min(0.25, (tMs - this.t) / 1000));
    this.t = tMs;
    const rate = (value - this.x) / dt;
    this.dx += alphaFor(this.dCutoff, dt) * (rate - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alphaFor(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

// ---------- model loading (cached per page session) ----------
let visionPromise = null;
let modelPromise = null;

function getVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const vision = await import(/* @vite-ignore */ mediapipe.bundle);
      const fileset = await vision.FilesetResolver.forVisionTasks(mediapipe.wasmRoot);
      return { vision, fileset };
    })().catch((err) => {
      visionPromise = null; // allow Retry
      throw err;
    });
  }
  return visionPromise;
}

function getModelBytes() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), mediapipe.loadTimeoutMs);
      try {
        const res = await fetch(mediapipe.modelUrl, { signal: ctrl.signal, cache: "force-cache" });
        if (!res.ok) throw new Error(`Model download failed (${res.status})`);
        return new Uint8Array(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    })().catch((err) => {
      modelPromise = null; // allow Retry
      throw err;
    });
  }
  return modelPromise;
}

/** Starts fetching library + model right away (call when the player presses START). Safe to call repeatedly. */
export function preloadHandModel() {
  return Promise.all([getVision(), getModelBytes()]);
}

async function createLandmarker(delegate) {
  const [{ vision, fileset }, bytes] = await Promise.all([getVision(), getModelBytes()]);
  return vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: bytes.slice(), delegate }, // copy: never hand the cached bytes to wasm
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.35, // more tolerant of a partly visible hand near the frame edge
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.35
  });
}

// ---------- tracker ----------
export class HandTracker {
  /**
   * callbacks: onPoint(x, y, t)  smoothed fingertip, normalised 0..1
   *            onFound()         hand (re)acquired        onLost()  hand gone for > handLostMs
   *            onLandmarks(list|null) raw landmarks, for the preview skeleton
   *            onError(err)      inference cannot continue
   */
  constructor(video, { onPoint, onFound, onLost, onLandmarks, onError } = {}) {
    this.video = video;
    this.onPoint = onPoint || (() => {});
    this.onFound = onFound || (() => {});
    this.onLost = onLost || (() => {});
    this.onLandmarks = onLandmarks || (() => {});
    this.onError = onError || (() => {});
    this.landmarker = null;
    this.delegate = "GPU";
    this.running = false;
    this.handle = 0;
    this.usingVfc = false;
    this.fps = input.maxInferenceFps;
    this.inferMs = 0; // smoothed inference cost
    this.lastInfer = 0;
    this.lastTs = 0;
    this.lastVideoTime = -1;
    this.lastSeen = 0;
    this.hasHand = false;
    this.failures = 0;
    this.recovered = false;
    this.fx = new OneEuro();
    this.fy = new OneEuro();
    this._tick = this._tick.bind(this);
  }

  async init() {
    try {
      this.landmarker = await createLandmarker("GPU");
      this.delegate = "GPU";
    } catch (gpuErr) {
      this.landmarker = await createLandmarker("CPU"); // throws if the model/library really is unavailable
      this.delegate = "CPU";
    }
    this._warmUp();
  }

  // The first inference compiles the graph / shaders and can take a long time. Do it now on a blank canvas so the
  // player's first real frames are already fast.
  _warmUp() {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      g.fillStyle = "#888";
      g.fillRect(0, 0, 128, 128);
      this.lastTs = 1;
      this.landmarker.detectForVideo(c, 1);
    } catch { /* warm-up is best effort */ }
  }

  start() {
    if (this.running || !this.landmarker) return;
    this.running = true;
    this.lastVideoTime = -1;
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this.handle) {
      if (this.usingVfc && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.handle);
      else cancelAnimationFrame(this.handle);
      this.handle = 0;
    }
  }

  /** Full-rate while playing, reduced while a menu is showing. */
  setActive(active) {
    this.fps = active ? input.maxInferenceFps : input.idleInferenceFps;
  }

  destroy() {
    this.stop();
    if (this.landmarker) {
      try { this.landmarker.close(); } catch { /* already closed */ }
      this.landmarker = null;
    }
    this.onPoint = this.onFound = this.onLost = this.onLandmarks = this.onError = () => {};
  }

  _schedule() {
    if (!this.running) return;
    this.usingVfc = typeof this.video.requestVideoFrameCallback === "function";
    this.handle = this.usingVfc ? this.video.requestVideoFrameCallback(this._tick) : requestAnimationFrame(this._tick);
  }

  _tick() {
    this.handle = 0;
    if (!this.running) return;
    try {
      this._detect();
      this.failures = 0;
    } catch (err) {
      if (++this.failures >= 3) {
        this._recover(err);
        return;
      }
    }
    this._schedule();
  }

  async _recover(err) {
    this.stop();
    // A GPU delegate that fails at runtime on some integrated GPUs: retry once on CPU before giving up.
    if (this.delegate === "GPU" && !this.recovered) {
      this.recovered = true;
      try {
        const old = this.landmarker;
        this.landmarker = await createLandmarker("CPU");
        this.delegate = "CPU";
        this.failures = 0;
        try { old && old.close(); } catch { /* ignore */ }
        this.start();
        return;
      } catch { /* fall through */ }
    }
    this.onError(err);
  }

  _detect() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    if (v.currentTime === this.lastVideoTime) return; // no new camera frame: don't repeat work
    const now = performance.now();
    const minGap = Math.max(1000 / this.fps, this.inferMs * 1.6); // back off when inference is slow
    if (now - this.lastInfer < minGap) {
      this._checkLost(now);
      return;
    }
    this.lastVideoTime = v.currentTime;
    this.lastInfer = now;
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(v, ts);
    const done = performance.now();
    this.inferMs = this.inferMs ? this.inferMs * 0.9 + (done - now) * 0.1 : done - now;

    const lm = res && res.landmarks && res.landmarks[0];
    if (!lm) {
      this.onLandmarks(null);
      this._checkLost(done);
      return;
    }
    this.onLandmarks(lm);
    this.lastSeen = done;
    if (!this.hasHand) {
      this.hasHand = true;
      this.fx.reset(); // fresh filter: no smoothing glide from the old position
      this.fy.reset();
      this.onFound();
    }
    const p = mapLandmark(lm[INDEX_TIP]);
    this.onPoint(this.fx.filter(p.x, done), this.fy.filter(p.y, done), done);
  }

  _checkLost(now) {
    if (this.hasHand && now - this.lastSeen > input.handLostMs) {
      this.hasHand = false;
      this.onLost();
    }
  }
}
