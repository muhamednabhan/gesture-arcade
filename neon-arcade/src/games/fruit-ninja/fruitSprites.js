// Procedural neon fruit artwork. Everything is drawn once into small offscreen canvases (no image files to
// fail to load, always crisp at the current resolution) and then blitted every frame with drawImage.
// Whole fruit are centred on the sprite centre. Halves use the fruit's flat cut edge on the right of the
// sprite and pivot about their own centre of mass (HALF_OFFSET * R to the left of the fruit centre).
import { FRUIT_TYPES, BOMB } from "./fruitTypes.js";

export const HALF_OFFSET = 0.42;
const PI = Math.PI;

function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.max(8, Math.ceil(size));
  return c;
}

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const radial = (ctx, x0, y0, r0, x1, y1, r1, stops) => {
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
};

function ellipsePath(ctx, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, PI * 2);
}

// Left half-disc (flat edge on x = 0).
function semi(ctx, r) {
  ctx.beginPath();
  ctx.arc(0, 0, r, -PI / 2, PI / 2, true);
  ctx.closePath();
}

function gloss(ctx, R, strength = 0.6) {
  ctx.save();
  ctx.translate(-R * 0.36, -R * 0.4);
  ctx.rotate(-0.7);
  ctx.fillStyle = radial(ctx, 0, 0, 0, 0, 0, R * 0.34, [[0, `rgba(255,255,255,${strength})`], [1, "rgba(255,255,255,0)"]]);
  ctx.scale(1, 0.55);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.34, 0, PI * 2);
  ctx.fill();
  ctx.restore();
}

function rim(ctx, rx, ry, color, R) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, R * 0.045);
  ellipsePath(ctx, rx, ry);
  ctx.stroke();
  ctx.restore();
}

