import { GAMES } from "./gameRegistry.js";
import { Joystick } from "../components/Joystick.js";
import { ArcadeButton } from "../components/ArcadeButton.js";
import { GameLauncher } from "../components/GameLauncher.js";
import { PersonalRecords } from "../components/PersonalRecords.js";
import { recordsStore } from "../services/recordsStore.js";
import { cameraManager } from "../services/cameraManager.js";

const $ = (id) => document.getElementById(id);

export function initHome() {
  const cabinet = document.querySelector(".cabinet");
  const screen = document.querySelector(".screen-glass");
  const el = {
    view: $("gameView"), title: $("gameTitle"), desc: $("gameDescription"), howto: $("gameHowto"),
    eyebrow: $("gameEyebrow"), status: $("gameStatus"), art: $("gameArt"), index: $("gameIndex"),
    short: $("gameShort"), toast: $("toast"), start: $("startButton")
  };

  let selected = 0;
  let toastTimer = 0;
  let changeTimer = 0;

  const toast = (msg) => {
    el.toast.textContent = msg;
    el.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("is-visible"), 1700);
  };

  const coinTutorial = $("coinTutorial");
  const joystickTutorial = $("joystickTutorial");
  const tutorialGameSetup = $("tutorialGameSetup");
  let tutorialTimer = 0;
  const setupHints = {
    "flappy-bird": "Blink to flap; Space / Up Arrow are backups.",
    "fruit-ninja": "Swipe your fingertip through fruit to slice.",
    "rock-paper-scissors": "Show rock, paper, or scissors to the camera.",
    "pong": "Close your fist and move it to control the bat."
  };
  function showTutorial() {
    if (!coinTutorial || !joystickTutorial) return;
    tutorialGameSetup.textContent = `${GAMES[selected].name}: ${setupHints[GAMES[selected].id] || GAMES[selected].instructions}`;
    coinTutorial.hidden = false;
    joystickTutorial.hidden = false;
    document.body.classList.add("tutorial-active");
    clearTimeout(tutorialTimer);
    tutorialTimer = setTimeout(hideTutorial, 14000);
  }
  function hideTutorial() {
    coinTutorial?.setAttribute("hidden", "");
    joystickTutorial?.setAttribute("hidden", "");
    document.body.classList.remove("tutorial-active");
    clearTimeout(tutorialTimer);
  }
  $("dismissTutorial")?.addEventListener("click", hideTutorial);
  // Keep the game-specific hint current while the user browses after returning home.
  const tutorialOriginalSelect = null;

  const records = new PersonalRecords({ valueEl: $("personalBestValue"), records: recordsStore });

  const launcher = new GameLauncher({
    screen, stage: $("gameStage"), homeView: el.view, records: recordsStore, camera: cameraManager,
    onChange: (game) => {
      cabinet.classList.toggle("is-in-game", !!game);
      if (game && game.screen) cabinet.dataset.screen = game.screen; else delete cabinet.dataset.screen;
      if (!game) {
        records.show(GAMES[selected].id);
        el.start.focus({ preventScroll: true });
        // Show the short controls tutorial on returning from gameplay, never over a running game.
        showTutorial();
      }
    }
  });

  // Only the screen contents change: the cabinet element itself is never touched.
  function select(index, { announce = true } = {}) {
    selected = (index + GAMES.length) % GAMES.length;
    const game = GAMES[selected];
    if (document.body.classList.contains("tutorial-active") && tutorialGameSetup) {
      tutorialGameSetup.textContent = `${game.name}: ${setupHints[game.id] || game.instructions}`;
    }
    el.view.classList.add("is-changing");
    cabinet.style.setProperty("--selected-accent", game.accent);
    records.show(game.id);
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      el.title.innerHTML = game.title;
      el.desc.textContent = game.description;
      el.howto.textContent = game.instructions;
      el.eyebrow.innerHTML = `${game.eyebrow} <span>✦</span> ${String(selected + 1).padStart(3, "0")}`;
      el.status.textContent = game.status;
      el.art.innerHTML = "";
      const img = document.createElement("img");
      img.src = game.art;
      img.alt = game.alt;
      img.draggable = false;
      el.art.appendChild(img);
      el.art.setAttribute("aria-label", game.alt);
      el.index.textContent = String(selected + 1).padStart(2, "0");
      el.short.textContent = game.short;
      el.view.classList.remove("is-changing");
      cabinet.classList.remove("is-flashing");
      void cabinet.offsetWidth;
      cabinet.classList.add("is-flashing");
      setTimeout(() => cabinet.classList.remove("is-flashing"), 420);
      if (announce) toast(`${game.name} SELECTED`);
    }, 160);
  }

  const blocked = () => toast("EXIT THE GAME TO SWITCH");

  const changeGame = (dir) => {
    if (launcher.busy) launcher.exit(); // stops game loops and releases camera before switching
    select(selected + dir);
  };
  new Joystick({
    knob: $("joystick"), stem: $("joystickStem"),
    onSelect: changeGame,
    isEnabled: () => true,
    onBlocked: blocked
  });
  $("previousGame").addEventListener("click", () => changeGame(-1));
  $("nextGame").addEventListener("click", () => changeGame(1));

  new ArcadeButton({
    el: el.start,
    onPress: () => {
      if (!coinInserted) { toast("INSERT YOUR COIN FIRST"); return; }
      if (launcher.busy) { blocked(); return; }
      launcher.launch(GAMES[selected]); // whichever game is selected, in the same screen
    }
  });

  // One-credit arcade: the coin is a one-time gate for this page session.
  const coinToken = $("coinToken"), coinSlot = $("coinSlot"), coinRack = document.querySelector(".coin-rack");
  const coinInstruction = $("coinInstruction"), coinCredit = $("coinCredit");
  let coinInserted = false, draggingCoin = null, dragMoved = false;
  el.start.disabled = true;
  el.start.setAttribute("aria-disabled", "true");
  const insertCoin = () => {
    if (coinInserted) return;
    coinInserted = true;
    // Freeze every nonessential ambient effect as soon as the credit is accepted.
    if (window.pauseArcadeAmbience) window.pauseArcadeAmbience();
    document.body.classList.add("has-credit", "performance-mode");
    coinSlot.classList.add("coin-slot--accepted");
    coinRack.classList.add("coin-rack--used");
    coinToken.classList.add("coin-token--used");
    coinToken.disabled = true;
    coinInstruction.textContent = "CREDIT ACCEPTED";
    coinCredit.textContent = "1 / 1 CREDIT";
    el.start.disabled = false;
    el.start.setAttribute("aria-disabled", "false");
    toast("CREDIT ACCEPTED · READY TO PLAY");
  };
  coinToken.addEventListener("pointerdown", (event) => {
    if (coinInserted || event.button !== 0) return;
    event.preventDefault();
    dragMoved = false;
    const rect = coinToken.getBoundingClientRect();
    draggingCoin = coinToken.cloneNode(true);
    draggingCoin.removeAttribute("id");
    draggingCoin.className = "coin-token coin-token--dragging";
    draggingCoin.style.left = `${rect.left}px`;
    draggingCoin.style.top = `${rect.top}px`;
    draggingCoin.style.width = `${rect.width}px`;
    draggingCoin.style.height = `${rect.height}px`;
    document.body.appendChild(draggingCoin);
    coinToken.classList.add("coin-token--picked");
    coinRack.classList.add("coin-rack--dragging");
  });
  document.addEventListener("pointermove", (event) => {
    if (!draggingCoin) return;
    dragMoved = true;
    draggingCoin.style.left = `${event.clientX - draggingCoin.offsetWidth / 2}px`;
    draggingCoin.style.top = `${event.clientY - draggingCoin.offsetHeight / 2}px`;
    const r = coinSlot.getBoundingClientRect();
    coinSlot.classList.toggle("coin-slot--target", event.clientX >= r.left - 24 && event.clientX <= r.right + 24 && event.clientY >= r.top - 24 && event.clientY <= r.bottom + 24);
  });
  document.addEventListener("pointerup", (event) => {
    if (!draggingCoin) return;
    const r = coinSlot.getBoundingClientRect();
    const dropped = event.clientX >= r.left - 24 && event.clientX <= r.right + 24 && event.clientY >= r.top - 24 && event.clientY <= r.bottom + 24;
    draggingCoin.remove(); draggingCoin = null;
    coinToken.classList.remove("coin-token--picked");
    coinRack.classList.remove("coin-rack--dragging");
    coinSlot.classList.remove("coin-slot--target");
    if (dropped) insertCoin();
  });
  coinToken.addEventListener("click", () => { if (!coinInserted && !dragMoved) insertCoin(); dragMoved = false; });
  coinToken.addEventListener("dragstart", (event) => event.preventDefault());

  // Scroll-driven camera approach (unchanged behaviour).
  const scrollRun = document.querySelector(".scroll-run");
  let ticking = false;
  const approach = () => {
    const rect = scrollRun.getBoundingClientRect();
    const travel = Math.max(1, scrollRun.offsetHeight - window.innerHeight);
    const p = Math.max(0, Math.min(1, -rect.top / travel));
    document.documentElement.style.setProperty("--approach", p.toFixed(4));
    ticking = false;
  };
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(approach); } }, { passive: true });
  window.addEventListener("resize", approach);
  approach();

  select(0, { announce: false });

  // Lightweight boot screen: wait for fonts and visible game art to be ready before interaction.
  const bootLoader = $("bootLoader");
  const bootAssets = [...document.querySelectorAll(".corner-art img, #gameArt img")].map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); });
  });
  const minimumBootTime = new Promise((resolve) => setTimeout(resolve, 3600));
  const assetsReady = Promise.race([
    Promise.all([document.fonts?.ready || Promise.resolve(), ...bootAssets]),
    new Promise((resolve) => setTimeout(resolve, 4200))
  ]);
  Promise.all([minimumBootTime, assetsReady]).then(() => {
    if (!bootLoader) return;
    bootLoader.classList.add("boot-loader--done");
    setTimeout(() => bootLoader.remove(), 420);
  });
  return { launcher };
}
