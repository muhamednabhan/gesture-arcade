// Shows one game at a time inside the cabinet screen. Owns mount/unmount so every exit path
// (Back button, Escape, pause menu) runs the same cleanup.

const loadedStyles = new Set();
function ensureStyles(href) {
  if (!href || loadedStyles.has(href)) return Promise.resolve();
  loadedStyles.add(href);
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = link.onerror = () => resolve(); // never block gameplay on CSS
    document.head.appendChild(link);
  });
}

export class GameLauncher {
  constructor({ screen, stage, homeView, records, camera, onChange }) {
    this.screen = screen;
    this.stage = stage;
    this.homeView = homeView;
    this.records = records;
    this.camera = camera;
    this.onChange = onChange || (() => {});
    this.instance = null;
    this.activeGame = null;
    this.token = 0;
    this.launching = false;
  }

  get busy() {
    return this.activeGame !== null || this.launching;
  }

  async launch(game) {
    if (this.busy) return;
    this.launching = true;
    if (window.pauseArcadeAmbience) window.pauseArcadeAmbience();
    const token = ++this.token;
    this.activeGame = game;
    this.screen.classList.add("is-playing");
    this.homeView.inert = true;
    this.stage.hidden = false;
    this.stage.innerHTML = '<div class="stage-loading" role="status">LOADING…</div>';
    this.onChange(game);
    try {
      const [mod] = await Promise.all([game.load(), ensureStyles(game.styles)]);
      if (token !== this.token) return; // exited while loading
      this.stage.innerHTML = "";
      this.instance = mod.createGame({
        container: this.stage,
        records: this.records,
        camera: this.camera,
        game,
        onExit: () => this.exit()
      });
    } catch (err) {
      console.error(`Failed to load ${game.id}`, err);
      if (token === this.token) {
        this.stage.innerHTML = '<div class="stage-loading is-bad" role="alert">COULD NOT LOAD GAME<br><small>Serve over http(s), not file://</small></div>';
        setTimeout(() => token === this.token && this.exit(), 2200);
      }
    } finally {
      this.launching = false;
    }
  }

  exit() {
    if (!this.activeGame) return;
    this.token++; // invalidates any in-flight load
    const game = this.activeGame;
    try {
      if (this.instance) this.instance.destroy(); // stops loops, listeners, timers, camera
    } finally {
      this.instance = null;
      this.camera.release(); // safety net: the camera is never left on after exit
      this.stage.innerHTML = "";
      this.stage.hidden = true;
      this.homeView.inert = false;
      this.screen.classList.remove("is-playing");
      this.activeGame = null;
      this.launching = false;
      this.onChange(null, game);
    }
  }
}
