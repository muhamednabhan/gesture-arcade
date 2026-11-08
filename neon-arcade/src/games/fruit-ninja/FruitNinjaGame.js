// Fruit Ninja: owns its DOM, canvas loop, camera session, listeners and timers.
// destroy() releases every one of them, so leaving the game never leaves a camera, loop or handler behind.
import { GAME_ID, rules, input, art } from "./config.js";
import { FruitEngine, Status } from "./fruitEngine.js";
import { FruitRenderer } from "./fruitRenderer.js";
import { HandTracker, preloadHandModel, HAND_CONNECTIONS, INDEX_TIP } from "./handTracker.js";
import { Sfx } from "./sfx.js";

const MODEL_TIMEOUT_MS = 60000;
const SVG_LIFE = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 9c-3-3-9-2-10 4-1 6 3 13 7 13 1.5 0 2-.7 3-.7s1.5.7 3 .7c4 0 8-7 7-13-1-6-7-7-10-4z"/><path class="leaf" d="M16 9c0-3 1.5-5 4-6-.2 3-1.5 5-4 6z"/></svg>`;
const SVG_HAND = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M26 34V13a4 4 0 0 1 8 0v20" /><path d="M34 29v-4a4 4 0 0 1 8 0v8M42 31v-1a4 4 0 0 1 8 0v10c0 9-6 16-15 16h-3c-7 0-11-4-15-11l-6-10a4 4 0 0 1 7-4l5 7"/></svg>`;
const SVG_SOUND_ON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.500a5 5 0 0 1 0 7M19 6a8.500 8.500 0 0 1 0 12"/></svg>`;
const SVG_SOUND_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>`;

export function createGame({ container, records, camera, onExit }) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.createElement("div");
  root.className = "fn";
  root.innerHTML = `
    <canvas class="fn-canvas" aria-label="Fruit Ninja playfield"></canvas>
    <div class="fn-cam" hidden>
      <div class="fn-cam-frame">
        <video class="fn-video" muted playsinline></video>
        <canvas class="fn-cam-dots" width="128" height="96"></canvas>
      </div>
      <span class="fn-chip" role="status">STARTING</span>
    </div>
    <div class="fn-hud" hidden>
      <div class="fn-score-wrap">
        <div class="fn-score" aria-live="off">0</div>
        <div class="fn-combo" aria-hidden="true"></div>
      </div>
      <div class="fn-topright">
        <div class="fn-lives" role="img" aria-label="Lives"></div>
        <span class="fn-best"></span>
        <div class="fn-btns">
          <button class="fn-iconbtn" type="button" data-act="mute" aria-label="Mute sound"></button>
          <button class="fn-iconbtn" type="button" data-act="pause" aria-label="Pause">II</button>
        </div>
      </div>
      <div class="fn-banner" role="status"></div>
    </div>
    <div class="fn-count" aria-live="assertive"></div>
    <div class="fn-overlay" hidden></div>
    <div class="fn-pointer" hidden aria-hidden="true"></div>`;
  container.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const canvas = $(".fn-canvas"), camBox = $(".fn-cam"), video = $(".fn-video"), dots = $(".fn-cam-dots"), chip = $(".fn-chip");
  const dctx = dots.getContext("2d");
  const hud = $(".fn-hud"), scoreEl = $(".fn-score"), comboEl = $(".fn-combo"), livesEl = $(".fn-lives"), bestEl = $(".fn-best");
  const bannerEl = $(".fn-banner"), countEl = $(".fn-count"), overlay = $(".fn-overlay"), pointerEl = $(".fn-pointer");
  const muteBtn = $('[data-act="mute"]');

  const renderer = new FruitRenderer(canvas, { reducedMotion });
  const engine = new FruitEngine();
  const sfx = new Sfx();

  let phase = "intro"; // intro | loading | error | ready | countdown | playing | handlost | paused | over
  let useCamera = false;
  let tracker = null;
  let W = 0, H = 0;
  let raf = 0, last = performance.now();
  let destroyed = false;
  let session = 0;                    // invalidates in-flight async camera/model work after exit, retry or cancel
  let handPresent = false, handSeen = false, lostSince = 0, readyStreak = 0, readyAt = 0;
  let lastX = 0, lastY = 0, hasLast = false, cursorOn = false;
  let countLeft = 0, countKind = "new", countAcc = 0;
  let overTimer = 0, hintUntil = 0;
  let lastResult = null, prevBest = 0;
  let shownScore = -1, shownLives = -1, shownCombo = 0, shownBanner = "";
  let dwellEl = null, dwellStart = 0, dwellCool = 0, btnRects = [];
  let kbActive = false;
  const kb = { x: 0, y: 0, vx: 0, vy: 0, keys: new Set() };
  const pq = [];                      // queued fingertip/pointer points [x, y, breakFlag, ...]
  const timers = new Set();
  const cleanups = [];

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };

  // ---------- Layout ----------
  let resizeQueued = false;
  const doResize = () => {
    resizeQueued = false;
    if (destroyed) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    W = w; H = h;
    renderer.resize(w, h);
    engine.setSize(w, h);
    updateSafeRect();
    if (hasLast) { lastX = Math.min(lastX, W); lastY = Math.min(lastY, H); }
    refreshButtonRects();
  };
  const queueResize = () => {
    if (resizeQueued || destroyed) return;
    resizeQueued = true;
    requestAnimationFrame(doResize);
  };
  const ro = new ResizeObserver(queueResize);
  ro.observe(container);
  doResize();

  function updateSafeRect() {
    if (camBox.hidden) { engine.setSafeRect(null); return; }
    const b = camBox.getBoundingClientRect(), r = root.getBoundingClientRect();
    engine.setSafeRect({ x: 0, y: 0, w: b.right - r.left + 8, h: b.bottom - r.top + 8 });
  }

  // ---------- Overlay screens ----------
  const btn = (act, label, cls = "") => `<button type="button" class="fn-btn ${cls}" data-act="${act}" ${cls.includes("primary") ? "data-primary" : ""}><span>${label}</span></button>`;

  function setOverlay(html, { modal = true } = {}) {
    overlay.innerHTML = html || "";
    overlay.hidden = !html;
    overlay.classList.toggle("is-light", !modal);
    root.classList.toggle("is-ready", phase === "ready"); // enlarges the camera preview while waiting for a hand
    if (html) {
      const primary = overlay.querySelector("[data-primary]");
      if (primary && modal) primary.focus({ preventScroll: true });
      refreshButtonRects();
    } else {
      btnRects = [];
      endDwell();
    }
  }

  function refreshButtonRects() {
    btnRects = [];
    if (overlay.hidden) return;
    const r = root.getBoundingClientRect();
    for (const el of overlay.querySelectorAll("[data-act]")) {
      const b = el.getBoundingClientRect();
      btnRects.push({ el, x: b.left - r.left - 6, y: b.top - r.top - 6, w: b.width + 12, h: b.height + 12 });
    }
  }

  const bestText = () => {
    const b = records.getBest(GAME_ID);
    return b ? String(b) : "--";
  };

  function showIntro() {
    phase = "intro";
    hud.hidden = true;
    setCount("");
    setOverlay(`
      <div class="fn-panel fn-intro">
        <div class="fn-intro-art"><img src="${art.hero}" alt="" draggable="false"></div>
        <div class="fn-intro-copy">
          <h2 class="fn-title">FRUIT<br><strong>NINJA</strong></h2>
          <p class="fn-lead">Slice fruit by moving your <b>index finger</b> through the webcam view.</p>
          <ul class="fn-how">
            <li>Every slice scores. Chain slices for <b>combo</b> bonuses.</li>
            <li>Avoid the glowing <b class="is-bomb">bombs</b>. Each one costs a life.</li>
            <li>Miss ${rules.lives} fruit and the round ends.</li>
          </ul>
          <div class="fn-actions">${btn("start", "START GAME", "primary")}${btn("pointer", "NO CAMERA: MOUSE / KEYS")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div>
          <p class="fn-privacy">The camera starts only after you press START. Video stays on this device. No microphone.</p>
          <p class="fn-pb">PERSONAL BEST <b>${bestText()}</b></p>
        </div>
      </div>`);
  }

  function showLoading(msg, sub = "") {
    phase = "loading";
    hud.hidden = true;
    setOverlay(`
      <div class="fn-panel fn-center">
        <div class="fn-spinner" aria-hidden="true"></div>
        <p class="fn-status" role="status">${msg}</p>
        <p class="fn-sub">${sub}</p>
        ${btn("cancel", "CANCEL", "ghost small")}
      </div>`);
  }

  function showError(title, detail) {
    phase = "error";
    hud.hidden = true;
    setCount("");
    setOverlay(`
      <div class="fn-panel fn-center fn-error" role="alert">
        <p class="fn-status is-bad">${title}</p>
        <p class="fn-sub">${detail}</p>
        <div class="fn-actions">
          ${btn("retry", "RETRY CAMERA", "primary")}
          ${btn("pointer", "PLAY WITH MOUSE / KEYS")}
          ${btn("exit", "RETURN TO ARCADE", "ghost")}
        </div>
      </div>`);
  }

  function showReady() {
    phase = "ready";
    readyStreak = 0;
    if (tracker) tracker.setActive(true);
    hud.hidden = false;
    setBanner("");
    setOverlay(`
      <div class="fn-panel fn-center fn-ready">
        <div class="fn-hand" aria-hidden="true">${SVG_HAND}</div>
        <p class="fn-status">RAISE YOUR INDEX FINGER</p>
        <p class="fn-sub">Hold your hand up with your index finger pointing up, fully in view of the camera. The countdown starts the moment it is detected.</p>
        <div class="fn-actions">${btn("pointer", "USE MOUSE / KEYS INSTEAD")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div>
      </div>`, { modal: false });
  }

  function showPause() {
    phase = "paused";
    setOverlay(`
      <div class="fn-panel fn-center">
        <p class="fn-status">PAUSED</p>
        <div class="fn-actions">
          ${btn("resume", "RESUME", "primary")}
          ${btn("restart", "RESTART")}
          ${useCamera ? btn("pointer", "SWITCH TO MOUSE / KEYS") : btn("start", "USE CAMERA")}
          ${btn("exit", "RETURN TO ARCADE", "ghost")}
        </div>
      </div>`);
  }

  function showOver(result) {
    phase = "over";
    hud.hidden = false;
    const diff = engine.score - prevBest;
    const cmp = result.isNewRecord
      ? (prevBest ? `+${diff} over your old best of ${prevBest}` : "your first record")
      : prevBest ? `${prevBest - engine.score} short of your best` : "";
    setOverlay(`
      <div class="fn-panel fn-center fn-over">
        <p class="fn-status is-bad">GAME OVER</p>
        ${result.isNewRecord ? '<p class="fn-newrecord">★ NEW RECORD! ★</p>' : ""}
        <div class="fn-final"><span>FINAL SCORE</span><b>${engine.score}</b></div>
        <p class="fn-sub fn-bestline">PERSONAL BEST <b>${result.best || "--"}</b>${cmp ? ` · ${cmp}` : ""}</p>
        <p class="fn-stats">${engine.sliced} sliced · best combo ×${engine.maxCombo}${engine.perfects ? ` · ${engine.perfects} perfect wave${engine.perfects > 1 ? "s" : ""}` : ""}</p>
        <div class="fn-actions">
          ${btn("restart", "PLAY AGAIN", "primary")}
          ${btn("exit", "RETURN TO ARCADE", "ghost")}
        </div>
      </div>`);
    if (result.isNewRecord) sfx.record();
  }

  // ---------- HUD ----------
  function buildLives() {
    livesEl.innerHTML = Array.from({ length: rules.maxLives }, () => `<i class="fn-life">${SVG_LIFE}</i>`).join("");
    shownLives = -1;
  }
  function renderLives(n) {
    if (n === shownLives) return;
    const lostNow = shownLives > n;
    shownLives = n;
    livesEl.setAttribute("aria-label", `${n} lives`);
    [...livesEl.children].forEach((el, i) => {
      el.classList.toggle("is-on", i < n);
      el.classList.toggle("is-lost", i >= n);
      el.hidden = i >= rules.lives && i >= n && !el.classList.contains("was-earned");
      if (i >= rules.lives && i < n) { el.classList.add("was-earned"); el.hidden = false; }
    });
    if (lostNow) { livesEl.classList.remove("shake"); void livesEl.offsetWidth; livesEl.classList.add("shake"); }
  }
  function renderMute() {
    muteBtn.innerHTML = sfx.muted ? SVG_SOUND_OFF : SVG_SOUND_ON;
    muteBtn.setAttribute("aria-label", sfx.muted ? "Unmute sound" : "Mute sound");
    muteBtn.setAttribute("aria-pressed", sfx.muted ? "true" : "false");
  }
  function refreshBest() {
    bestEl.textContent = `BEST ${bestText()}`;
  }
  function setBanner(text, cls = "") {
    const key = text + cls;
    if (key === shownBanner) return;
    shownBanner = key;
    bannerEl.textContent = text;
    bannerEl.className = `fn-banner ${text ? "is-on" : ""} ${cls}`;
  }
  function setCount(text, cls = "tick") {
    countEl.textContent = text;
    countEl.className = "fn-count";
    if (!text) return;
    void countEl.offsetWidth; // restart the pop animation for every new number
    countEl.classList.add(cls);
  }
  function setChip(text, cls) {
    chip.textContent = text;
    chip.className = `fn-chip ${cls || ""}`;
  }
  function controlHint() {
    if (useCamera) return "Move your index finger through the fruit to slice it.";
    return kbActive ? "Arrow keys / WASD move the blade. Hold Shift to dash." : "Move the mouse (or drag a finger) through the fruit to slice it.";
  }

  // ---------- Camera + tracker session ----------
  function stopCamera() {
    session++;
    if (tracker) { tracker.destroy(); tracker = null; }
    camera.release(video);
    camBox.hidden = true;
    handPresent = false;
    cursorOn = false;
    renderer.setCursor(0, 0, false);
    pq.length = 0;
    breakStroke();
    updateSafeRect();
  }

  function withTimeout(promise, ms, message) {
    let id;
    const timeout = new Promise((_, rej) => { id = setTimeout(() => rej(new Error(message)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
  }

  async function startCameraSession() {
    root.classList.remove("camera-preview-hidden");
    document.body.classList.remove("camera-preview-hidden");
    const mine = ++session;
    const stale = () => destroyed || mine !== session;
    clearTimeout(overTimer);
    useCamera = true;
    sfx.unlock(); // allowed: we are inside the START click
    showLoading("REQUESTING CAMERA", "Allow camera access when your browser asks. Video only: no audio is requested.");
    preloadHandModel().catch(() => {}); // download the library + model while the permission prompt is open
    try {
      await camera.acquire(video, { onEnded: () => { if (!stale()) cameraLost(); } });
    } catch (err) {
      if (stale() || (err && err.name === "AbortError")) return; // cameraManager already cleaned up
      camera.release(video);
      const name = err && err.name;
      if (name === "NotAllowedError" || name === "SecurityError") showError("CAMERA ACCESS DENIED", "Allow the camera in your browser's site settings, then retry. You can also play with the mouse or keyboard.");
      else if (name === "NotFoundError" || name === "OverconstrainedError") showError("NO CAMERA FOUND", "Connect a webcam and retry, or play with the mouse or keyboard.");
      else if (name === "NotReadableError") showError("CAMERA IN USE", "Another app is using the camera. Close it and retry, or play with the mouse or keyboard.");
      else if (name === "NotSupportedError") showError("CAMERA UNAVAILABLE", `${(err.message || "The camera needs HTTPS or localhost.")} You can still play with the mouse or keyboard.`);
      else showError("CAMERA ERROR", "The camera could not start. Retry, or play with the mouse or keyboard.");
      return;
    }
    if (stale()) return;

    camBox.hidden = false;
    setChip("LOADING", "is-warn");
    updateSafeRect();
    showLoading("LOADING HAND TRACKER", "The first time, a small model (about 8 MB) is downloaded. Your camera is on.");
    const trk = new HandTracker(video, {
      onPoint: (u, v) => { if (!stale()) { pq.push(u * W, v * H, 0); cursorOn = true; } },
      onFound: () => {
        if (stale()) return;
        handPresent = true;
        handSeen = true;
        setChip("TRACKING", "is-ok");
      },
      onLost: () => {
        if (stale()) return;
        handPresent = false;
        lostSince = performance.now();
        pq.length = 0;
        cursorOn = false;
        renderer.setCursor(0, 0, false);
        breakStroke();
        endDwell();
        setChip("NO HAND", "is-bad");
      },
      onLandmarks: (lm) => { if (!stale()) drawPreview(lm); },
      onError: () => {
        if (stale()) return;
        stopCamera();
        showError("HAND TRACKING STOPPED", "The tracker stopped responding. Retry, or continue with the mouse or keyboard.");
      }
    });
    try {
      await withTimeout(trk.init(), MODEL_TIMEOUT_MS, "Hand tracker took too long to load.");
    } catch (err) {
      trk.destroy();
      if (stale()) return;
      stopCamera();
      showError("HAND TRACKER FAILED TO LOAD", "The hand model could not be downloaded. Check your connection and retry, or play with the mouse or keyboard.");
      return;
    }
    if (stale()) { trk.destroy(); return; }
    tracker = trk;
    trk.setActive(true); // full rate right away: the "raise your hand" screen needs the same responsiveness as play
    trk.start();
    setChip("NO HAND", "is-bad");
    afterInputReady();
  }


  function cameraLost() {
    stopCamera();
    showError("CAMERA DISCONNECTED", "The camera stopped sending video. Reconnect it and retry, or continue with the mouse or keyboard.");
  }

  function drawPreview(lm) {
    dctx.clearRect(0, 0, 128, 96);
    if (!lm) return;
    dctx.lineWidth = 2;
    dctx.strokeStyle = "rgba(39,244,255,.9)";
    dctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      dctx.moveTo(lm[a].x * 128, lm[a].y * 96);
      dctx.lineTo(lm[b].x * 128, lm[b].y * 96);
    }
    dctx.stroke();
    dctx.fillStyle = "#ff3ccf";
    dctx.beginPath();
    dctx.arc(lm[INDEX_TIP].x * 128, lm[INDEX_TIP].y * 96, 4.5, 0, Math.PI * 2);
    dctx.fill();
  }

  // After the camera + tracker (or pointer mode) are ready: resume an interrupted round, or start a new one.
  function afterInputReady() {
    if (engine.status === Status.PLAYING) startCountdown("resume");
    else beginNewRun();
  }

  function startPointerMode() {
    stopCamera();
    useCamera = false;
    sfx.unlock();
    kbActive = false;
    cursorOn = false;
    afterInputReady();
  }

  // ---------- Run lifecycle ----------
  function resetHud() {
    shownScore = -1; shownCombo = 0;
    scoreEl.textContent = "0";
    comboEl.className = "fn-combo";
    comboEl.textContent = "";
    buildLives();
    renderLives(rules.lives);
    refreshBest();
    renderMute();
  }

  function beginNewRun() {
    clearTimeout(overTimer);
    engine.reset();
    renderer.clearEffects();
    breakStroke();
    finalized = false;
    resetHud();
    hud.hidden = false;
    if (useCamera && !handPresent) { showReady(); return; }
    startCountdown("new");
  }

  function startCountdown(kind) {
    phase = "countdown";
    countKind = kind;
    countLeft = kind === "resume" ? 2 : 3;
    countAcc = 0;
    hud.hidden = false;
    setOverlay("");
    setBanner("");
    setCount(String(countLeft));
    sfx.tick();
    if (tracker) tracker.setActive(true);
  }

  function endCountdown() {
    setCount("GO!", "go");
    sfx.go();
    later(() => { if (countEl.textContent === "GO!") setCount(""); }, 600);
    if (countKind === "new") engine.start();
    phase = "playing";
    last = performance.now();
    hintUntil = performance.now() + 4800;
    setBanner(controlHint(), "is-hint");
  }

  let finalized = false;
  function finishRun() {
    if (finalized) return;
    finalized = true;
    prevBest = records.getBest(GAME_ID);
    lastResult = records.submitScore(GAME_ID, engine.score); // saved once, only if it beats the stored best
    refreshBest();
    phase = "over";
    setBanner("");
    sfx.over();
    clearTimeout(overTimer);
    overTimer = later(() => { if (!destroyed && phase === "over") showOver(lastResult); }, 900);
    if (tracker) tracker.setActive(false);
  }

  function pause() {
    if (phase !== "playing" && phase !== "countdown" && phase !== "handlost") return;
    kb.keys.clear(); // a key released while the window was unfocused must not leave the blade drifting
    setCount("");
    breakStroke();
    renderer.clearTrail();
    showPause();
    if (tracker) tracker.setActive(false);
  }

  function resume() {
    if (phase !== "paused") return;
    setOverlay("");
    breakStroke();
    startCountdown(engine.status === Status.READY ? "new" : "resume"); // paused during the opening countdown
  }

  function enterHandLost() {
    phase = "handlost";
    breakStroke();
    setBanner("HAND LOST. SHOW YOUR HAND TO CONTINUE", "is-bad");
  }

  // ---------- Input: points -> trail + slicing ----------
  function breakStroke() {
    hasLast = false;
  }

  function consume(x, y) {
    if (hasLast) {
      const dx = x - lastX, dy = y - lastY, d2 = dx * dx + dy * dy;
      if (d2 < 2.25) return; // resting: no new trail point, no slice
      const jump = input.jumpFraction * Math.max(W, H);
      if (d2 > jump * jump) hasLast = false; // teleport (tracking glitch / re-entry): start a fresh stroke
    }
    if (phase !== "paused") renderer.addTrailPoint(x, y, !hasLast); // frozen visuals while paused: no trail
    if (hasLast && phase === "playing") engine.slash(lastX, lastY, x, y);
    lastX = x; lastY = y;
    hasLast = true;
  }

  function drainPoints() {
    for (let i = 0; i < pq.length; i += 3) {
      const x = pq[i], y = pq[i + 1];
      consume(x, y);
      if (useCamera && (phase === "ready" || phase === "handlost")) {
        const t = performance.now();
        if (t - readyAt > input.readyWindowMs) readyStreak = 0; // too long since the last detection: start counting again
        readyAt = t;
      }
      if (useCamera && phase === "ready" && ++readyStreak >= input.readyFrames) { pq.length = 0; startCountdown("new"); return; }
      if (useCamera && phase === "handlost" && ++readyStreak >= input.readyFrames) {
        pq.length = 0;
        startCountdown("resume");
        return;
      }
    }
    pq.length = 0;
  }

  function moveKeyboard(dt) {
    const k = kb.keys;
    let ax = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
    let ay = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
    const speed = input.keyboardSpeed * W * (k.has("boost") ? 1.9 : 1);
    if (ax && ay) { ax *= 0.7071; ay *= 0.7071; }
    const ease = 1 - Math.exp(-dt * 18);
    kb.vx += (ax * speed - kb.vx) * ease;
    kb.vy += (ay * speed * (H / W) * 1.4 - kb.vy) * ease;
    if (Math.abs(kb.vx) < 1 && Math.abs(kb.vy) < 1 && !ax && !ay) { kb.vx = kb.vy = 0; return; }
    kb.x = Math.max(0, Math.min(W, kb.x + kb.vx * dt));
    kb.y = Math.max(0, Math.min(H, kb.y + kb.vy * dt));
    kbActive = true;
    pq.push(kb.x, kb.y, 0);
  }

  const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ShiftLeft: "boost", ShiftRight: "boost" };

  listen(window, "keydown", (e) => {
    if (e.code === "Escape") {
      e.preventDefault();
      if (phase === "playing" || phase === "countdown" || phase === "handlost") pause();
      else if (phase === "paused") resume();
      else if (phase === "loading") act("cancel");
      else act("exit");
      return;
    }
    if (e.code === "KeyP" && phase !== "intro" && phase !== "over") {
      e.preventDefault();
      if (phase === "paused") resume(); else pause();
      return;
    }
    const dir = KEYMAP[e.code];
    if (!dir || useCamera || e.ctrlKey || e.metaKey || e.altKey) return;
    if (phase === "playing" || phase === "countdown") {
      e.preventDefault(); // keep arrows from scrolling the page behind the cabinet
      if (!kbActive && !kb.keys.size) { kb.x = hasLast ? lastX : W / 2; kb.y = hasLast ? lastY : H / 2; breakStroke(); }
      kb.keys.add(dir);
      kbActive = true;
    }
  });
  listen(window, "keyup", (e) => {
    const dir = KEYMAP[e.code];
    if (dir) kb.keys.delete(dir);
  });

  function pointerPoints(e) {
    const r = canvas.getBoundingClientRect();
    const sx = W / (r.width || W), sy = H / (r.height || H);
    const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
    const evs = list && list.length ? list : [e];
    for (const ev of evs) pq.push((ev.clientX - r.left) * sx, (ev.clientY - r.top) * sy, 0);
  }
  listen(canvas, "pointerdown", (e) => {
    if (useCamera) return;
    e.preventDefault();
    sfx.unlock();
    kbActive = false;
    cursorOn = false;
    breakStroke();
    if (e.pointerType !== "mouse") try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointerPoints(e);
  });
  listen(canvas, "pointermove", (e) => {
    if (useCamera) return; // in camera mode the mouse never slices
    if (e.pointerType !== "mouse" && !(e.buttons & 1)) return;
    if (kbActive) { kbActive = false; kb.keys.clear(); cursorOn = false; renderer.setCursor(0, 0, false); breakStroke(); }
    pointerPoints(e);
  });
  const endPointer = () => { if (!useCamera) breakStroke(); };
  listen(canvas, "pointerup", endPointer);
  listen(canvas, "pointercancel", endPointer);
  listen(canvas, "pointerleave", endPointer);
  listen(document, "visibilitychange", () => { if (document.hidden) pause(); });
  listen(window, "blur", () => pause());

  // ---------- Hands-free menu buttons: hold the fingertip over one ----------
  function endDwell() {
    if (dwellEl) { dwellEl.classList.remove("is-dwell"); dwellEl.style.removeProperty("--dwell"); }
    dwellEl = null;
  }

  function updateMenuCursor(now) {
    const menu = !overlay.hidden && useCamera && handPresent && hasLast;
    pointerEl.hidden = !menu;
    if (!menu) { endDwell(); return; }
    pointerEl.style.transform = `translate(${lastX}px, ${lastY}px)`;
    let hit = null;
    for (const b of btnRects) if (lastX >= b.x && lastX <= b.x + b.w && lastY >= b.y && lastY <= b.y + b.h) { hit = b.el; break; }
    if (hit !== dwellEl) {
      endDwell();
      dwellEl = hit;
      dwellStart = now;
      if (hit) hit.classList.add("is-dwell");
    }
    if (dwellEl && now > dwellCool) {
      const p = Math.min(1, (now - dwellStart) / input.dwellMs);
      dwellEl.style.setProperty("--dwell", p.toFixed(3));
      if (p >= 1) {
        const action = dwellEl.dataset.act;
        dwellCool = now + 900;
        endDwell();
        act(action);
      }
    }
  }

  // ---------- Events from the engine ----------
  function onEngineEvent(ev) {
    renderer.handleEvent(ev);
    switch (ev.type) {
      case "slice": sfx.slice(ev.combo); break;
      case "combo": sfx.combo(ev.count); break;
      case "bomb": sfx.bomb(); break;
      case "miss": sfx.miss(); break;
      case "life": sfx.life(); break;
      case "over": finishRun(); break;
      default: break;
    }
  }

  function updateHud(now) {
    if (engine.score !== shownScore) {
      shownScore = engine.score;
      scoreEl.textContent = String(shownScore);
      scoreEl.classList.remove("pop");
      void scoreEl.offsetWidth;
      scoreEl.classList.add("pop");
    }
    renderLives(engine.lives);
    const c = engine.comboTimer > 0 && engine.comboCount >= 2 ? engine.comboCount : 0;
    if (c !== shownCombo) {
      shownCombo = c;
      if (c) {
        comboEl.textContent = `COMBO ×${c}`;
        comboEl.className = "fn-combo is-on";
        void comboEl.offsetWidth;
        comboEl.classList.add("pop");
      } else comboEl.className = "fn-combo";
    }
    if (phase === "playing") {
      if (useCamera && handSeen && !handPresent) setBanner("HAND NOT DETECTED", "is-bad");
      else if (hintUntil && now < hintUntil) setBanner(controlHint(), "is-hint");
      else setBanner("");
    }
  }

  // ---------- Main loop (single rAF chain) ----------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (phase === "paused") {
      if (pq.length) drainPoints();
      renderer.render(engine, now);
      if (useCamera) updateMenuCursor(now);
      return;
    }

    if (!useCamera && (phase === "playing" || phase === "countdown")) moveKeyboard(dt);
    if (pq.length) {
      if (phase !== "intro" && phase !== "loading" && phase !== "error") drainPoints(); else pq.length = 0;
    }
    if (useCamera && hasLast && cursorOn) renderer.setCursor(lastX, lastY, phase !== "over" && overlay.hidden);
    else if (!useCamera && kbActive && hasLast) renderer.setCursor(lastX, lastY, true);
    else renderer.setCursor(0, 0, false);

    if (phase === "countdown") {
      countAcc += dt;
      if (countAcc >= 1) {
        countAcc -= 1;
        if (--countLeft <= 0) endCountdown();
        else { setCount(String(countLeft)); sfx.tick(); }
      }
    }
    if (phase === "playing" || phase === "over") {
      engine.update(dt);
      engine.drainEvents(onEngineEvent);
      if (phase === "playing") {
        if (useCamera && handSeen && !handPresent && now - lostSince > input.handPauseMs) { enterHandLost(); readyStreak = 0; }
      }
      updateHud(now);
    } else if (phase === "handlost") {
      updateHud(now);
    }
    renderer.update(dt);
    renderer.render(engine, now);
    if (useCamera) updateMenuCursor(now);
    else if (!pointerEl.hidden) pointerEl.hidden = true;
  }
  raf = requestAnimationFrame(frame);

  // ---------- Buttons ----------
  listen(root, "click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b && root.contains(b)) act(b.dataset.act);
  });

  function act(name) {
    if (destroyed) return;
    if (name !== "exit") sfx.unlock();
    switch (name) {
      case "start":
      case "retry": startCameraSession(); break;
      case "pointer": startPointerMode(); break;
      case "cancel": stopCamera(); engine.reset(); showIntro(); break;
      case "pause": pause(); break;
      case "resume": resume(); break;
      case "restart": beginNewRun(); break; // reuses the live camera + tracker: no new stream or loop
      case "mute": sfx.setMuted(!sfx.muted); renderMute(); break;
      case "exit": onExit(); break;
      default: break;
    }
  }

  buildLives();
  renderMute();
  refreshBest();
  showIntro();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      clearTimeout(overTimer);
      stopCamera(); // tracker inference stops, landmarker is closed, every MediaStreamTrack is stopped
      ro.disconnect();
      for (const fn of cleanups.splice(0)) fn();
      sfx.destroy();
      renderer.dispose();
      pq.length = 0;
      btnRects = [];
      root.remove();
    }
  };
}
