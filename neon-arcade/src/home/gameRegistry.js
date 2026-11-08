// Central registry. Order here = joystick order. Each game is lazy-loaded the first time it is launched.
// A game module exports createGame({ container, records, camera, onExit, game }) -> { destroy() }.

const css = (path) => new URL(path, import.meta.url).href;

export const GAMES = [
  {
    id: "flappy-bird",
    name: "BLINK BIRD",
    title: "BLINK<br><strong>BIRD</strong>",
    description: "Blink to fly. Dodge the neon pipes. Beat your high score.",
    instructions: "BLINK TO FLAP · SPACE / ↑ AS BACKUP",
    eyebrow: "ARCADE CLASSIC",
    status: "PLAYER READY",
    art: "assets/blink-bird.svg",
    alt: "Pixel bird flying between glowing neon pipes",
    accent: "#25eaff",
    short: "BLINK BIRD",
    screen: "wide", // enlarge the cabinet screen while Blink Bird is running
    styles: css("../games/flappy-bird/flappy.css"),
    load: () => import("../games/flappy-bird/FlappyGame.js")
  },
  {
    id: "fruit-ninja",
    name: "FRUIT NINJA",
    title: "FRUIT<br><strong>NINJA</strong>",
    description: "Slice the fruit. Chase the high score.",
    instructions: "SWIPE YOUR FINGERTIP THROUGH THE FRUIT",
    eyebrow: "SLICE MODE",
    status: "BLADE READY",
    art: "assets/fruit-ninja.svg",
    alt: "Glowing sliced fruit and a bright diagonal blade trail",
    accent: "#ff3ca6",
    short: "FRUIT NINJA",
    screen: "wide", // asks the cabinet for the enlarged screen while this game runs (see styles/arcade-ui.css)
    styles: css("../games/fruit-ninja/fruit-ninja.css"),
    load: () => import("../games/fruit-ninja/FruitNinjaGame.js")
  },
  {
    id: "rock-paper-scissors",
    name: "ROCK PAPER SCISSORS",
    title: "ROCK<br><strong>PAPER</strong><br>SCISSORS",
    description: "Read the move. Beat the opponent.",
    instructions: "SHOW ROCK, PAPER OR SCISSORS · BEST OF 3",
    eyebrow: "VERSUS MODE",
    status: "CHALLENGER READY",
    art: "assets/rock-paper-scissors.svg",
    alt: "Three neon hand gestures representing rock, paper and scissors",
    accent: "#caff32",
    short: "R / P / S",
    screen: "wide",
    styles: css("../games/rock-paper-scissors/rps.css"),
    load: () => import("../games/rock-paper-scissors/RockPaperScissorsGame.js")
  },
  {
    id: "pong",
    name: "KNUCKLE PONG",
    title: "KNUCKLE<br><strong>PONG</strong>",
    description: "Close your fist and slide it to move the bat. Miss three and you lose.",
    instructions: "CLOSE YOUR FIST TO MOVE · HANDS-FREE CAMERA",
    eyebrow: "RETRO CLASSIC",
    status: "BAT READY",
    art: "assets/pong.svg",
    alt: "Neon pong bats and a glowing ball",
    accent: "#ff9d2e",
    short: "KNUCKLE PONG",
    screen: "wide",
    styles: css("../games/pong/pong.css"),
    load: () => import("../games/pong/PongGame.js")
  }
];