function glowFill(ctx, color, blur, fill, drawPath) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  drawPath();
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------------------------------------
// WHOLE FRUIT (centre at origin)
// ------------------------------------------------------------------------------------------------
const WHOLE = {
  watermelon(ctx, R, rnd, t) {
    const body = radial(ctx, -R * 0.3, -R * 0.35, R * 0.1, 0, 0, R * 1.05, [[0, "#86f59a"], [0.45, "#22a74f"], [1, "#083d24"]]);
    glowFill(ctx, t.glow, R * 0.5, body, () => ellipsePath(ctx, R, R * 0.94));
    ctx.save();
    ellipsePath(ctx, R, R * 0.94);
    ctx.clip();
    ctx.strokeStyle = "rgba(5,50,28,.6)";
    ctx.lineCap = "round";
    for (let i = -4; i <= 4; i++) {
      const x = i * R * 0.25;
      ctx.lineWidth = R * (0.1 + rnd() * 0.06);
      ctx.beginPath();
      ctx.moveTo(x * 0.55, -R);
      ctx.bezierCurveTo(x * 1.5, -R * 0.4, x * 1.5, R * 0.4, x * 0.55, R);
      ctx.stroke();
    }
    ctx.restore();
    gloss(ctx, R);
    rim(ctx, R, R * 0.94, t.glow, R);
  },

  orange(ctx, R, rnd, t) {
    const body = radial(ctx, -R * 0.3, -R * 0.35, R * 0.1, 0, 0, R * 1.05, [[0, "#ffe08a"], [0.4, "#ff9a24"], [1, "#b83c0a"]]);
    glowFill(ctx, t.glow, R * 0.5, body, () => ellipsePath(ctx, R, R));
    ctx.fillStyle = "rgba(120,30,0,.22)";
    for (let i = 0; i < 46; i++) {
      const a = rnd() * PI * 2, d = Math.sqrt(rnd()) * R * 0.92;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, R * 0.022, 0, PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#3fbf4c"; // stem button
    ctx.beginPath();
    ctx.arc(R * 0.04, -R * 0.82, R * 0.1, 0, PI * 2);
    ctx.fill();
    gloss(ctx, R);
    rim(ctx, R, R, t.glow, R);
  },

  apple(ctx, R, rnd, t) {
    const body = radial(ctx, -R * 0.3, -R * 0.3, R * 0.1, 0, 0, R * 1.05, [[0, "#ff9fb0"], [0.38, "#ff2d55"], [1, "#6d0726"]]);
    glowFill(ctx, t.glow, R * 0.5, body, () => {
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.78);
      ctx.bezierCurveTo(R * 0.35, -R * 1.02, R * 1.08, -R * 0.7, R * 0.98, R * 0.1);
      ctx.bezierCurveTo(R * 0.9, R * 0.85, R * 0.4, R * 1.02, 0, R * 0.9);
      ctx.bezierCurveTo(-R * 0.4, R * 1.02, -R * 0.9, R * 0.85, -R * 0.98, R * 0.1);
      ctx.bezierCurveTo(-R * 1.08, -R * 0.7, -R * 0.35, -R * 1.02, 0, -R * 0.78);
      ctx.closePath();
    });
    ctx.strokeStyle = "#7a4a1d"; // stem
    ctx.lineWidth = R * 0.09;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.72);
    ctx.quadraticCurveTo(R * 0.04, -R * 1.0, R * 0.16, -R * 1.18);
    ctx.stroke();
    ctx.fillStyle = "#6bf05a"; // leaf
    ctx.beginPath();
    ctx.moveTo(R * 0.1, -R * 0.95);
    ctx.quadraticCurveTo(R * 0.55, -R * 1.35, R * 0.85, -R * 0.95);
    ctx.quadraticCurveTo(R * 0.5, -R * 0.8, R * 0.1, -R * 0.95);
    ctx.fill();
    gloss(ctx, R, 0.55);
  },

  kiwi(ctx, R, rnd, t) {
    const body = radial(ctx, -R * 0.3, -R * 0.3, R * 0.1, 0, 0, R * 1.05, [[0, "#d9a15a"], [0.5, "#9a6523"], [1, "#4b2d0e"]]);
    glowFill(ctx, t.glow, R * 0.45, body, () => ellipsePath(ctx, R, R * 0.92));
    ctx.save();
    ellipsePath(ctx, R, R * 0.92);
    ctx.clip();
    ctx.lineCap = "round";
    for (let i = 0; i < 90; i++) { // fuzz
      const a = rnd() * PI * 2, d = Math.sqrt(rnd()) * R;
      const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.92, l = R * (0.08 + rnd() * 0.1), b = rnd() * PI * 2;
      ctx.strokeStyle = rnd() < 0.5 ? "rgba(235,190,120,.45)" : "rgba(60,30,8,.4)";
      ctx.lineWidth = Math.max(1, R * 0.025);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l);
      ctx.stroke();
    }
    ctx.restore();
    gloss(ctx, R, 0.35);
    rim(ctx, R, R * 0.92, t.glow, R);
  },

  lemon(ctx, R, rnd, t) {
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-R * 1.02, 0);
      ctx.bezierCurveTo(-R * 0.8, -R * 0.2, -R * 0.78, -R * 0.82, 0, -R * 0.82);
      ctx.bezierCurveTo(R * 0.78, -R * 0.82, R * 0.8, -R * 0.2, R * 1.02, 0);
      ctx.bezierCurveTo(R * 0.8, R * 0.2, R * 0.78, R * 0.82, 0, R * 0.82);
      ctx.bezierCurveTo(-R * 0.78, R * 0.82, -R * 0.8, R * 0.2, -R * 1.02, 0);
      ctx.closePath();
    };
    const body = radial(ctx, -R * 0.25, -R * 0.3, R * 0.1, 0, 0, R * 1.1, [[0, "#fffbb8"], [0.45, "#ffe53b"], [1, "#b88a00"]]);
    glowFill(ctx, t.glow, R * 0.5, body, path);
    ctx.fillStyle = "rgba(150,110,0,.2)";
    for (let i = 0; i < 34; i++) {
      ctx.beginPath();
      ctx.arc((rnd() - 0.5) * R * 1.7, (rnd() - 0.5) * R * 1.3, R * 0.02, 0, PI * 2);
      ctx.fill();
    }
    gloss(ctx, R * 0.95, 0.55);
  },

  strawberry(ctx, R, rnd, t) {
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.7);
      ctx.bezierCurveTo(R * 0.55, -R * 1.0, R * 1.08, -R * 0.55, R * 0.92, -R * 0.05);
      ctx.bezierCurveTo(R * 0.8, R * 0.5, R * 0.3, R * 0.95, 0, R * 1.05);
      ctx.bezierCurveTo(-R * 0.3, R * 0.95, -R * 0.8, R * 0.5, -R * 0.92, -R * 0.05);
      ctx.bezierCurveTo(-R * 1.08, -R * 0.55, -R * 0.55, -R * 1.0, 0, -R * 0.7);
      ctx.closePath();
    };
    const body = radial(ctx, -R * 0.3, -R * 0.35, R * 0.1, 0, 0, R * 1.1, [[0, "#ff9aae"], [0.4, "#ff2f58"], [1, "#860626"]]);
    glowFill(ctx, t.glow, R * 0.5, body, path);
    ctx.fillStyle = "#ffe36b"; // seeds
    for (let row = 0; row < 5; row++) {
      const y = -R * 0.35 + row * R * 0.3;
      const span = R * (0.78 - Math.abs(row - 1.2) * 0.12 - row * 0.08);
      for (let i = -2; i <= 2; i++) {
        const x = (i / 2.2) * span + (row % 2 ? R * 0.1 : 0);
        ctx.beginPath();
        ctx.ellipse(x, y, R * 0.045, R * 0.075, 0, 0, PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#4ff06a"; // calyx
    for (let i = 0; i < 6; i++) {
      const a = -PI / 2 + (i - 2.5) * 0.52;
      ctx.save();
      ctx.translate(0, -R * 0.74);
      ctx.rotate(a + PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(R * 0.2, -R * 0.2, 0, -R * 0.5);
      ctx.quadraticCurveTo(-R * 0.2, -R * 0.2, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    gloss(ctx, R, 0.5);
  },

  dragonfruit(ctx, R, rnd, t) {
    const spike = (a, len, w) => {
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -R * 0.9);
      ctx.fillStyle = radial(ctx, 0, 0, 0, 0, -len, len, [[0, "#d8ff6a"], [1, "#3cd74a"]]);
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(-w * 0.2, -len * 0.7, w * 0.35, -len);
      ctx.quadraticCurveTo(w * 0.8, -len * 0.4, w, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    ctx.save();
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = R * 0.5;
    for (let i = 0; i < 9; i++) spike((i / 9) * PI * 2 + rnd() * 0.2, R * (0.3 + rnd() * 0.14), R * 0.13);
    ctx.restore();
    const body = radial(ctx, -R * 0.3, -R * 0.3, R * 0.1, 0, 0, R * 1.0, [[0, "#ff8de6"], [0.45, "#e61fa8"], [1, "#6d0a5a"]]);
    glowFill(ctx, t.glow, R * 0.4, body, () => ellipsePath(ctx, R * 0.92, R * 0.86));
    ctx.save(); // overlapping scales
    ellipsePath(ctx, R * 0.92, R * 0.86);
    ctx.clip();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * PI * 2 + 0.3;
      const x = Math.cos(a) * R * 0.5, y = Math.sin(a) * R * 0.47;
      ctx.fillStyle = "rgba(120,255,90,.75)";
      ctx.beginPath();
      ctx.moveTo(x - R * 0.12, y + R * 0.08);
      ctx.quadraticCurveTo(x, y - R * 0.22, x + R * 0.12, y + R * 0.08);
      ctx.quadraticCurveTo(x, y + R * 0.02, x - R * 0.12, y + R * 0.08);
      ctx.fill();
    }
    ctx.restore();
    gloss(ctx, R * 0.95, 0.5);
  }
};

// ------------------------------------------------------------------------------------------------
// HALVES (fruit centre at origin, kept half-disc is x <= 0)
// ------------------------------------------------------------------------------------------------
function bands(ctx, R, list) {
  for (const [scale, fill] of list) {
    ctx.fillStyle = fill;
    semi(ctx, R * scale);
    ctx.fill();
  }
}

function cutShine(ctx, R) {
  ctx.save();
  semi(ctx, R * 0.95);
  ctx.clip();
  const g = ctx.createLinearGradient(-R * 0.14, 0, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(255,255,255,.4)");
  ctx.fillStyle = g;
  ctx.fillRect(-R * 0.14, -R, R * 0.14, R * 2);
  ctx.restore();
}

function seed(ctx, x, y, rx, ry, ang, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, PI * 2);
  ctx.fill();
  ctx.restore();
}

function wedges(ctx, R, count, inner, c0, c1) {
  const span = PI / count;
  for (let i = 0; i < count; i++) {
    const a0 = PI / 2 + i * span + 0.05, a1 = PI / 2 + (i + 1) * span - 0.05;
    ctx.fillStyle = radial(ctx, 0, 0, R * 0.05, 0, 0, R * inner, [[0, c0], [1, c1]]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R * inner, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
}

const HALF = {
  watermelon(ctx, R, rnd) {
    bands(ctx, R, [[1, "#0f6b37"], [0.955, "#86df68"], [0.9, "#f0ffe8"]]);
    ctx.fillStyle = radial(ctx, 0, 0, R * 0.05, 0, 0, R * 0.86, [[0, "#ff8c9d"], [0.55, "#ff2d55"], [1, "#d10f3c"]]);
    semi(ctx, R * 0.86);
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const a = PI / 2 + ((i + 0.5) / 7) * PI;
      seed(ctx, Math.cos(a) * R * 0.52, Math.sin(a) * R * 0.52, R * 0.085, R * 0.04, a, "#12040b");
    }
    for (let i = 0; i < 3; i++) {
      const a = PI / 2 + ((i + 0.5) / 3) * PI;
      seed(ctx, Math.cos(a) * R * 0.26, Math.sin(a) * R * 0.26, R * 0.07, R * 0.034, a, "#12040b");
    }
    cutShine(ctx, R);
  },
  orange(ctx, R) {
    bands(ctx, R, [[1, "#f07a12"], [0.95, "#fff0c4"]]);
    ctx.fillStyle = "#fff0c4";
    semi(ctx, R * 0.9);
    ctx.fill();
    wedges(ctx, R, 4, 0.86, "#ffd070", "#ff9e1e");
    cutShine(ctx, R);
  },
  apple(ctx, R) {
    bands(ctx, R, [[1, "#cf1238"], [0.94, "#fff8dc"]]);
    ctx.fillStyle = radial(ctx, 0, 0, R * 0.1, 0, 0, R * 0.9, [[0, "#fffdf0"], [1, "#ffe9a4"]]);
    semi(ctx, R * 0.92);
    ctx.fill();
    ctx.save();
    semi(ctx, R * 0.92);
    ctx.clip();
    ctx.fillStyle = "#f3deA0";
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.22, R * 0.42, 0, 0, PI * 2);
    ctx.fill();
    ctx.restore();
    seed(ctx, -R * 0.07, -R * 0.14, R * 0.06, R * 0.03, 1.2, "#4d2508");
    seed(ctx, -R * 0.07, R * 0.14, R * 0.06, R * 0.03, -1.2, "#4d2508");
    cutShine(ctx, R);
  },
  kiwi(ctx, R, rnd) {
    bands(ctx, R, [[1, "#8a5a1f"], [0.95, "#cdee63"]]);
    ctx.fillStyle = radial(ctx, 0, 0, R * 0.08, 0, 0, R * 0.9, [[0, "#f6ffd0"], [0.22, "#d4f95a"], [0.5, "#92e02a"], [1, "#58b81a"]]);
    semi(ctx, R * 0.9);
    ctx.fill();
    ctx.strokeStyle = "rgba(240,255,190,.35)";
    ctx.lineWidth = Math.max(1, R * 0.02);
    for (let i = 0; i < 11; i++) {
      const a = PI / 2 + ((i + 0.5) / 11) * PI;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22);
      ctx.lineTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8);
      ctx.stroke();
    }
    for (let i = 0; i < 13; i++) {
      const a = PI / 2 + ((i + 0.5) / 13) * PI;
      seed(ctx, Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, R * 0.05, R * 0.022, a, "#10200a");
    }
    cutShine(ctx, R);
  },
  lemon(ctx, R) {
    bands(ctx, R, [[1, "#f3c812"], [0.95, "#fffbd0"]]);
    ctx.fillStyle = "#fffbd0";
    semi(ctx, R * 0.9);
    ctx.fill();
    wedges(ctx, R, 5, 0.86, "#fffbc4", "#ffe94a");
    cutShine(ctx, R);
  },
  strawberry(ctx, R, rnd) {
    bands(ctx, R, [[1, "#cf1038"], [0.93, "#ffb0bd"]]);
    ctx.fillStyle = radial(ctx, 0, 0, R * 0.05, 0, 0, R * 0.9, [[0, "#fff4f6"], [0.3, "#ffb3c0"], [1, "#ff3a5e"]]);
    semi(ctx, R * 0.9);
    ctx.fill();
    for (let i = 0; i < 9; i++) {
      const a = PI / 2 + ((i + 0.5) / 9) * PI;
      seed(ctx, Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84, R * 0.035, R * 0.06, a + PI / 2, "#ffe27a");
    }
    cutShine(ctx, R);
  },
  dragonfruit(ctx, R, rnd) {
    for (let i = 0; i < 7; i++) { // green-tipped scales poking out past the skin
      const a = PI / 2 + ((i + 0.5) / 7) * PI;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(R * 0.93, 0);
      ctx.fillStyle = "#79f24f";
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.1);
      ctx.quadraticCurveTo(R * 0.12, -R * 0.06, R * 0.26, 0);
      ctx.quadraticCurveTo(R * 0.12, R * 0.06, 0, R * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    bands(ctx, R, [[1, "#df1aa0"], [0.94, "#ffe6f6"]]);
    ctx.fillStyle = radial(ctx, 0, 0, R * 0.05, 0, 0, R * 0.9, [[0, "#ffffff"], [1, "#ffd3ee"]]);
    semi(ctx, R * 0.9);
    ctx.fill();
    ctx.fillStyle = "#14040f";
    for (let n = 0; n < 60; ) {
      const x = -rnd() * R * 0.84, y = (rnd() - 0.5) * R * 1.7;
      if (x * x + y * y < R * R * 0.78) {
        ctx.beginPath();
        ctx.arc(x, y, R * 0.017, 0, PI * 2);
        ctx.fill();
        n++;
      }
    }
    cutShine(ctx, R);
  }
};

// ------------------------------------------------------------------------------------------------
// BOMB
// ------------------------------------------------------------------------------------------------
export function bombFuseTip(R) {
  return { x: R * 0.62, y: -R * 1.34 };
}

function drawBomb(ctx, R) {
  const body = radial(ctx, -R * 0.3, -R * 0.3, R * 0.1, 0, 0, R * 1.05, [[0, "#5a5a7c"], [0.45, "#1c1c2c"], [1, "#050509"]]);
  glowFill(ctx, "#ff2a4a", R * 0.7, body, () => { ctx.beginPath(); ctx.arc(0, R * 0.08, R * 0.92, 0, PI * 2); });
  ctx.save();
  ctx.strokeStyle = "#ff2a4a"; // red hazard ring
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(2, R * 0.07);
  ctx.beginPath();
  ctx.arc(0, R * 0.08, R * 0.9, 0, PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#34344c"; // cap
  ctx.beginPath();
  ctx.roundRect(-R * 0.26, -R * 1.0, R * 0.52, R * 0.3, R * 0.06);
  ctx.fill();
  ctx.strokeStyle = "#d9c8a0"; // fuse
  ctx.lineWidth = Math.max(2, R * 0.08);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -R * 1.0);
  ctx.bezierCurveTo(R * 0.05, -R * 1.25, R * 0.5, -R * 1.1, R * 0.62, -R * 1.34);
  ctx.stroke();
  // neon skull mark so it can never be mistaken for fruit
  ctx.save();
  ctx.translate(0, R * 0.1);
  ctx.shadowColor = "#ff2a4a";
  ctx.shadowBlur = R * 0.25;
  ctx.fillStyle = "#ff4d6d";
  ctx.beginPath();
  ctx.arc(0, -R * 0.08, R * 0.38, PI, 0);
  ctx.lineTo(R * 0.26, R * 0.22);
  ctx.lineTo(-R * 0.26, R * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#0a0410";
  ctx.beginPath();
  ctx.arc(-R * 0.15, -R * 0.06, R * 0.1, 0, PI * 2);
  ctx.arc(R * 0.15, -R * 0.06, R * 0.1, 0, PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, R * 0.03);
  ctx.lineTo(-R * 0.05, R * 0.12);
  ctx.lineTo(R * 0.05, R * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#0a0410";
  ctx.lineWidth = Math.max(1, R * 0.03);
  for (const x of [-0.1, 0, 0.1]) {
    ctx.beginPath();
    ctx.moveTo(R * x, R * 0.15);
    ctx.lineTo(R * x, R * 0.22);
    ctx.stroke();
  }
  ctx.restore();
  gloss(ctx, R, 0.35);
}

// ------------------------------------------------------------------------------------------------
// SMALL EFFECT SPRITES
// ------------------------------------------------------------------------------------------------
function dotSprite(size, color) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  const m = size / 2;
  ctx.fillStyle = radial(ctx, m, m, 0, m, m, m, [[0, "#ffffff"], [0.35, color], [0.8, color], [1, "rgba(0,0,0,0)"]]);
  ctx.beginPath();
  ctx.arc(m, m, m, 0, PI * 2);
  ctx.fill();
  return c;
}

export function glowSprite(size, color) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  const m = size / 2;
  ctx.fillStyle = radial(ctx, m, m, 0, m, m, m, [[0, "rgba(255,255,255,1)"], [0.25, color], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 0, size, size);
  return c;
}

function splatSprite(size, color, rnd) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  const m = size / 2;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.05;
  ctx.beginPath();
  ctx.arc(m, m, size * 0.17, 0, PI * 2);
  ctx.fill();
  for (let i = 0; i < 9; i++) { // blobs thrown outward with drips
    const a = rnd() * PI * 2, d = size * (0.14 + rnd() * 0.2), r = size * (0.04 + rnd() * 0.07);
    ctx.beginPath();
    ctx.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, r, 0, PI * 2);
    ctx.fill();
    ctx.lineWidth = r * 0.7;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(m + Math.cos(a) * d * 0.5, m + Math.sin(a) * d * 0.5);
    ctx.lineTo(m + Math.cos(a) * d, m + Math.sin(a) * d);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = rnd() * PI * 2, d = size * (0.32 + rnd() * 0.14);
    ctx.beginPath();
    ctx.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, size * (0.012 + rnd() * 0.02), 0, PI * 2);
    ctx.fill();
  }
  return c;
}

/**
 * Build every sprite for the current render scale.
 * @param k  pixels per design pixel (engine.scale * dpr)
 * @param dpr canvas pixel ratio, used to report each sprite's CSS size
 */
export function buildSprites(k, dpr) {
  const whole = {}, half = {}, size = {};
  FRUIT_TYPES.forEach((t, i) => {
    const R = t.r * k;
    const S = Math.ceil(R * 2.9);
    size[t.id] = { px: S, css: S / dpr, R };

    const w = makeCanvas(S);
    let ctx = w.getContext("2d");
    ctx.translate(S / 2, S / 2);
    WHOLE[t.id](ctx, R, seeded(101 + i * 17), t);
    whole[t.id] = w;

    const h = makeCanvas(S);
    ctx = h.getContext("2d");
    ctx.translate(S / 2 + R * HALF_OFFSET, S / 2); // pivot = half's centre of mass
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = R * 0.18;
    HALF[t.id](ctx, R, seeded(303 + i * 29), t);
    half[t.id] = h;
  });

  const bR = BOMB.r * k;
  const bS = Math.ceil(bR * 3.1);
  const bomb = makeCanvas(bS);
  let bctx = bomb.getContext("2d");
  bctx.translate(bS / 2, bS / 2);
  drawBomb(bctx, bR);
  size.bomb = { px: bS, css: bS / dpr, R: bR };

  const juiceColors = [...new Set([...FRUIT_TYPES.map((t) => t.juice), BOMB.juice])];
  const drop = {}, splat = {};
  const dropPx = Math.ceil(16 * dpr);
  juiceColors.forEach((col, i) => {
    drop[col] = dotSprite(dropPx, col);
    const rnd = seeded(900 + i * 7);
    splat[col] = [splatSprite(Math.ceil(120 * k), col, rnd), splatSprite(Math.ceil(120 * k), col, rnd)];
  });

  return {
    k, dpr, whole, half, bomb, size, drop, splat,
    dropCss: dropPx / dpr,
    spark: glowSprite(Math.ceil(28 * dpr), "#27f4ff"),
    sparkPink: glowSprite(Math.ceil(28 * dpr), "#ff3ccf"),
    sparkCss: Math.ceil(28 * dpr) / dpr,
    fuse: glowSprite(Math.ceil(30 * k), "#ffb02e"),
    fuseCss: Math.ceil(30 * k) / dpr
  };
}
