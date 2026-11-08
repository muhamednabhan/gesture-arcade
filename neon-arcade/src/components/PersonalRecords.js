// Compact personal-best readout on the cabinet screen. Shows the record for the selected game.
export class PersonalRecords {
  constructor({ valueEl, records }) {
    this.valueEl = valueEl;
    this.records = records;
    this.gameId = null;
    this.unsubscribe = records.subscribe(({ gameId }) => {
      if (gameId === this.gameId) this.render(true);
    });
  }

  show(gameId) {
    this.gameId = gameId;
    this.render(false);
  }

  render(animate) {
    const best = this.records.getBest(this.gameId);
    this.valueEl.textContent = best ? String(best) : "--";
    if (animate) {
      this.valueEl.classList.remove("is-new");
      void this.valueEl.offsetWidth;
      this.valueEl.classList.add("is-new");
    }
  }
}
