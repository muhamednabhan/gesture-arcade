// Blink Bird: owns its DOM, canvas loop, camera session, listeners and timers.
// destroy() releases every one of them so switching games never leaks cameras, loops or handlers.
import { GAME_ID, physics as P } from "./config.js";
import { FlappyEngine, Status } from "./gameEngine.js";
import { FlappyRenderer } from "./renderer.js";
import { BlinkDetector, BlinkState } from "./blinkDetection.js";

const BIRD_ART = new URL("../../../assets/games/flappy-bird/bird.svg", import.meta.url).href;

const STATE_CLASS = {
  [BlinkState.CALIBRATING]: "is-warn",
  [BlinkState.READY]: "is-ok",
  [BlinkState.CLOSED]: "is-ok",
  [BlinkState.BLINK]: "is-hit",
  [BlinkState.NO_FACE]: "is-bad",
  [BlinkState.LOW_LIGHT]: "is-bad"
};

export function createGame({ container, records, camera, onExit }) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.createElement("div");
  root.className = "fb";
  root.innerHTML = `
    <canvas class="fb-canvas" aria-label="Blink Bird game"></canvas>
    <div class="fb-cam" hidden>
      <video class="fb-video" muted playsinline></video>
      <span class="fb-chip" role="status">CALIBRATING</span>
    </div>
    <div class="fb-hud" hidden>
      <div class="fb-score" aria-live="off">0</div>
      <div class="fb-topright"><span class="fb-best"></span><button class="fb-iconbtn" type="button" data-act="pause" aria-label="Pause">II</button></div>
      <div class="fb-hint"></div>
    </div>
    <div class="fb-overlay"></div>`;
  container.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const canvas = $(".fb-canvas"), camBox = $(".fb-cam"), video = $(".fb-video"), chip = $(".fb-chip");
  const hud = $(".fb-hud"), scoreEl = $(".fb-score"), bestEl = $(".fb-best"), hintEl = $(".fb-hint"), overlay = $(".fb-overlay");

  const renderer = new FlappyRenderer(canvas, { reducedMotion });
  const engine = new FlappyEngine(400);
  let phase = "intro"; // intro | loading | error | playing | paused | over
  let useCamera = false;
  let detector = null;
  let blinkState = BlinkState.CALIBRATING;
  let raf = 0, last = 0;
  let destroyed = false;
  let session = 0; // invalidates in-flight async camera/model work after exit, retry or restart
  let finalized = false;
  let overTimer = 0, overAt = 0, lastResult = null;
  const cleanups = [];

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---------- Layout ----------
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    engine.setWidth(renderer.resize(w, h));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------- Overlay screens ----------
  const setOverlay = (html) => {
    overlay.innerHTML = html || "";
    overlay.hidden = !html;
    const primary = overlay.querySelector("[data-primary]");
    if (primary) primary.focus({ preventScroll: true });
  };
  const btn = (act, label, cls = "") => `<button type="button" class="fb-btn ${cls}" data-act="${act}" ${cls.includes("primary") ? "data-primary" : ""}>${label}</button>`;

  const showIntro = () => {
    phase = "intro";
    hud.hidden = true;
    setOverlay(`
      <div class="fb-panel fb-intro">
        <div class="fb-intro-art"><img src="${BIRD_ART}" alt="" draggable="false"></div>
        <div class="fb-intro-copy">
          <h2 class="fb-title">BLINK<br><strong>BIRD</strong></h2>
          <p class="fb-desc">Blink to fly. Dodge the neon pipes. Beat your high score.</p>
          <ul class="fb-how">
            <li><b>BLINK</b> once: the bird flaps</li>
            <li>Holding your eyes shut does nothing</li>
            <li>No camera? <b>SPACE</b> / <b>↑</b> / tap</li>
          </ul>
          <div class="fb-actions">${btn("start", "START GAME", "primary")}${btn("exit", "BACK TO ARCADE", "ghost")}</div>
          <p class="fb-privacy">Camera starts only after you press Start. Video stays on this device.</p>
        </div>
      </div>`);
  };

  const showLoading = (msg, sub = "") => {
    phase = "loading";
    hud.hidden = true;
    setOverlay(`
      <div class="fb-panel fb-center">
        <div class="fb-spinner" aria-hidden="true"></div>
        <p class="fb-status">${msg}</p>
        <p class="fb-sub">${sub}</p>
        ${btn("cancel", "CANCEL", "ghost small")}
      </div>`);
  };

  const showError = (title, detail, { retry = true } = {}) => {
    phase = "error";
    hud.hidden = true;
    setOverlay(`
      <div class="fb-panel fb-center fb-error" role="alert">
        <p class="fb-status is-bad">${title}</p>
        <p class="fb-sub">${detail}</p>
        <div class="fb-actions">
          ${retry ? btn("retry", "RETRY CAMERA", "primary") : ""}
          ${btn("keyboard", "PLAY WITH KEYBOARD", retry ? "" : "primary")}
          ${btn("exit", "BACK TO ARCADE", "ghost")}
        </div>
      </div>`);
  };

  const showPause = () => {
    phase = "paused";
    setOverlay(`
      <div class="fb-panel fb-center">
        <p class="fb-status">PAUSED</p>
        <div class="fb-actions">
          ${btn("resume", "RESUME", "primary")}
          ${btn("restart", "RESTART")}
          ${btn("exit", "EXIT TO ARCADE", "ghost")}
        </div>
      </div>`);
  };

  const showOver = (result) => {
    phase = "over";
    $(".fb-iconbtn").hidden = true;
    overAt = performance.now() + 350; // short lockout so a stray blink/keypress can't skip the screen
    setOverlay(`
      <div class="fb-panel fb-center fb-over">
        <p class="fb-status is-bad">GAME OVER</p>
        ${result.isNewRecord ? '<p class="fb-newrecord">★ NEW RECORD ★</p>' : ""}
        <div class="fb-final"><span>SCORE</span><b>${engine.score}</b></div>
        <p class="fb-sub">PERSONAL BEST: ${result.best || "--"}</p>
        <div class="fb-actions">
          ${btn("restart", "PLAY AGAIN", "primary")}
          ${btn("exit", "BACK TO ARCADE", "ghost")}
        </div>
      </div>`);
  };

  // ---------- HUD ----------
  const refreshBest = () => {
    const best = records.getBest(GAME_ID);
    bestEl.textContent = best ? `BEST ${best}` : "BEST --";
  };
  const refreshHint = () => {
    if (phase !== "playing" || engine.status !== Status.READY) { hintEl.textContent = ""; return; }
    if (!useCamera) hintEl.textContent = "SPACE / ↑ / TAP TO FLY";
    else if (blinkState === BlinkState.READY || blinkState === BlinkState.BLINK || blinkState === BlinkState.CLOSED) hintEl.textContent = "BLINK TO FLY";
    else hintEl.textContent = blinkState + (blinkState === BlinkState.CALIBRATING ? "… LOOK AT CAMERA" : "");
  };
  const setBlinkState = (state) => {
    blinkState = state;
    chip.textContent = state;
    chip.className = `fb-chip ${STATE_CLASS[state] || ""}`;
    refreshHint();
  };

  // ---------- Camera + detector session ----------
  const stopCamera = () => {
    session++;
    if (detector) { detector.stop(); detector = null; }
    camera.release(video);
    camBox.hidden = true;
  };

  const startCameraSession = async () => {
    root.classList.remove("camera-preview-hidden");
    document.body.classList.remove("camera-preview-hidden");
    const mine = ++session;
    const stale = () => destroyed || mine !== session;
    useCamera = true;
    showLoading("REQUESTING CAMERA", "Allow camera access to blink-control the bird.");
    try {
      await camera.acquire(video, {
        onEnded: () => {
          if (stale()) return;
          pauseForCameraLoss();
        }
      });
    } catch (err) {
      if (stale() || (err && err.name === "AbortError")) return; // cameraManager already cleaned up
      camera.release(video);
      const name = err && err.name;
      if (name === "NotAllowedError" || name === "SecurityError") showError("CAMERA ACCESS DENIED", "Allow the camera in your browser's site settings, then retry. Or play with the keyboard.");
      else if (name === "NotFoundError" || name === "OverconstrainedError") showError("NO CAMERA FOUND", "Connect a webcam and retry, or play with the keyboard.");
      else if (name === "NotReadableError") showError("CAMERA IN USE", "Another app is using the camera. Close it and retry, or play with the keyboard.");
      else if (name === "NotSupportedError") showError("CAMERA UNAVAILABLE", (err.message || "Camera needs HTTPS or localhost.") + " You can still play with the keyboard.");
      else showError("CAMERA ERROR", "Could not start the camera. Retry, or play with the keyboard.");
      return;
    }
    if (stale()) return;

    camBox.hidden = false;
    setBlinkState(BlinkState.CALIBRATING);
    showLoading("LOADING FACE MODEL", "First load downloads a small model. Camera is on.");
    const d = new BlinkDetector(video, {
      onState: (s) => { if (!stale()) setBlinkState(s); },
      onBlink: () => {
        if (stale() || phase !== "playing") return;
        renderer.blinkUntil = performance.now() + 220;
        engine.jump();
      }
    });
    try {
      await d.init();
    } catch (err) {
      if (stale()) return;
      stopCamera();
      showError("FACE MODEL FAILED TO LOAD", "Check your connection and retry, or play with the keyboard.");
      return;
    }
    if (stale()) return;
    detector = d;
    beginRun();
    d.start();
  };

  const pauseForCameraLoss = () => {
    stopCamera();
    showError("CAMERA DISCONNECTED", "The camera stopped. Reconnect and retry, or continue with the keyboard.");
  };

  const startKeyboardMode = () => {
    stopCamera();
    useCamera = false;
    beginRun();
  };

  // ---------- Run lifecycle ----------
  const beginRun = () => {
    clearTimeout(overTimer);
    engine.reset();
    renderer.particles.length = 0;
    finalized = false;
    phase = "playing";
    $(".fb-iconbtn").hidden = false;
    scoreEl.textContent = "0";
    refreshBest();
    hud.hidden = false;
    setOverlay("");
    refreshHint();
    last = performance.now();
  };

  const finalizeRun = () => {
    if (finalized) return;
    finalized = true;
    const result = lastResult = records.submitScore(GAME_ID, engine.score); // saved immediately, only if higher
    refreshBest();
    clearTimeout(overTimer);
    overTimer = setTimeout(() => { if (!destroyed && phase === "playing") showOver(result); }, 650);
  };

  const pause = () => {
    if (phase !== "playing") return;
    showPause();
  };
  const resume = () => {
    if (phase !== "paused") return;
    phase = "playing";
    last = performance.now();
    if (engine.status === Status.DEAD && finalized) { showOver(lastResult); return; } // paused during the crash delay
    setOverlay("");
    refreshHint();
  };

  const jump = () => {
    if (phase === "playing") engine.jump();
  };

  // ---------- Main loop (single rAF chain) ----------
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (phase === "paused") return;
    const simulate = phase === "playing" || phase === "over" || phase === "intro" || phase === "loading" || phase === "error";
    if (simulate) {
      engine.update(dt);
      renderer.handleEvents(engine);
      renderer.update(dt);
      if (phase === "playing") {
        const s = String(engine.score);
        if (scoreEl.textContent !== s) {
          scoreEl.textContent = s;
          scoreEl.classList.remove("pop"); void scoreEl.offsetWidth; scoreEl.classList.add("pop");
        }
        if (engine.status === Status.PLAYING && hintEl.textContent) hintEl.textContent = "";
        if (engine.status === Status.DEAD) finalizeRun();
      }
    }
    renderer.render(engine, now);
  };
  last = performance.now();
  raf = requestAnimationFrame(frame);

  // ---------- Input ----------
  listen(overlay, "click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) act(b.dataset.act);
  });
  listen(hud, "click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) act(b.dataset.act);
  });
  listen(canvas, "pointerdown", (e) => { e.preventDefault(); jump(); });
  listen(window, "keydown", (e) => {
    if (e.repeat && (e.code === "Space" || e.code === "ArrowUp")) { e.preventDefault(); return; }
    if (e.code === "Space" || e.code === "ArrowUp") {
      if (phase === "playing") { e.preventDefault(); jump(); }
      else if (phase === "over" && performance.now() > overAt) { e.preventDefault(); act("restart"); }
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      if (phase === "playing") pause();
      else if (phase === "paused") resume();
      else if (phase === "loading") act("cancel");
      else act("exit");
    }
  });
  listen(document, "visibilitychange", () => { if (document.hidden) pause(); });
  listen(window, "blur", () => pause());

  function act(name) {
    switch (name) {
      case "start":
      case "retry": startCameraSession(); break;
      case "keyboard": startKeyboardMode(); break;
      case "cancel": stopCamera(); showIntro(); break;
      case "pause": pause(); break;
      case "resume": resume(); break;
      case "restart": beginRun(); break; // reuses the live camera + detector: no new stream or loop
      case "exit": onExit(); break;
    }
  }

  setBlinkState(BlinkState.CALIBRATING);
  refreshBest();
  showIntro();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(overTimer);
      stopCamera();
      ro.disconnect();
      for (const fn of cleanups.splice(0)) fn();
      root.remove();
    }
  };
}
