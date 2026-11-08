// Rock Paper Scissors: best of three vs CPU. Camera gestures (or R/P/S keys, or buttons) pick your move.
// destroy() clears every timer, listener, tracker and the camera.
import { MOVES, WIN_ROUNDS, judge, randomMove, pickMove } from "./rules.js";
import { GestureTracker, preload } from "./handGesture.js";

const ICONS = {
  rock: '<svg viewBox="0 0 64 64"><path d="M16 30c0-4 3-6 6-5 1-4 6-5 9-3 3-2 8-1 9 3 4-1 8 1 8 6v11c0 9-7 15-16 15s-16-6-16-14z"/><path class="ln" d="M22 30v6M31 28v7M40 28v7M49 31v5"/></svg>',
  paper: '<svg viewBox="0 0 64 64"><path d="M18 36V17a3 3 0 016 0v14-18a3 3 0 016 0v18-16a3 3 0 016 0v16-12a3 3 0 016 0v26c0 10-7 17-16 17-8 0-14-5-17-12l-6-11a3 3 0 015-3z"/></svg>',
  scissors: '<svg viewBox="0 0 64 64"><path d="M22 6l9 26-5 2-10-24a3 3 0 016-4zM42 6l-9 26 5 2 10-24a3 3 0 00-6-4z"/><path d="M20 34h24c4 0 6 3 6 7v5c0 9-7 14-18 14s-18-5-18-14v-5c0-4 2-7 6-7z"/></svg>'
};
const QUESTION = '<svg viewBox="0 0 64 64"><text x="32" y="46" text-anchor="middle" font-size="44" font-weight="900" font-family="Orbitron,sans-serif">?</text></svg>';
const LABEL = { rock: "ROCK", paper: "PAPER", scissors: "SCISSORS" };
const KEYS = { KeyR: "rock", Digit1: "rock", KeyP: "paper", Digit2: "paper", KeyS: "scissors", Digit3: "scissors" };

const WORD_MS = 420, SHOW_MS = 850, RESULT_MS = 1400, GAP_MS = 150, WORDS = ["ROCK", "PAPER", "SCISSORS"];

