// Pure game logic (no DOM) so it can be unit-tested.
export const MOVES = ["rock", "paper", "scissors"];
export const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
export const WIN_ROUNDS = 2; // best of three: first to two round wins

/** 1 = a wins, -1 = b wins, 0 = tie */
export function judge(a, b) {
  if (a === b) return 0;
  return BEATS[a] === b ? 1 : -1;
}

export const randomMove = (rnd = Math.random) => MOVES[Math.min(2, Math.floor(rnd() * 3))];

/** Classify a MediaPipe hand (21 landmarks) as rock / paper / scissors / null. Rotation-invariant. */
export function classifyHand(lm) {
  if (!lm || lm.length < 21) return null;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = lm[0];
  const ext = (tip, pip, mcp) => d(lm[tip], w) > d(lm[pip], w) * 1.08 && d(lm[tip], w) > d(lm[mcp], w) * 1.3;
  const i = ext(8, 6, 5), m = ext(12, 10, 9), r = ext(16, 14, 13), p = ext(20, 18, 17);
  const n = +i + +m + +r + +p;
  if (n === 0) return "rock";
  if (n >= 3) return "paper";
  if (i && m && !r && !p) return "scissors";
  return null;
}

/** Most common move in samples [{g}], needing at least `min` votes. */
export function pickMove(samples, min = 3) {
  const c = {};
  let best = null;
  for (const s of samples) {
    if (!s.g) continue;
    c[s.g] = (c[s.g] || 0) + 1;
    if (!best || c[s.g] > c[best]) best = s.g;
  }
  return best && c[best] >= min ? best : null;
}
