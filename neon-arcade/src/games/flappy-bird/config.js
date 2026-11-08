export const GAME_ID = "flappy-bird";

// World units: the world is always WORLD_HEIGHT tall; width follows the screen aspect ratio.
export const physics = {
  worldHeight: 480,
  groundHeight: 44,
  gravity: 1500,        // units / s^2
  jumpVelocity: -430,   // units / s
  maxFallSpeed: 640,
  birdX: 0.28,          // fraction of world width
  birdRadius: 12,
  pipeWidth: 62,
  pipeGap: 150,
  pipeSpacing: 240,
  pipeSpeed: 150,
  gapMargin: 56,        // min distance between a gap and the ceiling / ground
  maxDt: 1 / 30         // clamp so a stalled tab can't tunnel the bird through pipes
};

export const blink = {
  closeThreshold: 0.4,   // blendshape score above this = eyes closed
  openThreshold: 0.22,    // must fall below this to count as reopened (hysteresis)
  cooldownMs: 0,         // no artificial gap; the reopen requirement already prevents repeats
  calibrationFrames: 24, // face frames used to measure this player's open-eye baseline
  faceLostMs: 400,       // no face for this long = FACE NOT DETECTED
  minBrightness: 45,     // 0-255 mean luma below which we warn about lighting
  minFaceConfidence: 0.5
};

export const mediapipe = {
  // Library and wasm are vendored under assets/vendor. The model is Google's official hosted file.
  bundle: new URL("../../../assets/vendor/mediapipe/vision_bundle.mjs", import.meta.url).href,
  wasmRoot: new URL("../../../assets/vendor/mediapipe/wasm", import.meta.url).href,
  modelUrl: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
};
