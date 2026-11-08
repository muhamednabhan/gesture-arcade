// Fruit Ninja: every tunable in one place.
export const GAME_ID = "fruit-ninja";

export const rules = {
  lives: 3,
  maxLives: 5,
  extraLifeEvery: 30,      // slices; grants +1 life up to maxLives
  comboWindow: 0.6,        // seconds between slices that keep a chain alive
  comboBonusStep: 5,       // bonus = (chain - 1) * step ...
  comboBonusCap: 40,       // ... capped here
  perfectWaveBonus: 20,    // every fruit of a 3+ wave sliced
  pointsPerLevel: 110,     // difficulty level = score / this
  maxLevel: 14,
  bladeWidth: 5            // extra hit tolerance (design px, scaled) added to every fruit hitbox
};

export const input = {
  // Portion of the camera frame that maps onto the whole play area (so the fingertip can reach every edge
  // without the hand leaving the camera view).
  // Only the central part of the camera frame is mapped onto the screen. A screen corner is reached while the
  // hand is still well inside the frame (tracking is poor where the hand is cropped at the camera edge).
  marginX: 0.21,
  marginY: 0.2,
  oneEuro: { minCutoff: 1.9, beta: 14, dCutoff: 1.2 }, // smoothing: calm when slow, no lag when fast
  maxInferenceFps: 45,
  idleInferenceFps: 15,     // while a menu is showing
  handLostMs: 350,          // trail is broken after this long without a hand
  handPauseMs: 2200,        // game soft-pauses after this long without a hand
  readyFrames: 3,           // detections (within readyWindowMs) before the countdown starts
  readyWindowMs: 900,
  jumpFraction: 0.5,        // a single-sample jump bigger than this fraction of the screen never draws a slash
  keyboardSpeed: 0.85,      // keyboard cursor, screen-widths per second
  dwellMs: 900              // hold the fingertip over a menu button this long to press it
};

export const mediapipe = {
  // Library and wasm are vendored (shared with Blink Bird). The model file is Google's official hosted one.
  bundle: new URL("../../../assets/vendor/mediapipe/vision_bundle.mjs", import.meta.url).href,
  wasmRoot: new URL("../../../assets/vendor/mediapipe/wasm", import.meta.url).href,
  modelUrl: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  loadTimeoutMs: 40000
};

export const art = {
  hero: new URL("../../../assets/games/fruit-ninja/hero.svg", import.meta.url).href
};
