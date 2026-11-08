// Draggable arcade joystick. Mouse, touch and pen via pointer events; arrow keys when focused.
// It springs back to centre; one intentional swipe past the threshold = one selection step.

export class Joystick {
  constructor({ knob, stem, onSelect, isEnabled = () => true, onBlocked = () => {} }) {
    this.knob = knob;
    this.stem = stem;
    this.onSelect = onSelect;
    this.isEnabled = isEnabled;
    this.onBlocked = onBlocked;
    this.drag = null;
    this.range = 22;
    this.threshold = 42;

    knob.addEventListener("pointerdown", (e) => this.start(e));
    knob.addEventListener("pointermove", (e) => this.move(e));
    knob.addEventListener("pointerup", (e) => this.end(e));
    knob.addEventListener("pointercancel", (e) => this.end(e));
    knob.addEventListener("lostpointercapture", () => {
      if (this.drag) { this.drag = null; this.center(); }
    });
    knob.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      this.tilt(dir * this.range);
      setTimeout(() => this.center(), 140);
      this.choose(dir);
    });
  }

  choose(dir) {
    if (!this.isEnabled()) { this.onBlocked(); return; }
    this.onSelect(dir);
  }

  tilt(px) {
    this.knob.style.left = `calc(50% + ${px}px)`;
    this.knob.style.transform = "translateX(-50%)";
    this.stem.style.transform = `rotate(${px * 0.72}deg)`;
  }

  center() {
    this.knob.style.left = "50%";
    this.knob.style.transform = "translateX(-50%)";
    this.stem.style.transform = "rotate(0deg)";
    this.knob.classList.remove("is-dragging");
  }

  start(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    this.drag = { id: e.pointerId, startX: e.clientX, lastX: e.clientX };
    this.knob.setPointerCapture(e.pointerId);
    this.knob.classList.add("is-dragging");
  }

  move(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    e.preventDefault();
    this.drag.lastX = e.clientX;
    const delta = e.clientX - this.drag.startX;
    this.tilt(Math.max(-this.range, Math.min(this.range, delta)));
  }

  end(e) {
    if (!this.drag || (e.pointerId !== undefined && e.pointerId !== this.drag.id)) return;
    const delta = this.drag.lastX - this.drag.startX;
    this.drag = null;
    this.center();
    if (Math.abs(delta) >= this.threshold) this.choose(delta > 0 ? 1 : -1);
  }
}
