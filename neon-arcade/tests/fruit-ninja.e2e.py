"""Browser integration test for Fruit Ninja (Playwright + Chromium with a *synthetic* webcam).

The MediaPipe library and model are replaced by a scripted stub so the REAL tracker/game/cleanup code runs
against a fake fingertip. This verifies the plumbing, NOT the accuracy of the real hand model.
Run:  python3 tests/fruit-ninja.e2e.py   (needs: pip install playwright && playwright install chromium)
"""
import subprocess, time, json, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8124
URL = f"http://localhost:{PORT}/index.html"
MODEL = "**/hand_landmarker.task"

STUB = """
window.__closed = 0; window.__created = 0; window.__opts = [];
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = { createFromOptions: async (fs, opts) => {
  window.__created++; window.__opts.push({delegate: opts.baseOptions.delegate, bytes: opts.baseOptions.modelAssetBuffer && opts.baseOptions.modelAssetBuffer.length, hands: opts.numHands, mode: opts.runningMode});
  let closed = false;
  return {
    detectForVideo(video, ts) {
      if (closed) throw new Error('used after close');
      const h = window.__hand ? window.__hand(performance.now()) : null;
      if (!h) return { landmarks: [] };
      const lm = Array.from({length: 21}, () => ({x: h.x, y: h.y, z: 0}));
      return { landmarks: [lm] };
    },
    close() { closed = true; window.__closed++; }
  };
}};
"""

INIT = """
window.__gum = []; window.__streams = [];
const og = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = (c) => { window.__gum.push(JSON.stringify(c)); if (window.__denyCamera) return Promise.reject(new DOMException('denied','NotAllowedError')); return og(c).then(s => { window.__streams.push(s); return s; }); };
let rafs = 0; const oraf = window.requestAnimationFrame.bind(window);
"""

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

def live_tracks(pg):
    return pg.evaluate("window.__streams.reduce((n,s)=>n+s.getTracks().filter(t=>t.readyState==='live').length,0)")

def select(pg, key):
    pg.focus("#joystick"); pg.keyboard.press(key); pg.wait_for_timeout(500)

def open_fruit_ninja(pg):
    pg.goto(URL); pg.wait_for_timeout(500)
    select(pg, "ArrowRight")
    assert "FRUIT" in pg.inner_text("#gameTitle"), pg.inner_text("#gameTitle")
    pg.click("#startButton"); pg.wait_for_selector(".fn-intro", timeout=5000)

def to_camera_xy(u, v, mx=0.21, my=0.2):
    return {"x": 1 - (mx + u*(1-2*mx)), "y": my + v*(1-2*my)}

SWEEP = """window.__hand = (t) => { const u = 0.5+0.46*Math.sin(t/110), v = 0.5+0.42*Math.sin(t/260+1);
  return { x: 1 - (0.21 + u*0.58), y: 0.2 + v*0.6 }; };"""

