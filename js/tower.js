// 首屏线框楼：逐层建起、整体旋转，塔吊单独回转。纯 Canvas 2D，无依赖。
(function () {
  const cv = document.getElementById('tower');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const rotEl = document.getElementById('rot');
  const progEl = document.getElementById('prog');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0;

  // ---- geometry (world units; y is up) ----
  const E = { grid: [], podium: [], ring: [], frame: [], crown: [] };
  const seg = (arr, a, b) => arr.push([a, b]);
  const rect = (arr, x0, x1, z0, z1, y) => {
    seg(arr, [x0, y, z0], [x1, y, z0]); seg(arr, [x1, y, z0], [x1, y, z1]);
    seg(arr, [x1, y, z1], [x0, y, z1]); seg(arr, [x0, y, z1], [x0, y, z0]);
  };
  const posts = (arr, pts, y0, y1) => pts.forEach(([x, z]) => seg(arr, [x, y0, z], [x, y1, z]));

  for (let i = -3; i <= 3.001; i += 0.5) { seg(E.grid, [i, 0, -3], [i, 0, 3]); seg(E.grid, [-3, 0, i], [3, 0, i]); }
  [0, 0.3, 0.6].forEach(y => rect(E.podium, -1.6, 1.6, -1.2, 1.2, y));
  posts(E.podium, [[-1.6, -1.2], [1.6, -1.2], [1.6, 1.2], [-1.6, 1.2]], 0, 0.6);

  const FLOORS = 20, Y0 = 0.6, FH = 0.2, TOP = Y0 + FLOORS * FH;
  for (let i = 0; i <= FLOORS; i++) rect(E.ring, -1, 1, -0.7, 0.7, Y0 + i * FH);
  posts(E.frame, [[-1, -0.7], [1, -0.7], [1, 0.7], [-1, 0.7]], Y0, TOP);
  posts(E.frame, [[-0.5, -0.7], [0, -0.7], [0.5, -0.7], [-0.5, 0.7], [0, 0.7], [0.5, 0.7], [-1, 0], [1, 0]], Y0, TOP);
  rect(E.crown, -0.6, 0.6, -0.45, 0.45, TOP + 0.7);
  posts(E.crown, [[-0.6, -0.45], [0.6, -0.45], [0.6, 0.45], [-0.6, 0.45]], TOP, TOP + 0.7);
  seg(E.crown, [0, TOP + 0.7, 0], [0, TOP + 1.3, 0]);

  function size() {
    const r = cv.getBoundingClientRect();
    w = r.width; h = r.height;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    if (!w || !h) return null;
    const a = t * 0.32 + 0.6, tilt = 0.36, D = 12;
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(tilt), st = Math.sin(tilt);
    const f = Math.min(w * 1.1, h * 1.2), cx = w / 2, cy = h * 0.5;
    const P = ([x, y, z]) => {
      const X = x * ca - z * sa, Z = x * sa + z * ca, Y = y - 3.2;
      const Y2 = Y * ct + Z * st, Z2 = -Y * st + Z * ct;
      const s = f / (Z2 + D);
      return [cx + X * s, cy - Y2 * s];
    };
    const stroke = (list, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      for (const [p, q] of list) { const A = P(p), B = P(q); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); }
      ctx.stroke();
    };
    const slab = y => {
      const q = [[-1, y, -0.7], [1, y, -0.7], [1, y, 0.7], [-1, y, 0.7]].map(P);
      ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    };

    ctx.clearRect(0, 0, w, h);
    stroke(E.grid, 'rgba(69,243,255,0.10)', 1);
    stroke(E.podium, 'rgba(69,243,255,0.45)', 1);

    // construction progress: floors below the working floor are filled in
    const fl = Math.floor((t * 2) % (FLOORS + 4));
    const built = Math.min(fl, FLOORS);
    ctx.fillStyle = 'rgba(69,243,255,0.07)';
    for (let i = 0; i < built; i++) { slab(Y0 + (i + 1) * FH); ctx.fill(); }
    stroke(E.ring, 'rgba(69,243,255,0.28)', 1);
    stroke(E.frame, 'rgba(69,243,255,0.62)', 1);
    stroke(E.crown, 'rgba(219,247,255,0.8)', 1);
    if (fl < FLOORS) {
      slab(Y0 + (fl + 1) * FH);
      ctx.fillStyle = 'rgba(255,138,31,0.18)'; ctx.fill();
      ctx.save(); ctx.shadowColor = '#ff8a1f'; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#ff8a1f'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
    }

    // tower crane, slewing on its own
    const mx = 1.3, mz = 0.95, top = TOP + 1.4, ph = t * 0.22, m = 0.07;
    const cr = [];
    posts(cr, [[mx - m, mz - m], [mx + m, mz - m], [mx + m, mz + m], [mx - m, mz + m]], 0, top);
    for (let y = 0; y < top - 0.3; y += 0.35) seg(cr, [mx - m, y, mz - m], [mx + m, y + 0.35, mz - m]);
    const dx = Math.cos(ph), dz = Math.sin(ph);
    const tip = [mx + dx * 2.6, top, mz + dz * 2.6], tail = [mx - dx * 0.9, top, mz - dz * 0.9], apex = [mx, top + 0.6, mz];
    seg(cr, tail, tip); seg(cr, apex, tip); seg(cr, apex, tail);
    const hook = [mx + dx * 1.9, top, mz + dz * 1.9];
    seg(cr, hook, [hook[0], top - 1.1 - 0.4 * Math.sin(t * 0.7), hook[2]]);
    stroke(cr, 'rgba(255,138,31,0.9)', 1.2);

    return { deg: ((a * 180 / Math.PI) % 360 + 360) % 360, floor: Math.max(1, built) };
  }

  function readout(r) {
    if (!r) return;
    rotEl.textContent = 'ROT ' + String(Math.round(r.deg)).padStart(3, '0') + '°';
    progEl.textContent = '进度 F' + String(r.floor).padStart(2, '0') + ' / ' + FLOORS;
  }

  const t0 = performance.now();
  let n = 0;
  function frame(now) {
    if (!document.hidden) {
      const r = draw((now - t0) / 1000);
      if (n++ % 6 === 0) readout(r);
    }
    requestAnimationFrame(frame);
  }

  new ResizeObserver(() => { size(); if (still) readout(draw(12)); }).observe(cv);
  if (!still) requestAnimationFrame(frame);
})();
