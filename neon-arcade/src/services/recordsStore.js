// Personal-best records, persisted in localStorage only (no backend, no accounts).
// One namespaced key per game. Corrupted or invalid values are treated as "no record".

const PREFIX = "neonArcade.records.v1.";
const EVENT = "records:changed";

const bus = new EventTarget();
const memory = new Map(); // Fallback when localStorage is unavailable (private mode, blocked storage).

function keyFor(gameId) {
  return PREFIX + gameId;
}

function sanitize(raw) {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n <= 1e9 ? n : 0;
}

function readRaw(gameId) {
  try {
    return window.localStorage.getItem(keyFor(gameId));
  } catch {
    return memory.has(gameId) ? String(memory.get(gameId)) : null;
  }
}

function writeRaw(gameId, value) {
  try {
    window.localStorage.setItem(keyFor(gameId), String(value));
  } catch {
    memory.set(gameId, value);
  }
}

export const recordsStore = {
  /** Stored personal best for a game; 0 when there is none or the value is invalid. */
  getBest(gameId) {
    return sanitize(readRaw(gameId));
  },

  /**
   * Finalize a score. Saves immediately and only when it beats the stored best.
   * Returns { isNewRecord, best, previous }.
   */
  submitScore(gameId, score) {
    const value = sanitize(Math.floor(Number(score)));
    const previous = this.getBest(gameId);
    if (value > previous) {
      writeRaw(gameId, value);
      bus.dispatchEvent(new CustomEvent(EVENT, { detail: { gameId, best: value } }));
      return { isNewRecord: true, best: value, previous };
    }
    return { isNewRecord: false, best: previous, previous };
  },

  /** Subscribe to record changes (including from other tabs). Returns an unsubscribe function. */
  subscribe(callback) {
    const onLocal = (e) => callback(e.detail);
    const onStorage = (e) => {
      if (e.key && e.key.startsWith(PREFIX)) {
        const gameId = e.key.slice(PREFIX.length);
        callback({ gameId, best: this.getBest(gameId) });
      }
    };
    bus.addEventListener(EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      bus.removeEventListener(EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }
};
