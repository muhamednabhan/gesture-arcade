import assert from "node:assert/strict";
import { judge, pickMove, classifyHand } from "../src/games/rock-paper-scissors/rules.js";
assert.equal(judge("rock", "scissors"), 1); assert.equal(judge("rock", "paper"), -1); assert.equal(judge("paper", "paper"), 0);
assert.equal(pickMove([{ g: "rock" }, { g: "rock" }, { g: null }, { g: "rock" }]), "rock");
assert.equal(pickMove([{ g: "rock" }, { g: "paper" }]), null);
const hand = (ext) => {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]].forEach(([m, p, t], k) => {
    lm[m] = { x: k * .05, y: .3 }; lm[p] = { x: k * .05, y: ext[k] ? .45 : .4 }; lm[t] = { x: k * .05, y: ext[k] ? .7 : .22 };
  });
  return lm;
};
assert.equal(classifyHand(hand([0, 0, 0, 0])), "rock");
assert.equal(classifyHand(hand([1, 1, 1, 1])), "paper");
assert.equal(classifyHand(hand([1, 1, 0, 0])), "scissors");
assert.equal(classifyHand(hand([1, 0, 0, 0])), null);
console.log("rps ok");
