/* Lightweight animated arcade ambience: star particles, connected nodes, pixel sparks and pointer parallax. */
const canvas = document.getElementById('arcadeBackgroundFX');
if (canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0, height = 0, dpr = 1, frame = 0, rafId = 0, running = true;
  const pointer = { x: -1000, y: -1000, tx: -1000, ty: -1000 };
  const rand = (min, max) => min + Math.random() * (max - min);
  let particles = [], sparks = [], rings = [];
  function resize() {
    width = window.innerWidth; height = window.innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 1.7);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(58, Math.max(22, Math.floor(width * height / 24000)));
    particles = Array.from({ length: count }, () => ({ x: rand(0,width), y: rand(0,height), r: rand(0.7,2.2), vx: rand(-.18,.18), vy: rand(-.28,-.04), phase: rand(0,Math.PI*2), hue: Math.random() > .52 ? 188 : 290 }));
    sparks = Array.from({ length: 14 }, () => ({ x: rand(0,width), y: rand(0,height), size: rand(3,7), speed: rand(.12,.42), phase: rand(0,7), hue: Math.random() > .5 ? 185 : 315 }));
  }
  function draw() {
    frame++;
    ctx.clearRect(0,0,width,height);
    pointer.x += (pointer.tx-pointer.x)*.035; pointer.y += (pointer.ty-pointer.y)*.035;
    // Static CSS ambience supplies the broad glow; canvas only draws lightweight details.
    // Connect nearby stars into a subtle animated constellation.
    for (let i=0;i<particles.length;i++) {
      const p=particles[i]; p.x += p.vx; p.y += p.vy;
      if(p.y < -8){p.y=height+8;p.x=rand(0,width)} if(p.x < -8)p.x=width+8; if(p.x>width+8)p.x=-8;
      const dx=p.x-pointer.x, dy=p.y-pointer.y, distance=Math.hypot(dx,dy);
      if(distance<150){p.x += dx/(distance||1)*.22; p.y += dy/(distance||1)*.22;}
      const twinkle=.45 + (Math.sin(frame*.035+p.phase)+1)*.25;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=`hsla(${p.hue},100%,75%,${twinkle})`;ctx.fill();
      for(let j=i+1;j<particles.length;j++){const q=particles[j], dxq=p.x-q.x, dyq=p.y-q.y, d2=dxq*dxq+dyq*dyq;if(d2<8836){const dd=Math.sqrt(d2);ctx.strokeStyle=`rgba(61,210,255,${(1-dd/94)*.11})`;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}}
    }
    // Floating pixel fragments drift at different speeds, with gentle mouse parallax.
    for(const s of sparks){s.y-=s.speed;s.phase+=.012;if(s.y<-15){s.y=height+15;s.x=rand(0,width)}const x=s.x+Math.sin(s.phase)*12+(pointer.x-width/2)*-.008;const y=s.y+(pointer.y-height/2)*-.008;ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(s.phase)*.35);ctx.fillStyle=`hsla(${s.hue},100%,72%,${.16+(.5+.5*Math.sin(s.phase*2))*.22})`;ctx.fillRect(-s.size/2,-s.size/2,s.size,s.size);ctx.restore();}
    // Pointer-triggered ripple rings.
    rings=rings.filter(r=>r.life<1);for(const r of rings){r.life+=.018;ctx.beginPath();ctx.arc(r.x,r.y,8+r.life*58,0,Math.PI*2);ctx.strokeStyle=`rgba(37,234,255,${(1-r.life)*.42})`;ctx.lineWidth=1.2;ctx.stroke();}
    if(running && !reducedMotion) rafId = requestAnimationFrame(draw);
  }
  window.addEventListener('resize',resize,{passive:true});
  window.addEventListener('pointermove',e=>{pointer.tx=e.clientX;pointer.ty=e.clientY;},{passive:true});
  window.addEventListener('pointerdown',e=>{rings.push({x:e.clientX,y:e.clientY,life:0});if(rings.length>8)rings.shift();},{passive:true});
  resize(); draw();
  // The homepage can be lively before credit is inserted, then freeze the ambience
  // so games get the browser's rendering budget. The canvas remains as a still frame.
  window.pauseArcadeAmbience = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    document.body.classList.add('performance-mode');
  };
}