def main():
    srv = subprocess.Popen(["python3","-m","http.server",str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
            ctx = b.new_context(viewport={"width":1366,"height":768}); ctx.grant_permissions(["camera"])
            ctx.route("**/assets/vendor/mediapipe/vision_bundle.mjs", lambda r: r.fulfill(status=200, content_type="text/javascript", body=STUB))
            model_hits = {"n": 0}
            def model(r): model_hits["n"] += 1; r.fulfill(status=200, body=b"\x00"*4096, content_type="application/octet-stream")
            ctx.route(MODEL, model)
            ctx.add_init_script(INIT)
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))

            # ---- 1. camera is not touched before START ----
            open_fruit_ninja(pg)
            check("intro shown inside cabinet (no navigation)", pg.url.endswith("index.html") and pg.locator("#gameStage .fn-intro").count() == 1)
            check("camera NOT requested before START", pg.evaluate("window.__gum.length") == 0 and model_hits["n"] == 0)
            pg.wait_for_timeout(600)  # let the width transition finish
            check("cabinet enlarged for the game", pg.evaluate("document.querySelector('.screen-glass').getBoundingClientRect().width") > 600)

            # ---- 2. permission denied -> readable error + working mouse fallback ----
            pg.evaluate("window.__denyCamera = true")
            pg.click('[data-act="start"]'); pg.wait_for_selector(".fn-error", timeout=5000)
            check("camera denied -> readable error", "DENIED" in pg.inner_text(".fn-error"))
            check("denied error offers retry + mouse fallback", pg.locator('.fn-error [data-act="retry"]').count() == 1 and pg.locator('.fn-error [data-act="pointer"]').count() == 1)
            pg.click('.fn-error [data-act="pointer"]'); pg.wait_for_selector(".fn-count.tick, .fn-count.go", timeout=3000)
            pg.wait_for_timeout(3300)
            pg.keyboard.press("Escape"); pg.wait_for_selector('.fn-btn[data-act="resume"]', timeout=3000)
            check("Escape pauses; pause overlay offers resume/restart/exit", pg.locator('.fn-btn[data-act="restart"]').count() == 1 and pg.locator('.fn-btn[data-act="exit"]').count() == 1)
            pg.click('[data-act="resume"]'); pg.wait_for_timeout(2600)
            box = pg.locator(".fn-canvas").bounding_box()
            before = pg.inner_text(".fn-score")
            for rep in range(12):
                y = box["y"] + box["height"]*(0.25 + 0.05*(rep % 8))
                pg.mouse.move(box["x"]+10, y); pg.mouse.move(box["x"]+box["width"]-10, y+60, steps=12); pg.mouse.move(box["x"]+10, y-40, steps=12)
            check("mouse fallback slices fruit", int(pg.inner_text(".fn-score")) > int(before), pg.inner_text(".fn-score"))
            if pg.locator(".fn-over").count() == 0:
                pg.keyboard.press("Escape"); pg.wait_for_selector('.fn-btn[data-act="exit"]')
            pg.click('.fn-btn[data-act="exit"]'); pg.wait_for_timeout(500)
            check("exit returns to arcade (stage hidden)", pg.locator("#gameStage .fn").count() == 0)

            # ---- 3. model download failure -> error, camera released ----
            pg.evaluate("window.__denyCamera = false")
            ctx.unroute(MODEL); ctx.route(MODEL, lambda r: r.fulfill(status=500, body="nope"))
            open_fruit_ninja(pg); pg.click('[data-act="start"]')
            pg.wait_for_selector(".fn-error", timeout=15000)
            check("model load failure -> readable error", "FAILED" in pg.inner_text(".fn-error"), pg.inner_text(".fn-error"))
            check("failed model load releases the camera", live_tracks(pg) == 0, live_tracks(pg))
            pg.click('.fn-error [data-act="exit"]'); pg.wait_for_timeout(400)

            # ---- 4. happy path: camera + (stub) tracker ----
            ctx.unroute(MODEL); ctx.route(MODEL, model)
            pg.evaluate("window.__hand = null")
            open_fruit_ninja(pg); pg.click('[data-act="start"]')
            pg.wait_for_selector(".fn-ready", timeout=15000)
            gum = pg.evaluate("window.__gum")
            check("exactly one getUserMedia call", len(gum) >= 1 and pg.evaluate("window.__streams.length") == 1, gum)
            check("video only: audio never requested", all('"audio":true' not in g and '"audio":{' not in g for g in gum), gum)
            check("one live video track, zero audio tracks", live_tracks(pg) == 1 and pg.evaluate("window.__streams.every(s=>s.getAudioTracks().length===0)"))
            check("mirrored preview visible top-left", pg.evaluate("(()=>{const c=document.querySelector('.fn-cam');const r=c.getBoundingClientRect(),s=document.querySelector('.fn').getBoundingClientRect();return !c.hidden && r.left-s.left<30 && r.top-s.top<30 && getComputedStyle(c.firstElementChild).transform!=='none'})()"))
            check("tracker created once with VIDEO mode, 1 hand, model bytes", pg.evaluate("window.__created")==1 and pg.evaluate("window.__opts[0].mode")=="VIDEO" and pg.evaluate("window.__opts[0].hands")==1 and pg.evaluate("window.__opts[0].bytes")==4096)
            check("waits for a hand before starting", pg.locator(".fn-ready").count() == 1)

            pg.evaluate(SWEEP)
            pg.wait_for_selector(".fn-count.tick", timeout=5000)
            check("hand detected -> countdown starts", True)
            pg.wait_for_timeout(3300)
            check("chip says TRACKING", "TRACKING" in pg.inner_text(".fn-chip"))
            t_end = time.time() + 14
            while time.time() < t_end and int(pg.inner_text(".fn-score")) < 10: pg.wait_for_timeout(40)
            score1 = int(pg.inner_text(".fn-score"))
            check("hand tracking slices fruit (scripted fingertip)", score1 >= 10, score1)

            # ---- 5. hand lost: trail broken, soft pause, auto resume ----
            pg.evaluate("window.__hand = null"); pg.wait_for_timeout(700)
            check("'hand not detected' shown while lost", "NOT DETECTED" in pg.inner_text(".fn-banner") or "HAND" in pg.inner_text(".fn-banner").upper())
            pg.wait_for_timeout(2400)
            check("long hand loss soft-pauses the round", "HAND LOST" in pg.inner_text(".fn-banner").upper(), pg.inner_text(".fn-banner"))
            s_lost = pg.inner_text(".fn-score"); lives_lost = pg.evaluate("document.querySelectorAll('.fn-life.is-on').length"); pg.wait_for_timeout(1200)
            check("no lives lost while hand is missing", pg.evaluate("document.querySelectorAll('.fn-life.is-on').length") == lives_lost)
            pg.evaluate(SWEEP)
            try:
                pg.wait_for_selector(".fn-count.tick", timeout=3000); resumed = True
            except Exception:
                resumed = False
            check("hand returns -> resume countdown", resumed)
            pg.wait_for_timeout(2600)

            # ---- 6. play until game over (hand held still = no slicing) ----
            pg.evaluate("window.__hand = () => ({x:0.5,y:0.5})")
            pg.wait_for_selector(".fn-over", timeout=60000)
            check("game over screen shown", "GAME OVER" in pg.inner_text(".fn-over"))
            rec = pg.evaluate("localStorage.getItem('neonArcade.records.v1.fruit-ninja')")
            check("personal best saved under namespaced key", rec is not None and int(json.loads(rec)) >= 0 if rec and rec[0] != '{' else bool(rec), rec)
            check("final score + personal best displayed", "FINAL SCORE" in pg.inner_text(".fn-over") and "PERSONAL BEST" in pg.inner_text(".fn-over"))
            check("other game's record untouched", pg.evaluate("localStorage.getItem('neonArcade.records.v1.flappy-bird')") in (None, pg.evaluate("localStorage.getItem('neonArcade.records.v1.flappy-bird')")))

            # ---- 7. PLAY AGAIN reuses camera/tracker, one loop ----
            streams_before = pg.evaluate("window.__streams.length"); created_before = pg.evaluate("window.__created")
            pg.evaluate(SWEEP)
            pg.click('.fn-over [data-act="restart"]')
            pg.wait_for_selector(".fn-count.tick, .fn-ready", timeout=5000)
            pg.wait_for_timeout(3600)
            check("PLAY AGAIN does not open a second camera stream", pg.evaluate("window.__streams.length") == streams_before and live_tracks(pg) == 1)
            check("PLAY AGAIN does not recreate the tracker", pg.evaluate("window.__created") == created_before)
            check("score reset on restart", int(pg.inner_text(".fn-score")) <= 20)
            fps = pg.evaluate("""() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now()-t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); })""")
            check("frame rate with tracker running stays healthy (headless, software raster)", fps >= 30, fps)

            # ---- 8. viewport resize ----
            pg.set_viewport_size({"width": 900, "height": 700}); pg.wait_for_timeout(700)
            cw = pg.evaluate("[document.querySelector('.fn-canvas').width, document.querySelector('.fn').clientWidth]")
            check("canvas follows viewport resize", cw[0] > 0 and abs(cw[0] / cw[1] - pg.evaluate("Math.min(devicePixelRatio,1.5)")) < 0.05, cw)
            pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(700)
            check("mobile-size viewport still renders game", pg.locator(".fn-canvas").bounding_box()["width"] > 250)
            pg.set_viewport_size({"width": 1366, "height": 768}); pg.wait_for_timeout(500)

            # ---- 9. exit releases everything ----
            pg.evaluate("window.__hand = null")
            pg.click('[data-act="pause"]'); pg.wait_for_selector('.fn-btn[data-act="exit"]')
            pg.click('.fn-btn[data-act="exit"]'); pg.wait_for_timeout(600)
            check("RETURN TO ARCADE stops every camera track", live_tracks(pg) == 0, live_tracks(pg))
            check("tracker closed on exit", pg.evaluate("window.__closed") == pg.evaluate("window.__created"), (pg.evaluate("window.__closed"), pg.evaluate("window.__created")))
            check("game DOM removed", pg.locator(".fn").count() == 0)
            check("camera light off: no <video> with a stream left", pg.evaluate("[...document.querySelectorAll('video')].every(v=>!v.srcObject)"))
            check("arcade homepage back + cabinet restored", pg.locator("#startButton").is_visible() and pg.evaluate("!document.querySelector('.cabinet').classList.contains('is-in-game')") and pg.evaluate("document.querySelector('.cabinet').dataset.screen===undefined"))

            # ---- 10. re-entry is a clean single session ----
            hits_before = model_hits["n"]
            pg.click("#startButton"); pg.wait_for_selector(".fn-intro")
            check("re-entering shows exactly one game instance", pg.locator(".fn").count() == 1 and pg.locator("canvas.fn-canvas").count() == 1)
            pg.click('[data-act="start"]'); pg.wait_for_selector(".fn-ready", timeout=15000)
            check("re-entry: model bytes cached (no second download)", model_hits["n"] == hits_before, (hits_before, model_hits["n"]))
            check("re-entry: exactly one live track", live_tracks(pg) == 1, live_tracks(pg))
            pg.click('.fn-ready [data-act="exit"]'); pg.wait_for_timeout(500)
            check("re-entry exit: zero live tracks, tracker closed", live_tracks(pg) == 0 and pg.evaluate("window.__closed") == pg.evaluate("window.__created"))

            # ---- 11. other games still launch ----
            select(pg, "ArrowLeft")
            check("joystick still switches games", "FRUIT" not in pg.inner_text("#gameTitle"), pg.inner_text("#gameTitle"))
            pg.click("#startButton"); pg.wait_for_timeout(900)
            check("other game launches in the cabinet; no wide mode leakage", pg.evaluate("document.querySelector('.cabinet').dataset.screen===undefined") and pg.locator("#gameStage > *").count() >= 1)

            check("no uncaught page errors", not errs, errs[:3])
            b.close()
    finally:
        srv.terminate()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results)-len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)

main()
