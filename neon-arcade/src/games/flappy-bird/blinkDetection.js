// Blink detection on top of MediaPipe Face Landmarker blendshapes (eyeBlinkLeft / eyeBlinkRight).
// BlinkStateMachine is pure (no DOM / MediaPipe) so its behaviour can be unit-tested.
import { blink as defaults, mediapipe } from "./config.js";

export const BlinkState = Object.freeze({
  CALIBRATING: "CALIBRATING",
  READY: "READY",
  CLOSED: "EYES CLOSED",
  BLINK: "BLINK DETECTED",
  NO_FACE: "FACE NOT DETECTED",
  LOW_LIGHT: "TOO DARK"
});

/**
 * open (armed) -> eyes close: ONE jump immediately -> must reopen to re-arm.
 * Jump fires on closure; the eyes must reopen before another jump can fire.
 */
export class BlinkStateMachine {
  constructor(options = {}, onBlink = () => {}) {
    this.cfg = { ...defaults, ...options };
    this.onBlink = onBlink;
    this.reset();
  }

  reset() {
    this.phase = "calibrating"; // calibrating | armed | closed | held | cooldown-wait
    this.closeThreshold = this.cfg.closeThreshold;
    this.openThreshold = this.cfg.openThreshold;
    this.baseline = [];
    this.closedAt = 0;
    this.lastBlinkAt = -Infinity;
    this.lastFaceAt = -Infinity;
    this.flashUntil = 0;
    this.state = BlinkState.NO_FACE;
    this.blinkCount = 0;
  }

  /** Feed one frame. `score` = mean eye-blink blendshape in 0..1, or null when no face. */
  update(score, now) {
    const c = this.cfg;

    if (score === null || score === undefined || Number.isNaN(score)) {
      if (now - this.lastFaceAt > c.faceLostMs) {
        // Face lost: discard any in-progress closure so a returning face can't fire a stale blink.
        if (this.phase === "closed" || this.phase === "held") this.phase = "held";
        this.state = BlinkState.NO_FACE;
      }
      return this.state;
    }
    this.lastFaceAt = now;

    switch (this.phase) {
      case "calibrating": {
        if (score < c.closeThreshold) this.baseline.push(score);
        this.state = BlinkState.CALIBRATING;
        if (this.baseline.length >= c.calibrationFrames) {
          const sorted = [...this.baseline].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          // Adapt to players whose eyes rest partly closed; never go below the configured defaults.
          this.openThreshold = Math.min(0.55, Math.max(c.openThreshold, median + 0.12));
          this.closeThreshold = Math.min(0.85, Math.max(c.closeThreshold, median + 0.25));
          this.phase = "armed";
          this.state = BlinkState.READY;
        }
        break;
      }
      case "armed":
        if (score >= this.closeThreshold) {
          // Fire the moment the eyes close (lowest latency). Re-arming needs a reopen,
          // so holding the eyes shut can never repeat.
          this.phase = "closed";
          this.closedAt = now;
          if (now - this.lastBlinkAt >= c.cooldownMs) {
            this.lastBlinkAt = now;
            this.flashUntil = now + 250;
            this.blinkCount += 1;
            this.state = BlinkState.BLINK;
            this.onBlink(now);
          } else {
            this.state = BlinkState.CLOSED;
          }
        } else if (now >= this.flashUntil) {
          this.state = BlinkState.READY;
        }
        break;
      case "closed":
        this.state = now < this.flashUntil ? BlinkState.BLINK : BlinkState.CLOSED;
        if (score <= this.openThreshold) {
          this.phase = "armed";
          this.state = now < this.flashUntil ? BlinkState.BLINK : BlinkState.READY;
        }
        break;
      case "held":
        // Prolonged closure (or face lost mid-closure): wait for a full reopen, then re-arm. No jump.
        this.state = BlinkState.CLOSED;
        if (score <= this.openThreshold) {
          this.phase = "armed";
          this.state = BlinkState.READY;
        }
        break;
    }
    return this.state;
  }
}

function meanLuma(ctx, video) {
  try {
    ctx.drawImage(video, 0, 0, 16, 12);
    const d = ctx.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  } catch {
    return 255;
  }
}

let landmarkerPromise = null;

/** Loads the Face Landmarker once and reuses it across restarts. Only called when a game needs it. */
export function loadFaceLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await import(/* @vite-ignore */ mediapipe.bundle);
      const fileset = await vision.FilesetResolver.forVisionTasks(mediapipe.wasmRoot);
      const make = (delegate) =>
        vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: mediapipe.modelUrl, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: defaults.minFaceConfidence,
          minFacePresenceConfidence: defaults.minFaceConfidence,
          minTrackingConfidence: defaults.minFaceConfidence
        });
      try {
        return await make("GPU");
      } catch {
        return await make("CPU");
      }
    })().catch((err) => {
      landmarkerPromise = null; // allow Retry
      throw err;
    });
  }
  return landmarkerPromise;
}

/**
 * Runs detection against a playing <video>. One detection at a time (detectForVideo is synchronous
 * and the next one is only scheduled after it returns), and only for new video frames.
 */
export class BlinkDetector {
  constructor(video, { onBlink, onState, options } = {}) {
    this.video = video;
    this.onState = onState || (() => {});
    this.machine = new BlinkStateMachine(options, onBlink);
    this.landmarker = null;
    this.running = false;
    this.handle = 0;
    this.lastVideoTime = -1;
    this.lastState = null;
    this.lastLumaAt = 0;
    this.lowLight = false;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 16;
    this.canvas.height = 12;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this._tick = this._tick.bind(this);
  }

  async init() {
    this.landmarker = await loadFaceLandmarker();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.machine.reset();
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this.handle) {
      if (this.video.cancelVideoFrameCallback && this._usingVfc) this.video.cancelVideoFrameCallback(this.handle);
      else cancelAnimationFrame(this.handle);
    }
    this.handle = 0;
  }

  _schedule() {
    if (!this.running) return;
    this._usingVfc = typeof this.video.requestVideoFrameCallback === "function";
    this.handle = this._usingVfc
      ? this.video.requestVideoFrameCallback(this._tick)
      : requestAnimationFrame(this._tick);
  }

  _tick() {
    if (!this.running) return;
    const now = performance.now();
    const video = this.video;
    if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      let score = null;
      try {
        const result = this.landmarker.detectForVideo(video, now);
        const shapes = result.faceBlendshapes && result.faceBlendshapes[0];
        if (shapes) {
          let l = null, r = null;
          for (const cat of shapes.categories) {
            if (cat.categoryName === "eyeBlinkLeft") l = cat.score;
            else if (cat.categoryName === "eyeBlinkRight") r = cat.score;
          }
          if (l !== null && r !== null) score = (l + r) / 2;
        }
      } catch {
        score = null;
      }
      if (now - this.lastLumaAt > 600) {
        this.lastLumaAt = now;
        this.lowLight = meanLuma(this.ctx, video) < this.machine.cfg.minBrightness;
      }
      let state = this.machine.update(score, now);
      if (this.lowLight && state === BlinkState.NO_FACE) state = BlinkState.LOW_LIGHT;
      if (state !== this.lastState) {
        this.lastState = state;
        this.onState(state);
      }
    }
    this._schedule();
  }
}
