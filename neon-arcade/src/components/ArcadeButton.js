export class ArcadeButton {
  constructor({ el, onPress }) {
    this.el = el;
    this.guard = false;
    el.addEventListener("click", () => {
      if (this.guard) return;
      this.guard = true;
      el.classList.add("is-pressed");
      onPress();
      setTimeout(() => { this.guard = false; el.classList.remove("is-pressed"); }, 450);
    });
  }
}
