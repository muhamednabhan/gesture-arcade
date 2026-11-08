// Knuckle Pong: closed fist (knuckles) slides the bat left/right in real time. Each side has 3 lives;
// the first to miss three times loses. destroy() clears the loop, timers, listeners, tracker and camera.
import { GestureTracker, preload } from "../rock-paper-scissors/handGesture.js";
import { PongAI } from "./ai.js";

const LIVES = 3, COUNT_FIRST = 3, COUNT_NEXT = 2;
const MARGIN = 0.16; // central part of the camera frame maps to the full width so edges are reachable

export function createGame({ container, records, camera, onExit, game }) {
  const root = document.createElement("div");
  root.className = "pg";
  root.innerHTML = `
    <canvas class="pg-canvas"></canvas>
    <video class="pg-video" muted playsinline hidden></video>
    <span class="pg-chip" hidden></span>
    <div class="pg-hud"><div class="pg-lives" data-l="you"></div><div class="pg-mid"><b data-rt>0</b><small>RETURNS</small></div><div class="pg-lives" data-l="cpu"></div></div>
    <div class="pg-big" data-big></div>
    <div class="pg-overlay" hidden></div>
    <button type="button" class="pg-exit" data-act="exit" aria-label="Return to arcade">✕</button>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const canvas = $(".pg-canvas"), ctx = canvas.getContext("2d"), video = $(".pg-video"), chip = $(".pg-chip"),
    big = $("[data-big]"), overlay = $(".pg-overlay"), rtEl = $("[data-rt]");

  let destroyed = false, session = 0, tracker = null, useCamera = false, raf = 0, last = 0;
  let phase = "intro"; // intro | loading | count | play | over
  let W = 300, H = 200, S = 200;
  let lives = { you: LIVES, cpu: LIVES }, returns = 0, pending = null;
  let fist = false, fistAt = 0, targetX = 0.5;
  let hard = false;
  const px = { x: 0 }, ai = new PongAI(), aiX = { x: 0 };
  const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 8, speed: 0, trail: [] };
  const timers = new Set(), cleanups = [];
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms); timers.add(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  const listen = (t, ty, fn, o) => { t.addEventListener(ty, fn, o); cleanups.push(() => t.removeEventListener(ty, fn, o)); };

  const pw = () => W * 0.2, ph = () => Math.max(8, H * 0.035), yAI = () => H * 0.17, yYou = () => H * 0.91;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = w * d; canvas.height = h * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const oldW = W; W = w; H = h; S = Math.min(w, h);
    ball.r = Math.max(6, S * 0.03);
    px.x = px.x ? px.x * W / oldW : W / 2; aiX.x = aiX.x ? aiX.x * W / oldW : W / 2;
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ---------- UI ----------
  const hearts = () => ["you", "cpu"].forEach((s) => {
    $(`[data-l="${s}"]`).innerHTML = `<span>${s === "you" ? "YOU" : "CPU"}</span>` +
      Array.from({ length: LIVES }, (_, i) => `<i class="${i < lives[s] ? "on" : ""}"></i>`).join("");
  });
  const say = (t, cls = "") => { big.className = "pg-big " + cls; big.textContent = t; if (t) { void big.offsetWidth; big.classList.add("pop"); } };
  const btn = (act, label, c = "") => `<button type="button" class="pg-btn ${c}" data-act="${act}" ${c.includes("primary") ? "data-primary" : ""}>${label}</button>`;
  const setOverlay = (html) => { overlay.innerHTML = html || ""; overlay.hidden = !html; const p = overlay.querySelector("[data-primary]"); if (p) p.focus({ preventScroll: true }); };
  const showIntro = () => {
    phase = "intro"; clearTimers(); say("");
    setOverlay(`<div class="pg-panel"><p class="pg-kick">RETRO CLASSIC</p><h2>KNUCKLE PONG</h2>
      <p>Close your fist and slide it left / right to move your bat. <b>Miss 3 times and you lose.</b> A countdown starts each serve.</p>
      <div class="pg-mode"><button type="button" class="pg-btn ${hard ? "" : "sel"}" data-act="easy">EASY</button><button type="button" class="pg-btn ${hard ? "sel" : ""}" data-act="hard">HARD</button></div>
      <p class="pg-small">${hard ? "Faster ball, sharper CPU that rarely misses." : "Relaxed speed, CPU misses now and then."}</p>
      <div class="pg-actions">${btn("camera", "PLAY WITH CAMERA", "primary")}${btn("keys", "MOUSE / ← → KEYS")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div></div>`);
  };
  const showError = (title, text) => {
    phase = "intro"; clearTimers(); stopCamera();
    setOverlay(`<div class="pg-panel"><h2>${title}</h2><p>${text}</p><div class="pg-actions">${btn("camera", "RETRY", "primary")}${btn("keys", "MOUSE / ← → KEYS")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div></div>`);
  };
  const showOver = (won) => {
    phase = "over"; say("");
    const rec = records.submitScore(game.id, returns);
    setOverlay(`<div class="pg-panel ${won ? "" : "is-lose"}"><p class="pg-kick">GAME OVER · ${hard ? "HARD" : "EASY"}</p><h2>${won ? "YOU WIN!" : "CPU WINS"}</h2>
      <div class="pg-final"><span>${lives.you}</span><i>–</i><span>${lives.cpu}</span></div><p>Lives left · Returns <b>${returns}</b>${rec.isNewRecord ? " · NEW BEST!" : rec.best ? " · Best " + rec.best : ""}</p>
      <div class="pg-actions">${btn("again", "PLAY AGAIN", "primary")}${btn("exit", "RETURN TO ARCADE", "ghost")}</div></div>`);
  };

  // ---------- camera ----------
  function stopCamera() {
    session++;
    if (tracker) { tracker.destroy(); tracker = null; }
    camera.release(video); video.hidden = true; chip.hidden = true; fist = false;
  }
  async function startCamera() {
    root.classList.remove("camera-preview-hidden");
    document.body.classList.remove("camera-preview-hidden");
    useCamera = true; phase = "loading";
    const mine = ++session, stale = () => destroyed || mine !== session;
    setOverlay(`<div class="pg-panel"><p class="pg-kick">LOADING</p><h2>STARTING CAMERA…</h2><p>Allow camera access. Loading hand tracker.</p></div>`);
    preload();
    try { await camera.acquire(video, { onEnded: () => { if (!stale()) showError("CAMERA LOST", "The camera was disconnected."); } }); }
    catch (e) {
      if (stale()) return;
      camera.release(video);
      return showError(e && e.name === "NotAllowedError" ? "CAMERA BLOCKED" : "CAMERA UNAVAILABLE", "Retry, or play with the mouse / ← → keys.");
    }
    if (stale()) return;
    const trk = new GestureTracker(video, { onGesture, onError: () => { if (!stale()) showError("TRACKING STOPPED", "Hand tracking failed. Retry or use the mouse.") } });
    try { await Promise.race([trk.init(), new Promise((_, rj) => setTimeout(() => rj(new Error("timeout")), 45000))]); }
    catch { trk.destroy(); if (!stale()) showError("TRACKER FAILED TO LOAD", "Check your connection and retry, or use the mouse."); return; }
    if (stale()) { trk.destroy(); return; }
    tracker = trk; video.hidden = false; chip.hidden = false; trk.start();
    newMatch();
  }
  // Knuckle centre (landmarks 5, 9, 13, 17), mirrored like the preview, stretched across the width.
  function onGesture(g, t, lm) {
    fist = g === "rock";
    if (fist && lm) {
      const kx = (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4;
      targetX = Math.min(1, Math.max(0, (1 - kx - MARGIN) / (1 - 2 * MARGIN)));
      fistAt = t;
    }
    chip.textContent = fist ? "FIST ✊ TRACKING" : g ? "CLOSE YOUR FIST" : "SHOW YOUR FIST";
    chip.className = "pg-chip " + (fist ? "ok" : "warn");
  }

  // ---------- match flow ----------
  function newMatch() {
    ai.hard = hard; ai.streak = 0;
    lives = { you: LIVES, cpu: LIVES }; returns = 0; rtEl.textContent = 0; hearts(); setOverlay("");
    serve(COUNT_FIRST);
  }
  function serve(n) {
    phase = "count"; ball.trail.length = 0; ball.vx = ball.vy = 0; ball.x = W / 2; ball.y = H / 2;
    const step = (k) => {
      if (k > 0) { say(String(k), "count"); later(() => step(k - 1), 1000); }
      else { say("GO!", "go"); later(() => say(""), 500); launch(); }
    };
    step(n);
  }
  function launch() {
    phase = "play";
    ball.speed = H * (hard ? 0.75 : 0.5);
    const dir = pending === "cpu" ? 1 : pending === "you" ? -1 : Math.random() < 0.5 ? -1 : 1; // toward the side that just missed
    const a = (Math.random() * 2 - 1) * 0.5;
    ball.vx = ball.speed * Math.sin(a); ball.vy = dir * ball.speed * Math.cos(a);
    pending = null;
    if (ball.vy < 0) ai.plan();
  }
  function miss(side) {
    lives[side]--; hearts(); phase = "count"; ball.vx = ball.vy = 0;
    say(side === "you" ? "MISS!" : "CPU MISSED!", side === "you" ? "bad" : "good");
    pending = side === "you" ? "cpu" : "you"; // serve toward the side that just missed
    root.classList.add("flash"); later(() => root.classList.remove("flash"), 300);
    if (lives[side] <= 0) return void later(() => showOver(side === "cpu"), 1400);
    later(() => serve(COUNT_NEXT), 1200);
  }

  // ---------- simulation ----------
  function hit(isYou, py) {
    const p = isYou ? px.x : aiX.x, off = Math.max(-1, Math.min(1, (ball.x - p) / (pw() / 2)));
    ball.speed = Math.min(H * (hard ? 1.8 : 1.25), ball.speed * (hard ? 1.07 : 1.05));
    const a = off * 1.0; // up to ~57°
    ball.vx = ball.speed * Math.sin(a); ball.vy = (isYou ? -1 : 1) * ball.speed * Math.cos(a);
    ball.y = isYou ? py - ph() / 2 - ball.r : py + ph() / 2 + ball.r;
    if (isYou) { returns++; rtEl.textContent = returns; ai.plan(); }
  }
  function step(dt) {
    // bat follows the fist in real time
    if (useCamera) { const goal = targetX * W; px.x += (goal - px.x) * (1 - Math.exp(-dt * 30)); }
    else px.x += (targetX * W - px.x) * (1 - Math.exp(-dt * 30));
    px.x = Math.min(W - pw() / 2, Math.max(pw() / 2, px.x));
    // AI
    const tgt = ai.target(ball, yAI(), W, pw());
    const max = W * (phase === "play" ? 1.0 : 0.6) * (ai.speedMul || 1) * (ball.speed ? Math.max(0.7, ball.speed / (H * (hard ? 0.75 : 0.5))) : 1) * dt;
    const goal = phase === "play" && ball.vy < 0 ? tgt : W / 2;
    aiX.x += Math.max(-max, Math.min(max, goal - aiX.x));
    aiX.x = Math.min(W - pw() / 2, Math.max(pw() / 2, aiX.x));
    if (phase !== "play") return;
    const n = Math.max(1, Math.ceil(Math.hypot(ball.vx, ball.vy) * dt / (ball.r * 0.8))), h = dt / n;
    for (let i = 0; i < n; i++) {
      const py0 = ball.y;
      ball.x += ball.vx * h; ball.y += ball.vy * h;
      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      else if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
      const reach = pw() / 2 + ball.r;
      if (ball.vy > 0 && py0 + ball.r <= yYou() - ph() / 2 && ball.y + ball.r >= yYou() - ph() / 2 && Math.abs(ball.x - px.x) <= reach) { hit(true, yYou()); continue; }
      if (ball.vy < 0 && py0 - ball.r >= yAI() + ph() / 2 && ball.y - ball.r <= yAI() + ph() / 2 && Math.abs(ball.x - aiX.x) <= reach) { hit(false, yAI()); continue; }
      if (ball.y > H + ball.r * 2) return miss("you");
      if (ball.y < -ball.r * 2) return miss("cpu");
    }
    ball.trail.push({ x: ball.x, y: ball.y }); if (ball.trail.length > 10) ball.trail.shift();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "#ff9d2e55"; ctx.lineWidth = 2; ctx.setLineDash([S * 0.04, S * 0.04]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.setLineDash([]);
    const bat = (x, y, c) => { ctx.shadowColor = c; ctx.shadowBlur = S * 0.04; ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(x - pw() / 2, y - ph() / 2, pw(), ph(), ph() / 2); ctx.fill(); };
    bat(aiX.x, yAI(), "#ff3ca6"); bat(px.x, yYou(), "#25eaff");
    ball.trail.forEach((p, i) => { ctx.globalAlpha = i / ball.trail.length * 0.4; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, ball.r * (i / ball.trail.length), 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1; ctx.shadowColor = "#fff"; ctx.shadowBlur = S * 0.05; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.033, (t - (last || t)) / 1000); last = t;
    step(dt); draw();
  }
  raf = requestAnimationFrame(frame);

  // ---------- input ----------
  const keys = new Set();
  let keyRaf = 0;
  const keyMove = () => { if (keys.size && !useCamera) { targetX = Math.min(1, Math.max(0, targetX + ((keys.has("r") ? 1 : 0) - (keys.has("l") ? 1 : 0)) * 0.025)); } keyRaf = requestAnimationFrame(keyMove); };
  keyRaf = requestAnimationFrame(keyMove);
  listen(window, "keydown", (e) => {
    if (e.code === "Escape") { e.preventDefault(); return onExit(); }
    if (e.code === "ArrowLeft" || e.code === "KeyA") keys.add("l"); if (e.code === "ArrowRight" || e.code === "KeyD") keys.add("r");
  });
  listen(window, "keyup", (e) => { if (e.code === "ArrowLeft" || e.code === "KeyA") keys.delete("l"); if (e.code === "ArrowRight" || e.code === "KeyD") keys.delete("r"); });
  const pointer = (e) => { if (useCamera) return; const r = canvas.getBoundingClientRect(); targetX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  listen(canvas, "pointermove", pointer); listen(canvas, "pointerdown", pointer);
  listen(root, "click", (e) => {
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (a.dataset.act === "easy" || a.dataset.act === "hard") { hard = a.dataset.act === "hard"; showIntro(); }
    else if (a.dataset.act === "camera") startCamera();
    else if (a.dataset.act === "keys") { stopCamera(); useCamera = false; newMatch(); }
    else if (a.dataset.act === "again") newMatch();
    else if (a.dataset.act === "exit") onExit();
  });
  listen(document, "visibilitychange", () => { if (document.hidden && phase === "play") { clearTimers(); serve(COUNT_NEXT); } });

  hearts(); showIntro();
  return {
    destroy() {
      if (destroyed) return; destroyed = true;
      cancelAnimationFrame(raf); cancelAnimationFrame(keyRaf); clearTimers(); ro.disconnect();
      cleanups.forEach((f) => f());
      if (tracker) { tracker.destroy(); tracker = null; }
      camera.release(video); root.remove();
    }
  };
}
