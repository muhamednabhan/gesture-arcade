// Stand-in screen for games whose gameplay isn't built yet. Same contract as a real game module,
// so swapping in the real implementation only means replacing the game's own file.
export function createPlaceholderGame({ container, onExit, game }) {
  const root = document.createElement("div");
  root.className = "placeholder-game";
  root.innerHTML = `
    <p class="ph-kicker">${game.eyebrow}</p>
    <h2 class="ph-title">${game.title}</h2>
    <p class="ph-text">Gameplay for this cabinet slot is coming in a later phase.<br>Your personal best is stored separately and is ready.</p>
    <button type="button" class="ph-btn">BACK TO ARCADE</button>`;
  container.appendChild(root);
  const btn = root.querySelector(".ph-btn");
  const onClick = () => onExit();
  const onKey = (e) => { if (e.code === "Escape") { e.preventDefault(); onExit(); } };
  btn.addEventListener("click", onClick);
  window.addEventListener("keydown", onKey);
  btn.focus({ preventScroll: true });
  return {
    destroy() {
      btn.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      root.remove();
    }
  };
}
