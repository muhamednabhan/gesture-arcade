// Shared fruit data (radius is in "design pixels" and is scaled by the engine/renderer).
export const FRUIT_TYPES = [
  { id: "watermelon",  name: "Watermelon",  r: 46, points: 10, weight: 1.0, juice: "#ff2d55", glow: "#5dff8f" },
  { id: "orange",      name: "Orange",      r: 36, points: 10, weight: 1.3, juice: "#ff9d1f", glow: "#ffb347" },
  { id: "apple",       name: "Apple",       r: 34, points: 10, weight: 1.3, juice: "#ffe27a", glow: "#ff4d6d" },
  { id: "kiwi",        name: "Kiwi",        r: 30, points: 12, weight: 1.0, juice: "#8cff4a", glow: "#b6ff6a" },
  { id: "lemon",       name: "Lemon",       r: 31, points: 10, weight: 1.0, juice: "#fff04a", glow: "#fff27a" },
  { id: "strawberry",  name: "Strawberry",  r: 27, points: 15, weight: 0.8, juice: "#ff3b6b", glow: "#ff6b8b" },
  { id: "dragonfruit", name: "Dragonfruit", r: 38, points: 15, weight: 0.7, juice: "#ff4fd8", glow: "#ff4fd8" }
];

export const BOMB = { id: "bomb", name: "Bomb", r: 34, points: 0, juice: "#ff6a2a", glow: "#ff2a4a" };

export const TYPE_BY_ID = Object.freeze(Object.fromEntries([...FRUIT_TYPES, BOMB].map((t) => [t.id, t])));
