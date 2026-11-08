# Neon Arcade

A neon arcade cabinet (vanilla HTML/CSS/JS, native ES modules, no build step). Pick a game with the joystick, press the button, and it plays **inside the cabinet screen** on `index.html`.

## Run

ES modules and the camera need http(s), not `file://`:

```
python -m http.server 8000      # then open http://localhost:8000
```
(or VS Code Live Server, or deploy the folder as-is to Netlify.) Camera access works on `localhost` and HTTPS.

## Structure

```text
index.html, styles.css          original cabinet page + styling (kept)
src/main.js                     entry point
src/home/HomeScreen.js          joystick/button wiring, screen contents, scroll effect
src/home/gameRegistry.js        ordered game list: id, copy, artwork, instructions, lazy loader
src/components/                 Joystick, ArcadeButton, GameLauncher, PersonalRecords, PlaceholderGame
src/services/recordsStore.js    localStorage personal bests (namespaced, validated)
src/services/cameraManager.js   the only place a webcam stream is opened/closed
src/games/flappy-bird/          Blink Bird: FlappyGame, gameEngine, renderer, blinkDetection, config, flappy.css
src/games/fruit-ninja/          Fruit Ninja
src/games/rock-paper-scissors/  Rock Paper Scissors: best of 3, camera gestures or R/P/S keys (rules.js, handGesture.js, rps.css)
assets/                         cabinet art + assets/games/flappy-bird/bird.svg
assets/vendor/mediapipe/        MediaPipe tasks-vision 0.10 bundle + wasm (local)
tests/blink.test.mjs            `node tests/blink.test.mjs` - blink state machine + engine
```

## Adding a game
Add an entry to `gameRegistry.js` and export `createGame({ container, records, camera, onExit, game }) -> { destroy() }` from the game's module. `destroy()` must stop its loops, listeners, timers and camera; the launcher also releases the camera on every exit.

## Blink Bird
- Blink once = one flap. Eyes held shut never repeats (closures over 700 ms are ignored until the eyes reopen). Tunables are in `games/flappy-bird/config.js`.
- Fallback: Space / ↑ / tap. Escape pauses (or exits from menus).
- The camera starts only after **Start Game**. The Face Landmarker *model file* is fetched from Google's official URL on first use (library + wasm are local).

## Personal records
Stored with `localStorage` keys `neonArcade.records.v1.<game-id>`, one per game, saved only when a finished score beats the stored best. They persist across refreshes and restarts, but are per-browser and per-origin: clearing site data, private browsing, or opening the site from a different address (e.g. `localhost` vs a deployed URL) starts from zero.

## Fruit Ninja (webcam hand tracking)

Lives in `src/games/fruit-ninja/` (engine, renderer, sprites, hand tracker, sfx, css) with hero art in
`assets/games/fruit-ninja/hero.svg`. Registered in `src/home/gameRegistry.js` with `screen: "wide"`, which makes the
cabinet screen larger while the game runs (see the "Wide screen mode" block in `src/styles/arcade-ui.css`; tune
`--wide-aspect` / `--wide-chrome`). Any other game can opt in with the same one-line flag.

- Camera is requested only after START GAME (video only). Mouse / touch / keyboard (arrows or WASD, Shift = dash) fallback.
- The hand model file is downloaded from Google's MediaPipe host on first use, then cached for the page session.
- Tests: `node tests/fruit-ninja.test.mjs` (logic) and `python3 tests/fruit-ninja.e2e.py` (browser, stubbed model;
  **known to be flaky/unfinished**, results varied between runs).
- Not yet verified: real webcam + real MediaPipe model tracking quality on a physical device.
