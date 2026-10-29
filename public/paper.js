/* v4 paper: every receipt gets its own crumple, rendered once per size.
   A height field of short creases + a few long folds + soft lumps is lit from the top-left
   and laid over the sheet (text included, like a photo). The same field lifts the edges,
   which sets how far the cast shadow reaches; top and bottom edges are torn. */
(() => {
  'use strict';
  const K = 0.5, CELL = 170, M = 40;
  const hash = (a, b, c) => { let h = 2166136261 ^ a; h = Math.imul(h ^ b, 16777619); h = Math.imul(h ^ c, 16777619); h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; return h >>> 0; };
  const rng = seed => { let s = seed >>> 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

  function heightmap(seed, W, H) {
    const w = Math.ceil(W * K) + 1, h = Math.ceil(H * K) + 1, f = new Float32Array(w * h);
    const add = (cx, cy, ang, R, L, s) => {
      const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const ex = Math.abs(ux) * L + Math.abs(nx) * 3 * R, ey = Math.abs(uy) * L + Math.abs(ny) * 3 * R;
      const x0 = Math.max(0, Math.floor((cx - ex) * K)), x1 = Math.min(w - 1, Math.ceil((cx + ex) * K));
      const y0 = Math.max(0, Math.floor((cy - ey) * K)), y1 = Math.min(h - 1, Math.ceil((cy + ey) * K));
      const amp = s * R, iL = 1 / L, iR = 1 / R, i3R = 1 / (3 * R);
      for (let y = y0; y <= y1; y++) {
        const py = y / K - cy;
        for (let x = x0; x <= x1; x++) {
          const px = x / K - cx, t = (px * ux + py * uy) * iL;
          if (t <= -1 || t >= 1) continue;
          const d = px * nx + py * ny, q = d * i3R;
          if (q <= -1 || q >= 1) continue;
          const bt = 1 - t * t, bq = 1 - q * q;
          f[y * w + x] += amp * (1 - Math.exp(-Math.abs(d) * iR)) * bt * bt * bq * bq;
        }
      }
    };
    const nx = Math.ceil(W / CELL), ny = Math.ceil(H / CELL);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const r = rng(hash(seed, i, j)), n = 3 + (r() * 4 | 0);
      for (let k = 0; k < n; k++) { const big = r() < .2; add((i + r()) * CELL, (j + r()) * CELL, r() * Math.PI, big ? 18 + r() * 16 : 5 + r() * 14, big ? 90 + r() * 140 : 25 + r() * 90, (r() < .5 ? -1 : 1) * (big ? .02 + r() * .025 : .025 + r() * .045)); }
    }
    const r = rng(hash(seed, 77, 77));
    for (let y = 160 + r() * 360; y < H - 60; y += 430 + r() * 640)
      add(W * (.4 + r() * .2), y, (r() - .5) * .14, 24 + r() * 26, W * 1.3, (r() < .65 ? 1 : -1) * (.035 + r() * .03));
    if (W > 420 && r() < .8) add(W * (.36 + r() * .28), H / 2, Math.PI / 2 + (r() - .5) * .03, 40, H * .62, .025);
    // soft lumps
    const G = 210, gw = Math.ceil(W / G) + 2, g = new Float32Array(gw * (Math.ceil(H / G) + 2));
    for (let i = 0; i < g.length; i++) g[i] = (r() - .5) * 12;
    for (let y = 0; y < h; y++) {
      const fy = y / K / G, iy = fy | 0, ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = x / K / G, ix = fx | 0, tx = fx - ix, sx = tx * tx * (3 - 2 * tx), o = iy * gw + ix;
        const top = g[o] + (g[o + 1] - g[o]) * sx, bot = g[o + gw] + (g[o + gw + 1] - g[o + gw]) * sx;
        f[y * w + x] += top + (bot - top) * sy;
      }
    }
    return { f, w, h };
  }

  const LIGHT = (() => { const v = [-.42, -.64, .64], n = Math.hypot(...v); return v.map(a => a / n); })();
  const HALF = (() => { const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], n = Math.hypot(...v); return v.map(a => a / n); })();
  function shade(hm, seed) {
    const { f, w, h } = hm, img = new ImageData(w, h), d = img.data, step = 2 / K, r = rng(seed * 31 + 7);
    const [lx, ly, lz] = LIGHT, [hx, hy, hz] = HALF, spec0 = Math.pow(hz, 36);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = (f[x < w - 1 ? i + 1 : i] - f[x ? i - 1 : i]) / step, gy = (f[y < h - 1 ? i + w : i] - f[y ? i - w : i]) / step;
      const nl = 1 / Math.sqrt(gx * gx + gy * gy + 1), nx = -gx * nl, ny = -gy * nl, nz = nl;
      const diff = nx * lx + ny * ly + nz * lz - lz;
      const sp = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 36) - spec0;
      const v = diff + sp * .12 + (r() - .5) * .02, o = i * 4;
      if (v < 0) { d[o] = 62; d[o + 1] = 62; d[o + 2] = 60; d[o + 3] = Math.min(90, -v * 340); }
      else { d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.min(150, v * 460); }
    }
    return img;
  }

  // outline: torn top/bottom, very slightly uneven sides
  function outline(seed, W, H, torn) {
    const r = rng(hash(seed, 3, 1)), pts = [];
    const tear = (y0, dir) => {
      const out = [], slant = (r() - .5) * 3; let x = 0, drift = 0;
      while (x < W) {
        drift += (r() - .5) * .9; drift *= .85;
        out.push([x, y0 + dir * (1.4 + Math.abs(drift) * 2.2 + r() * 1.8 + slant * x / W + (slant < 0 ? -slant : 0))]);
        x += 1.5 + r() * 3.5;
      }
      out.push([W, y0 + dir * (1.5 + r() * 2)]);
      return out;
    };
    const side = (x0, y0, y1) => { const out = []; for (let y = y0; dirOk(y, y0, y1); y += (y1 > y0 ? 1 : -1) * (30 + r() * 40)) out.push([x0 + (r() - .5) * .9, y]); return out; };
    const dirOk = (y, a, b) => b > a ? y < b : y > b;
    const top = torn ? tear(0, 1) : [[0, 0], [W, 0]];
    const bot = (torn ? tear(H, -1) : [[0, H], [W, H]]).reverse();
    pts.push(...top, ...side(W - .4, 6, H - 6), ...bot, ...side(.4, H - 6, 6));
    return pts;
  }
  const trace = (g, pts, dx = 0, dy = 0) => { g.moveTo(pts[0][0] + dx, pts[0][1] + dy); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy); g.closePath(); };

  function render(s) {
    const el = s.el, W = el.clientWidth, H = s.scroller ? el.scrollHeight : el.offsetHeight;
    if (W < 20 || H < 20 || (W === s.w && H === s.h)) return;
    s.w = W; s.h = H;
    const hm = heightmap(s.seed, W, H);
    const off = document.createElement('canvas'); off.width = hm.w; off.height = hm.h;
    off.getContext('2d').putImageData(shade(hm, s.seed), 0, 0);
    const c = s.cv; c.width = W; c.height = H; c.style.height = H + 'px';
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(off, 0, 0, hm.w / K, hm.h / K);
    const poly = outline(s.seed, W, H, s.torn);
    x.beginPath(); x.rect(-4, -4, W + 8, H + 8); trace(x, poly); x.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff'; x.fill('evenodd');
    if (!s.sh) return;
    // cast shadow: offset grows where the crumpled sheet lifts off the table
    let mean = 0; for (let i = 0; i < hm.f.length; i += 7) mean += hm.f[i]; mean /= Math.ceil(hm.f.length / 7);
    const lift = p => { const xi = Math.min(hm.w - 1, Math.max(0, Math.round(p[0] * K))), yi = Math.min(hm.h - 1, Math.max(0, Math.round(p[1] * K))); return Math.max(.6, Math.min(9, 1.6 + (hm.f[yi * hm.w + xi] - mean) * .45)); };
    const sc = s.sh; sc.width = W + 2 * M; sc.height = H + 2 * M;
    Object.assign(sc.style, { left: -M + 'px', top: -M + 'px', width: W + 2 * M + 'px', height: H + 2 * M + 'px' });
    const g = sc.getContext('2d'), BIG = 20000;
    const shadow = (pts, blur, a) => { g.save(); g.shadowColor = `rgba(20,20,18,${a})`; g.shadowBlur = blur; g.shadowOffsetX = BIG; g.beginPath(); trace(g, pts, M - BIG, M); g.fillStyle = '#000'; g.fill(); g.restore(); };
    const cast = poly.map(p => { const l = lift(p); return [p[0] + l * .5, p[1] + l * 1.05]; });
    const near = poly.map(p => { const l = lift(p); return [p[0] + l * .12, p[1] + l * .3]; });
    shadow(poly, 26, .07);
    shadow(cast, 9, .16);
    shadow(near, 2, .28);
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); trace(g, poly, M, M); g.fill();
  }

  const sheets = [];
  const queue = new Set(); let timer = 0;
  const schedule = s => { queue.add(s); clearTimeout(timer); timer = setTimeout(() => { const list = [...queue]; queue.clear(); (window.requestIdleCallback || (f => setTimeout(f, 1)))(() => list.forEach(render)); }, 180); };
  function install(el, seed, o = {}) {
    if (!el) return;
    const s = { el, seed, scroller: !!o.scroller, torn: o.torn !== false, w: 0, h: 0 };
    s.cv = document.createElement('canvas'); s.cv.className = 'sheet-shade'; s.cv.setAttribute('aria-hidden', 'true');
    el.appendChild(s.cv);
    if (!o.scroller) { s.sh = document.createElement('canvas'); s.sh.className = 'sheet-shadow'; s.sh.setAttribute('aria-hidden', 'true'); el.appendChild(s.sh); }
    sheets.push(s);
    const ro = new ResizeObserver(() => schedule(s));
    ro.observe(el); [...el.children].forEach(ch => { if (ch !== s.cv && ch !== s.sh) ro.observe(ch); });
    schedule(s);
  }
  const start = () => {
    install(document.getElementById('view-music'), 11);
    install(document.getElementById('view-community'), 23);
    install(document.getElementById('side'), 37, { scroller: true });
    install(document.querySelector('.modal-card'), 51, { scroller: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sheets.forEach(schedule));
})();