export function createGame({ container, records, camera, onExit, game }) {
  const root = document.createElement("div");
  root.className = "rps";
  root.innerHTML = `
    <div class="rps-top">
      <div class="rps-side" data-side="you"><span>YOU</span><b data-score="you">0</b><i data-pips="you"></i></div>
      <div class="rps-mid"><small>BEST OF 3</small><em data-round>ROUND 1</em><small data-best></small></div>
      <div class="rps-side" data-side="cpu"><span>CPU</span><b data-score="cpu">0</b><i data-pips="cpu"></i></div>
    </div>
    <div class="rps-arena">
      <div class="rps-hand rps-you"><video muted playsinline hidden></video><div class="rps-icon" data-icon="you">${QUESTION}</div><span class="rps-tag" data-tag="you">YOU</span></div>
      <div class="rps-center"><div class="rps-big" data-big></div><div class="rps-msg" data-msg></div></div>
      <div class="rps-hand rps-cpu"><div class="rps-icon" data-icon="cpu">${QUESTION}</div><span class="rps-tag">CPU</span></div>
    </div>
    <div class="rps-bar">
      <div class="rps-moves">${MOVES.map((m) => `<button type="button" class="rps-mv" data-move="${m}" aria-label="${LABEL[m]}">${ICONS[m]}<span>${LABEL[m]}</span></button>`).join("")}</div>
      <div class="rps-hint" data-hint></div>
    </div>
    <div class="rps-overlay" hidden></div>
    <button type="button" class="rps-exit" data-act="exit" aria-label="Return to arcade">✕</button>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const el = {
    video: $("video"), big: $("[data-big]"), msg: $("[data-msg]"), hint: $("[data-hint]"), round: $("[data-round]"),
    best: $("[data-best]"), overlay: $(".rps-overlay"), youIcon: $('[data-icon="you"]'), cpuIcon: $('[data-icon="cpu"]'),
    youTag: $('[data-tag="you"]'), arena: $(".rps-arena")
  };
  const moveBtns = [...root.querySelectorAll(".rps-mv")];

  let destroyed = false, session = 0, tracker = null, useCamera = false;
  let phase = "intro"; // intro | loading | idle | count | show | result | over
  let you = 0, cpu = 0, round = 1, streak = 0, samples = [], manual = null, live = null, liveAt = 0;
  const timers = new Set(), cleanups = [];
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms); timers.add(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  const listen = (t, ty, fn, o) => { t.addEventListener(ty, fn, o); cleanups.push(() => t.removeEventListener(ty, fn, o)); };

  const setIcon = (side, m, cls = "") => {
    const n = side === "you" ? el.youIcon : el.cpuIcon;
    n.innerHTML = m ? ICONS[m] : QUESTION;
    n.className = "rps-icon " + (m ? "is-" + m : "") + " " + cls;
  };
  const hl = (m) => moveBtns.forEach((b) => b.classList.toggle("is-on", b.dataset.move === m));
  const renderScore = () => {
    root.querySelector('[data-score="you"]').textContent = you;
    root.querySelector('[data-score="cpu"]').textContent = cpu;
    for (const [s, v] of [["you", you], ["cpu", cpu]])
      root.querySelector(`[data-pips="${s}"]`).innerHTML = Array.from({ length: WIN_ROUNDS }, (_, k) => `<u class="${k < v ? "on" : ""}"></u>`).join("");
    el.round.textContent = phase === "over" ? "FINAL" : "ROUND " + round;
    const b = records.getBest(game.id);
    el.best.textContent = b ? "BEST STREAK " + b : "";
  };
  const big = (t, cls = "") => { el.big.className = "rps-big " + cls; el.big.textContent = t; if (t) { void el.big.offsetWidth; el.big.classList.add("pop"); } };
  const msg = (t, cls = "") => { el.msg.className = "rps-msg " + cls; el.msg.textContent = t; };

  // ---- overlay screens ----
  const btn = (act, label, c = "") => `<button type="button" class="rps-btn ${c}" data-act="${act}" ${c.includes("primary") ? "data-primary" : ""}>${label}</button>`;
  const setOverlay = (html) => {
    el.overlay.innerHTML = html || "";
    el.overlay.hidden = !html;
    const p = el.overlay.querySelector("[data-primary]");
    if (p) p.focus({ preventScroll: true });
  };
  const showIntro = () => {
    phase = "intro"; clearTimers(); big(""); msg("");
    setOverlay(`<div class="rps-panel"><p class="rps-kick">VERSUS MODE</p><h2>ROCK PAPER SCISSORS</h2>
      <p>Best of three. Each round counts down <b>ROCK · PAPER · SCISSORS</b> — show your move on <b>SHOOT!</b> Your first move locks in. If you show nothing, the CPU wins the round.</p>
      <div class="rps-actions">${btn("camera", "PLAY WITH CAMERA", "primary")}${btn("keys", "PLAY WITH KEYS / TAPS")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div>
      <p class="rps-small">Keys: R · P · S</p></div>`);
  };
  const showError = (title, text) => {
    phase = "intro"; clearTimers(); stopCamera();
    setOverlay(`<div class="rps-panel"><h2>${title}</h2><p>${text}</p><div class="rps-actions">${btn("camera", "RETRY", "primary")}${btn("keys", "PLAY WITH KEYS / TAPS")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div></div>`);
  };
  const showOver = (won) => {
    phase = "over"; renderScore();
    setOverlay(`<div class="rps-panel ${won ? "is-win" : "is-lose"}"><p class="rps-kick">MATCH OVER</p><h2>${won ? "YOU WIN!" : "CPU WINS"}</h2>
      <div class="rps-final"><span>${you}</span><i>–</i><span>${cpu}</span></div>
      ${won && streak > 1 ? `<p>Win streak: <b>${streak}</b></p>` : ""}
      <div class="rps-actions">${btn("again", "PLAY AGAIN", "primary")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div></div>`);
  };

  // ---- camera ----
  function stopCamera() {
    session++;
    if (tracker) { tracker.destroy(); tracker = null; }
    camera.release(el.video);
    el.video.hidden = true;
    root.classList.remove("has-cam");
  }
  async function startCamera() {
    root.classList.remove("camera-preview-hidden");
    document.body.classList.remove("camera-preview-hidden");
    useCamera = true; phase = "loading";
    const mine = ++session, stale = () => destroyed || mine !== session;
    setOverlay(`<div class="rps-panel"><p class="rps-kick">LOADING</p><h2>STARTING CAMERA…</h2><p>Allow camera access. Loading hand tracker.</p></div>`);
    preload();
    try {
      await camera.acquire(el.video, { onEnded: () => { if (!stale()) showError("CAMERA LOST", "The camera was disconnected."); } });
    } catch (e) {
      if (stale()) return;
      camera.release(el.video);
      const n = e && e.name;
      return showError(n === "NotAllowedError" ? "CAMERA BLOCKED" : n === "NotFoundError" ? "NO CAMERA FOUND" : "CAMERA UNAVAILABLE",
        n === "NotAllowedError" ? "Allow camera access, then retry — or play with keys." : "Retry, or play with keys / taps.");
    }
    if (stale()) return;
    const trk = new GestureTracker(el.video, { onGesture: onGesture, onError: () => { if (!stale()) showError("TRACKING STOPPED", "Hand tracking failed. Retry or use keys."); } });
    try {
      await Promise.race([trk.init(), new Promise((_, rj) => setTimeout(() => rj(new Error("timeout")), 45000))]);
    } catch {
      trk.destroy();
      if (!stale()) showError("TRACKER FAILED TO LOAD", "Check your connection and retry, or play with keys.");
      return;
    }
    if (stale()) { trk.destroy(); return; }
    tracker = trk;
    el.video.hidden = false;
    root.classList.add("has-cam");
    trk.start();
    beginMatch();
  }

  let streakG = null, streakN = 0;
  function onGesture(g, t) {
    live = g; liveAt = t;
    if (phase === "show" && !manual) {
      streakN = g && g === streakG ? streakN + 1 : g ? 1 : 0; streakG = g;
      hl(g); el.hint.textContent = g ? "DETECTED: " + LABEL[g] : "SHOW YOUR HAND";
      if (streakN >= 3) choose(g); // stable for 3 frames -> locked, no changing
      else samples.push({ g, t });
    }
  }

  // ---- match flow ----
  let countLeft = 0;
  function beginMatch() {
    root.classList.remove("camera-preview-hidden");
    document.body.classList.remove("camera-preview-hidden");
    you = cpu = 0; round = 1; renderScore();
    setOverlay("");
    startRound();
  }
  function startRound() {
    phase = "count"; samples = []; manual = null; hl(null);
    setIcon("you", null); setIcon("cpu", null);
    el.arena.classList.remove("is-win", "is-lose", "is-tie");
    renderScore(); msg("");
    el.hint.textContent = useCamera ? "SHOW YOUR MOVE ON “SHOOT!” — FIRST MOVE LOCKS" : "PRESS R · P · S OR TAP ON “SHOOT!” — FIRST MOVE LOCKS";
    countLeft = 3;
    tick();
  }
  function tick() {
    if (countLeft > 0) {
      const i = 3 - countLeft;
      big(WORDS[i], "count"); setIcon("you", null);
      later(() => { countLeft--; tick(); }, WORD_MS);
    } else {
      phase = "show"; streakG = null; streakN = 0; samples = [];
      big("SHOOT!", "show"); msg(manual ? "LOCKED" : "");
      later(resolveRound, SHOW_MS);
    }
  }
  // First choice wins: once locked it cannot be changed.
  function choose(m) {
    if (manual || (phase !== "show" && !(phase === "count" && countLeft === 0))) return;
    manual = m; hl(m); setIcon("you", m, "pending"); msg("LOCKED: " + LABEL[m]);
    el.hint.textContent = "LOCKED — WAIT FOR THE CPU";
  }
  function resolveRound() {
    const mine = manual || pickMove(samples, 2);
    phase = "result";
    const theirs = randomMove(); // CPU always reveals when time is up
    const r = mine ? judge(mine, theirs) : -1; // no move = CPU wins the round
    setIcon("you", mine, mine ? (r > 0 ? "win" : r < 0 ? "lose" : "") : "lose"); setIcon("cpu", theirs, r < 0 ? "win" : r > 0 ? "lose" : "");
    el.arena.classList.add(r > 0 ? "is-win" : r < 0 ? "is-lose" : "is-tie");
    if (r > 0) you++; else if (r < 0) cpu++; else round--; // ties replay without using a round
    big(r > 0 ? "YOU WIN" : r < 0 ? "CPU WINS" : "TIE", r > 0 ? "good" : r < 0 ? "bad" : "");
    msg(!mine ? "NO MOVE — CPU takes it" : r === 0 ? "Same move — replay" : `${LABEL[r > 0 ? mine : theirs]} beats ${LABEL[r > 0 ? theirs : mine]}`);
    hl(null); renderScore();
    if (you >= WIN_ROUNDS || cpu >= WIN_ROUNDS) {
      const won = you > cpu;
      streak = won ? streak + 1 : 0;
      if (won) { const rec = records.submitScore(game.id, streak); if (rec.isNewRecord) msg("NEW BEST STREAK " + streak + "!"); }
      later(() => showOver(won), RESULT_MS);
    } else {
      round++;
      later(() => { big(""); later(startRound, GAP_MS); }, RESULT_MS);
    }
  }

  // ---- input ----
  listen(root, "click", (e) => {
    const mv = e.target.closest("[data-move]");
    if (mv) return choose(mv.dataset.move);
    const a = e.target.closest("[data-act]");
    if (!a) return;
    switch (a.dataset.act) {
      case "camera": startCamera(); break;
      case "keys": stopCamera(); useCamera = false; beginMatch(); break;
      case "again": streak = streak; beginMatch(); break;
      case "exit": onExit(); break;
    }
  });
  listen(window, "keydown", (e) => {
    if (e.code === "Escape") { e.preventDefault(); return onExit(); }
    const m = KEYS[e.code];
    if (m && !e.repeat) choose(m);
  });
  listen(document, "visibilitychange", () => { if (document.hidden && (phase === "count" || phase === "show")) { clearTimers(); startRound(); } });

  renderScore();
  showIntro();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimers();
      cleanups.forEach((f) => f());
      if (tracker) { tracker.destroy(); tracker = null; }
      camera.release(el.video);
      root.remove();
    }
  };
}
