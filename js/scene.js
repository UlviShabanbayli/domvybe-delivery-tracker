// The isometric street: built once as SVG, then driven by one number (order-minutes) plus a few real-time
// transitions (pizza into the box, lid, box leaves, courier walks, door, confetti).
// Moving things are their own small composited layers (scooter, courier, flying pizza, glow, smoke, pin), so a frame
// usually costs a CSS transform, not a repaint of the map.
import { projector, render, paint, svgEl, box, Mesh } from './iso.js';
import * as M from './models.js';
import { T, rideShare } from './timeline.js';

export const W = 1000, H = 500;
const K = 36, OX = 568, OY = 186;
export const P = projector(OX, OY, K);

// ---------------------------------------------------------------- the route (world units)
const ROAD_W = 1.75, R = 3.2, R2 = 1.25;
const ROAD_Y = 8.4, ROAD_X = 7.0;
const ROUTE = (() => {
  const segs = [];
  const line = (a, b) => segs.push({ k: 'l', a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  const arc = (c, a0, a1) => segs.push({ k: 'a', c, a0, a1, r: R, len: Math.abs(a1 - a0) * R });
  line([0.25, ROAD_Y], [ROAD_X - R, ROAD_Y]);
  arc([ROAD_X - R, ROAD_Y - R], Math.PI / 2, 0);
  line([ROAD_X, ROAD_Y - R], [ROAD_X, 1.6]);
  let acc = 0; for (const s of segs) { s.s0 = acc; acc += s.len; }
  return { segs, len: acc };
})();

export function routeAt(s) {
  s = Math.max(0, Math.min(ROUTE.len, s));
  let seg = ROUTE.segs[ROUTE.segs.length - 1];
  for (const g of ROUTE.segs) if (s <= g.s0 + g.len) { seg = g; break; }
  const u = seg.len ? (s - seg.s0) / seg.len : 0;
  if (seg.k === 'l') {
    const dx = seg.b[0] - seg.a[0], dy = seg.b[1] - seg.a[1];
    return { x: seg.a[0] + dx * u, y: seg.a[1] + dy * u, h: Math.atan2(dy, dx) };
  }
  const a = seg.a0 + (seg.a1 - seg.a0) * u, dir = Math.sign(seg.a1 - seg.a0);
  return { x: seg.c[0] + Math.cos(a) * seg.r, y: seg.c[1] + Math.sin(a) * seg.r, h: Math.atan2(dir * Math.cos(a), -dir * Math.sin(a)) };
}
export const ROUTE_LEN = ROUTE.len;
/** km left for the copy (the ride is ~4.6 km) */
export const kmLeft = (t) => +(4.6 * (1 - rideShare(t))).toFixed(1);

// ---------------------------------------------------------------- world layout
const STREETS_X = [0, 7.0, 13.2, 19.4, 25.6];
const STREETS_Y = [-4, 0.6, 8.4, 14.4, 20.4, 26.4];
const SW = 1.25, WX = -6.5;                        // street width; the shop wall plane
const OVEN = [-3.0, 8.0], BOXAT = [-4.85, 0.35], PLAZA_Z = 0.35, OVEN_SCALE = 1.28;
const HOUSE = { x: 2.7, y: -3.5, w: 2.9, d: 3.0, h: 2.2 }, DOOR = { y0: -2.35, w: 0.95, h: 1.72 };
const COURIER_END = [6.55, -3.05], COURIER_HEADING = Math.PI / 4 + 0.35, COURIER_SCALE = 0.82;
const PARK_AT = 4.6;                     // where the scooter waits on the road while the kitchen works
const PARK = new Set(['7,14.4', '13.2,0.6', '0,20.4', '19.4,8.4', '13.2,-4']);
const POND = '0,0.6';

export function kit(P) {
  const pts = (arr) => arr.map((p) => P(p[0], p[1], p[2] || 0).map((v) => v.toFixed(1)).join(',')).join(' ');
  return {
    P, pts,
    quad: (g, x0, y0, x1, y1, z, fill, extra = {}) => svgEl('polygon', { points: pts([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]), fill, ...extra }, g),
    poly: (g, arr, fill, extra = {}) => svgEl('polygon', { points: pts(arr), fill, ...extra }, g),
    line: (g, arr, attrs) => svgEl('polyline', { points: pts(arr), fill: 'none', ...attrs }, g),
    mesh: (g, mesh, o) => { const gg = svgEl('g', {}, g); for (const p of render(mesh, P, o)) svgEl('polygon', { points: p.points, fill: p.fill, stroke: p.fill, 'stroke-width': 0.6, 'stroke-linejoin': 'round' }, gg); return gg; },
  };
}
const KM = kit(P);
/** a projector that scales everything around a ground point: used to draw the oven a little larger than life */
export function scaled(P0, c, f) { const q = (x, y, z = 0) => P0(c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f, c[2] + (z - c[2]) * f); q.k = P0.k * f; return q; }
const { pts, quad, poly } = KM, drawMesh = KM.mesh;
const OVEN_KIT = kit(scaled(P, [OVEN[0], OVEN[1], PLAZA_Z], OVEN_SCALE));

function buildGround(svg) {
  const g = svgEl('g', { class: 'ground' }, svg);
  svgEl('rect', { x: -50, y: -50, width: W + 100, height: H + 100, fill: M.C.grass }, g);
  // grass texture: mown stripes
  for (const [x, y] of [[9, -8], [12, -6.6], [15, -9], [2, -9.5], [18, -6], [8, -11]]) quad(g, x, y, x + 2.2, y + 0.45, 0, M.C.grassDark, { opacity: 0.35 });
  // map: street colour underneath, blocks on top
  quad(g, 0, -4.6, 40, 40, 0, M.C.street);
  for (let i = 0; i < STREETS_X.length - 1; i++) for (let j = 0; j < STREETS_Y.length - 1; j++) {
    const x0 = STREETS_X[i] + (i === 0 ? 0.3 : SW / 2), x1 = STREETS_X[i + 1] - SW / 2, y0 = STREETS_Y[j] + (j === 0 ? 0.2 : SW / 2), y1 = STREETS_Y[j + 1] - SW / 2;
    const key = `${STREETS_X[i]},${STREETS_Y[j]}`;
    if (key === POND) {
      quad(g, x0, y0, x1, y1, 0, M.C.block);
      poly(g, [[x0 + 0.5, y0 + 0.5], [x1 - 0.5, y0 + 0.5], [x1 - 0.5, y0 + 2.6], [x0 + 2.4, y0 + 2.6], [x0 + 2.4, y1 - 0.5], [x0 + 0.5, y1 - 0.5]], M.C.water);
      continue;
    }
    quad(g, x0, y0, x1, y1, 0, PARK.has(key) ? M.C.grass : M.C.block);
    if (!PARK.has(key) && (i + j) % 2 === 1) quad(g, x0 + 0.45, y0 + 0.45, (x0 + x1) / 2 - 0.2, y1 - 0.45, 0, '#e4d0b3');
    if (!PARK.has(key) && (i + j) % 2 === 0) quad(g, (x0 + x1) / 2 + 0.2, y0 + 0.45, x1 - 0.45, (y0 + y1) / 2 - 0.2, 0, '#e4d0b3');
  }
  return g;
}

function buildRoad(svg) {
  const g = svgEl('g', { class: 'road' }, svg);
  const L = [], Rr = [];
  for (let s = 0; s <= ROUTE.len + 1e-6; s += 0.12) {
    const p = routeAt(s), nx = -Math.sin(p.h), ny = Math.cos(p.h);
    L.push([p.x + nx * ROAD_W / 2, p.y + ny * ROAD_W / 2, 0.01]); Rr.push([p.x - nx * ROAD_W / 2, p.y - ny * ROAD_W / 2, 0.01]);
  }
  const end = routeAt(ROUTE.len), ex = Math.cos(end.h) * 0.6, ey = Math.sin(end.h) * 0.6;
  L.push([L[L.length - 1][0] + ex, L[L.length - 1][1] + ey, 0.01]); Rr.push([Rr[Rr.length - 1][0] + ex, Rr[Rr.length - 1][1] + ey, 0.01]);
  poly(g, [...L, ...Rr.reverse()], M.C.asphalt);
  // centre dashes
  for (let s = 0.6; s < ROUTE.len - 0.4; s += 0.95) {
    const a = routeAt(s), b = routeAt(s + 0.45), nx = -Math.sin(a.h) * 0.07, ny = Math.cos(a.h) * 0.07;
    poly(g, [[a.x + nx, a.y + ny, 0.02], [b.x + nx, b.y + ny, 0.02], [b.x - nx, b.y - ny, 0.02], [a.x - nx, a.y - ny, 0.02]], M.C.dash);
  }
  return g;
}

function buildPlaza(svg) {
  const g = svgEl('g', { class: 'plaza' }, svg);
  drawMesh(g, box(WX - 2, -4.6, 0, -WX + 2, 34, PLAZA_Z, '#d8d3cb', { colors: { right: '#b7afa4', left: '#c5beb4' } }));
  // paving seams
  for (let x = WX + 1.6; x < 0; x += 2.2) svgEl('polyline', { points: pts([[x, -4.6, PLAZA_Z], [x, 29.4, PLAZA_Z]]), stroke: '#cdc7be', 'stroke-width': 1.2, fill: 'none' }, g);
  for (let y = -2.4; y < 29; y += 2.2) svgEl('polyline', { points: pts([[WX, y, PLAZA_Z], [0, y, PLAZA_Z]]), stroke: '#cdc7be', 'stroke-width': 1.2, fill: 'none' }, g);
  return g;
}

function buildWall(svg) {
  const g = svgEl('g', { class: 'wall' }, svg);
  const z0 = PLAZA_Z, y0 = -4.6, y1 = 29.4;
  poly(g, [[WX, y0, z0], [WX, y1, z0], [WX, y1, 9], [WX, y0, 9]], M.C.tomato);
  // shop window with a frame, between the box and the oven
  poly(g, [[WX, 3.6, z0 + 0.6], [WX, 6.9, z0 + 0.6], [WX, 6.9, z0 + 2.7], [WX, 3.6, z0 + 2.7]], '#f7e7cf');
  poly(g, [[WX, 3.8, z0 + 0.8], [WX, 6.7, z0 + 0.8], [WX, 6.7, z0 + 2.5], [WX, 3.8, z0 + 2.5]], '#a7d3e3');
  poly(g, [[WX, 3.8, z0 + 2.5], [WX, 4.8, z0 + 2.5], [WX, 6.7, z0 + 0.8], [WX, 5.7, z0 + 0.8]], '#c5e4ef');
  // awning: stripes sloping out of the wall
  for (let i = 0; i < 9; i++) {
    const a = 3.3 + i * 0.42, b = a + 0.42;
    poly(g, [[WX, a, z0 + 3.5], [WX, b, z0 + 3.5], [WX + 0.95, b, z0 + 2.85], [WX + 0.95, a, z0 + 2.85]], i % 2 ? '#fbf2e3' : '#b8321d');
  }
  // sign: brand mark painted on the wall
  const [sx, sy] = P(WX, 7.6, z0 + 3.55);
  const t = svgEl('text', { x: 0, y: 0, transform: `matrix(1 -0.5 0 1 ${sx.toFixed(1)} ${sy.toFixed(1)})`, class: 'wall-sign', fill: '#fbf2e3' }, g);
  t.textContent = 'pizzatime';
  // the door at the plaza front
  poly(g, [[WX, 16.2, z0], [WX, 18.0, z0], [WX, 18.0, z0 + 3.0], [WX, 16.2, z0 + 3.0]], '#7c3a20');
  poly(g, [[WX, 16.4, z0], [WX, 17.8, z0], [WX, 17.8, z0 + 2.8], [WX, 16.4, z0 + 2.8]], '#9a5a33');
  return g;
}

export function buildOven(svg, defs, k = OVEN_KIT, at = [OVEN[0], OVEN[1], PLAZA_Z], id = 'main') {
  const { P, pts, poly } = k;
  const g = svgEl('g', { class: 'oven' }, svg);
  const [ox, oy, z] = at;
  const o = M.oven(ox, oy, z);
  k.mesh(g, o.mesh, { sort: 'insertion' });
  // brick courses on the visible faces of the base
  const b = 1.75, x1 = ox + b, y1 = oy + b;
  const mortar = { stroke: '#93401f', 'stroke-width': 1.1 * P.k / K, fill: 'none', 'stroke-linecap': 'round' };
  for (let n = 1; n < 5; n++) {
    const zz = z + n * 0.29;
    svgEl('polyline', { points: pts([[x1, oy - b, zz], [x1, y1, zz], [ox - b, y1, zz]]), ...mortar }, g);
    for (let j = 0; j < 7; j++) {
      const off = (n % 2 ? 0.25 : 0.5) + j * 0.5;
      if (off < 2 * b) svgEl('polyline', { points: pts([[x1, oy - b + off, zz], [x1, oy - b + off, zz - 0.29]]), ...mortar }, g);
      if (off < 2 * b) svgEl('polyline', { points: pts([[ox - b + off, y1, zz], [ox - b + off, y1, zz - 0.29]]), ...mortar }, g);
    }
  }
  // logs under the oven (recess on the +x face)
  const lg = o.logs;
  poly(g, [[lg.x, lg.cy - 1.1, z + 0.1], [lg.x, lg.cy + 1.1, z + 0.1], [lg.x, lg.cy + 1.1, z + 0.85], [lg.x, lg.cy - 1.1, z + 0.85]], '#4a2516');
  for (const [dy, dz] of [[-0.7, 0.28], [-0.2, 0.28], [0.3, 0.28], [0.8, 0.28], [-0.45, 0.62], [0.05, 0.62], [0.55, 0.62]]) {
    poly(g, M.circleX(lg.x + 0.02, lg.cy + dy, z + dz, 0.22), '#c79a63');
    poly(g, M.circleX(lg.x + 0.03, lg.cy + dy, z + dz, 0.12), '#a8784a');
  }
  // dome brick rings
  for (const [frac, op] of [[0.42, 0.5], [0.7, 0.45]]) {
    const ring = []; const r = 1.62, cz = o.dz;
    for (let i = 0; i <= 26; i++) { const a = -Math.PI * 0.15 + i / 26 * Math.PI * 1.3; const th = frac * Math.PI / 2;
      ring.push([ox - 0.15 + Math.cos(a) * Math.sin(th) * r, oy + Math.sin(a) * Math.sin(th) * r, cz + Math.cos(th) * r * 0.92]); }
    svgEl('polyline', { points: pts(ring), stroke: '#a24a29', 'stroke-width': 1.3 * P.k / K, fill: 'none', opacity: op }, g);
  }
  // mouth: glowing opening + arch bricks
  const mo = o.mouth, arch = M.archPts(mo.x, mo.cy, mo.base, mo.h0, mo.r);
  poly(g, M.archPts(mo.x, mo.cy, mo.base, mo.h0, mo.r + 0.22), '#9e4426');
  for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI; svgEl('polyline', { points: pts([[mo.x, mo.cy + Math.cos(a) * mo.r, mo.base + mo.h0 + Math.sin(a) * mo.r], [mo.x, mo.cy + Math.cos(a) * (mo.r + 0.22), mo.base + mo.h0 + Math.sin(a) * (mo.r + 0.22)]]), stroke: '#7d3219', 'stroke-width': 1.1 * P.k / K }, g); }
  const grad = svgEl('radialGradient', { id: 'oven-fire-' + id, cx: '50%', cy: '62%', r: '62%' }, defs);
  for (const [o_, c] of [[0, '#fff3c4'], [0.35, '#ffc65a'], [0.75, '#f07f2a'], [1, '#a5341b']]) svgEl('stop', { offset: o_, 'stop-color': c }, grad);
  const mouth = poly(g, arch, `url(#oven-fire-${id})`, { class: 'mouth' });
  const clip = svgEl('clipPath', { id: 'mouth-clip-' + id }, defs); svgEl('polygon', { points: mouth.getAttribute('points') }, clip);
  const pz = svgEl('g', { 'clip-path': `url(#mouth-clip-${id})`, class: 'oven-pizza' }, g);
  M.pizza(pz, P, mo.x - 0.5, mo.cy + 0.05, mo.base + 0.04, 0.62);
  return { g, pizza: pz, mouth: P(mo.x, mo.cy, mo.base + mo.h0 * 0.8), chimney: P(ox - 0.75, oy - 0.35, o.dz + 2.95) };
}

export function buildBox(svg, k = KM, at = [BOXAT[0], BOXAT[1], PLAZA_Z]) {
  const { P, poly } = k, drawMesh = k.mesh;
  const g = svgEl('g', { class: 'pbox' }, svg);
  const [x, y, z] = at;
  const t = M.tray(x, y, z);
  const shadow = poly(g, [[x - 0.1, y + 0.2, z], [x + M.BOX.w + 0.35, y + 0.2, z], [x + M.BOX.w + 0.35, y + M.BOX.d + 0.35, z], [x - 0.1, y + M.BOX.d + 0.35, z]], '#000', { opacity: 0.1 });
  const lidBack = svgEl('g', {}, g);
  drawMesh(g, t.back, { cull: false, sort: false });
  drawMesh(g, t.floor, { cull: false, sort: false });
  const pz = svgEl('g', { class: 'box-pizza' }, g);
  M.pizza(pz, P, x + M.BOX.w / 2, y + M.BOX.d / 2, z + 0.06, 1.0);
  drawMesh(g, t.front);
  const lidFront = svgEl('g', {}, g);
  const logo = svgEl('g', { class: 'lid-logo' }, g);
  return { g, pizza: pz, lidBack, lidFront, logo, shadow, at: [x, y, z], k, center: P(x + M.BOX.w / 2, y + M.BOX.d / 2, z + 0.3) };
}

function buildHouse(svg) {
  const g = svgEl('g', { class: 'house' }, svg);
  const { x, y, w, d, h } = HOUSE, xw = x + w, yw = y + d, y0 = DOOR.y0, y1 = y0 + DOOR.w;
  poly(g, [[x + 0.3, yw, 0], [xw + 0.75, yw, 0], [xw + 0.75, y + 0.2, 0]], '#000', { opacity: 0.1 });
  // front path from the door to the lane
  poly(g, [[xw, y0 - 0.05, 0.004], [ROAD_X - 0.8, y0 - 0.05, 0.004], [ROAD_X - 0.8, y1 + 0.05, 0.004], [xw, y1 + 0.05, 0.004]], '#efe3cf');
  drawMesh(g, M.house(x, y, w, d, h));
  // windows: two on the +y wall, one in the gable
  for (const wx of [x + 0.3, x + 1.45]) poly(g, [[wx, yw + 0.005, 0.62], [wx + 0.7, yw + 0.005, 0.62], [wx + 0.7, yw + 0.005, 1.22], [wx, yw + 0.005, 1.22]], '#9fcfe1');
  poly(g, [[xw + 0.005, y + d / 2 - 0.28, h + 0.22], [xw + 0.005, y + d / 2 + 0.28, h + 0.22], [xw + 0.005, y + d / 2 + 0.28, h + 0.7], [xw + 0.005, y + d / 2 - 0.28, h + 0.7]], '#8fc2d6');
  // door opening (warm light inside) on the +x wall, facing the lane, plus a doormat
  poly(g, [[xw + 0.004, y0 - 0.08, 0], [xw + 0.004, y1 + 0.08, 0], [xw + 0.004, y1 + 0.08, DOOR.h + 0.09], [xw + 0.004, y0 - 0.08, DOOR.h + 0.09]], '#7a4526');
  poly(g, [[xw + 0.006, y0, 0], [xw + 0.006, y1, 0], [xw + 0.006, y1, DOOR.h], [xw + 0.006, y0, DOOR.h]], M.C.doorIn);
  poly(g, [[xw + 0.1, y0 - 0.1, 0.01], [xw + 0.62, y0 - 0.1, 0.01], [xw + 0.62, y1 + 0.1, 0.01], [xw + 0.1, y1 + 0.1, 0.01]], '#5f9a45');
  const door = svgEl('g', { class: 'door' }, g);
  return { g, door, doorAt: P(xw + 0.3, (y0 + y1) / 2, 1.0), pinAt: P(x + w / 2, y + d / 2, h + 1.55) };
}

function buildProps(svg) {
  const g = svgEl('g', { class: 'props' }, svg);
  const items = [M.topiary(-1.6, 12.8, PLAZA_Z), M.topiary(-0.9, -3.7, PLAZA_Z),
    M.tree(11.6, 5.2), M.tree(16.2, 5.4), M.tree(3.4, 11.4, 0.7), M.tree(10.2, 17.2), M.tree(15.6, 17.6, 0.7), M.tree(2.4, -6.6, 0.75), M.tree(6.4, -6.8, 0.8), M.tree(14.8, -2.0, 0.7), M.tree(10.6, -1.8, 0.7), M.tree(1.2, -0.6, 0.6)];
  items.push(M.boxStack(-3.9, -3.2, PLAZA_Z));
  items.sort((a, b) => depthOf(a) - depthOf(b));
  for (const m of items) drawMesh(g, m);
  return g;
}
const depthOf = (m) => { let s = 0, n = 0; for (const f of m.faces) for (const p of f.pts) { s += p[0] + p[1]; n++; } return s / n; };

// ---------------------------------------------------------------- sprites (small svgs in their own layers)
function sprite(world, cls, vb) {
  const [x, y, w, h] = vb;
  const el = document.createElement('div'); el.className = 'sprite ' + cls;
  el.style.width = (w / W * 100) + '%'; el.style.aspectRatio = `${w} / ${h}`;
  const s = svgEl('svg', { viewBox: vb.join(' '), 'aria-hidden': 'true', focusable: 'false' }); el.appendChild(s);
  world.appendChild(el);
  const g = svgEl('g', {}, s);
  return { el, svg: s, g, vb, last: '', at(sx, sy, extra = '') {
    const v = `translate(${((sx + x) / w * 100).toFixed(3)}%, ${((sy + y) / h * 100).toFixed(3)}%)${extra}`;
    if (v !== this.last) { el.style.transform = v; this.last = v; }
  } };
}

/** the hinged lid of a box built by buildBox; phi 0 = shut, ~1.95 = open (leaning back) */
export function drawLid(box_, phi) {
  const { P, pts } = box_.k;
  const L = M.lid(box_.at[0], box_.at[1], box_.at[2], phi);
  const polys = render(L.mesh, P, { cull: false, sort: false });
  const behind = phi > Math.PI / 2;
  paint(box_.lidBack, behind ? polys : []); paint(box_.lidFront, behind ? [] : polys);
  // printed logo on the lid's outer face: a tomato roundel, only when the outer side shows
  const logo = [];
  if (L.outer) {
    const f = L.frame, cx = (f.A[0] + f.Cc[0]) / 2, cy = (f.A[1] + f.Cc[1]) / 2, cz = (f.A[2] + f.Cc[2]) / 2;
    const ux = [(f.D[0] - f.A[0]) / M.BOX.w, 0, (f.D[2] - f.A[2]) / M.BOX.w];
    const ring = (r) => Array.from({ length: 20 }, (_, i) => { const a = i / 20 * Math.PI * 2; return [cx + Math.cos(a) * r * ux[0], cy + Math.sin(a) * r, cz + Math.cos(a) * r * ux[2] + 0.01]; });
    logo.push({ points: pts(ring(0.62)), fill: '#e5502f' }, { points: pts(ring(0.45)), fill: '#fbf2e3' },
      { points: pts([[cx - 0.28 * ux[0], cy - 0.22, cz + 0.02 - 0.28 * ux[2]], [cx + 0.3 * ux[0], cy, cz + 0.02 + 0.3 * ux[2]], [cx - 0.28 * ux[0], cy + 0.22, cz + 0.02 - 0.28 * ux[2]]]), fill: '#e5502f' });
  }
  paint(box_.logo, logo);
}

// ---------------------------------------------------------------- the scene
export function createScene(root, { reduced = false } = {}) {
  const world = document.createElement('div'); world.className = 'world';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'map', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMinYMin meet' });
  world.appendChild(svg); root.prepend(world);
  const defs = svgEl('defs', {}, svg);
  buildGround(svg); buildRoad(svg); buildPlaza(svg); buildWall(svg);
  const box_ = buildBox(svg);
  const oven = buildOven(svg, defs);
  const house = buildHouse(svg);
  buildProps(svg);
  // things that change after load live in their own small svg layers, so a lid fold or a door swing repaints that
  // layer only, never the 1,100-node map; the box leaving is a compositor opacity fade of its layer
  const layer = (cls, ...gs) => { const l = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'layer ' + cls, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMinYMin meet' }); for (const g of gs) l.appendChild(g); world.appendChild(l); return l; };
  const boxLayer = layer('l-box', box_.g), ovenLayer = layer('l-oven', oven.pizza), doorLayer = layer('l-door', house.door);

  const pct = (sx, sy) => ({ left: (sx / W * 100) + '%', top: (sy / H * 100) + '%' });
  const fx = (cls, sx, sy, html = '') => { const d = document.createElement('div'); d.className = 'fx ' + cls; Object.assign(d.style, pct(sx, sy)); d.innerHTML = html; world.appendChild(d); return d; };

  // oven glow + flames (composited opacity / transform animations)
  const glow = fx('glow', oven.mouth[0], oven.mouth[1]);
  const flames = fx('flames', oven.mouth[0], oven.mouth[1] + 6, '<i></i><i></i><i></i>');
  const smoke = fx('smoke', oven.chimney[0], oven.chimney[1], '<i></i><i></i><i></i>');
  const wisp = (x) => `<svg viewBox="0 0 20 60" style="left:${x}%"><path d="M10 58c-7-9 7-14 0-24c-6-8 6-13 0-22" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/></svg>`;
  const steam = fx('steam', box_.center[0] + 10, box_.center[1] - 20, wisp(8) + wisp(40) + wisp(72));
  // the pin over the house
  const pin = fx('pin', house.pinAt[0], house.pinAt[1], `<div class="pin-bob"><svg viewBox="0 0 64 84" aria-hidden="true"><ellipse cx="32" cy="80" rx="12" ry="4" fill="rgba(0,0,0,.18)"/><path d="M32 2C16 2 4 14 4 29c0 20 24 44 26.6 49.4a1.6 1.6 0 0 0 2.8 0C36 73 60 49 60 29 60 14 48 2 32 2Z" fill="#d93a22"/><path d="M32 2C16 2 4 14 4 29c0 6 2 12 6 18C8 41 8 36 8 32 8 17 19 6 32 6s24 11 24 26c0 4 0 9-2 15 4-6 6-12 6-18C60 14 48 2 32 2Z" fill="#f2694c"/><circle cx="32" cy="29" r="17" fill="#fff"/><g class="pin-house"><path d="M22 30 32 21l10 9v10H22Z" fill="#5b8a3c"/><path d="M19.5 30.5 32 19.5l12.5 11" fill="none" stroke="#d93a22" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="29" y="33" width="6" height="7" rx="1" fill="#fbf2e3"/></g><path class="pin-check" d="M23 29.5l6 6 12-12" fill="none" stroke="#5b8a3c" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`);
  const confetti = fx('confetti', house.doorAt[0], house.doorAt[1]);

  // sprites
  const rider = sprite(world, 'sp-rider', [-130, -175, 260, 220]);
  const shadowEl = svgEl('ellipse', { cx: 0, cy: 5, rx: 62, ry: 19, fill: 'rgba(0,0,0,.16)' }); rider.svg.insertBefore(shadowEl, rider.g);
  const courier = sprite(world, 'sp-courier', [-70, -110, 140, 135]);
  courier.svg.insertBefore(svgEl('ellipse', { cx: 4, cy: 3, rx: 28, ry: 9, fill: 'rgba(0,0,0,.16)' }), courier.g);
  const flyer = sprite(world, 'sp-flyer', [-65, -40, 130, 80]);
  { const p0 = projector(0, 0, K); M.pizza(flyer.g, p0, 0, 0, 0, 1.0); }
  // courier: static pose, plus the pizza on his tray
  { const p0 = projector(0, 0, K), hd = COURIER_HEADING, f = COURIER_SCALE;
    paint(courier.g, render(M.courier(0, 0, 0, hd, f), p0));
    const pz = svgEl('g', {}, courier.svg); M.pizza(pz, p0, 0.91 * f * Math.cos(hd), 0.91 * f * Math.sin(hd), 1.33 * f + 0.02, 0.52 * f / 0.82); }

  // ------------------------------------------------ state
  const A = { boxing: { v: 0, dur: 2.0 }, gone: { v: 0, dur: 0.7 }, arrive: { v: 0, dur: 2.4 } };
  let lastT = null, lastPhi = null, lastDoor = null, riderKey = '', confettiFired = false;
  const riderCache = new Map(), P0 = projector(0, 0, K);
  const LID_OPEN = 1.95;
  const flags = new WeakMap();
  const setFlag = (el, name, on) => { let f = flags.get(el); if (!f) flags.set(el, f = {}); if (f[name] === on) return; f[name] = on; el.classList.toggle(name, on); };

  function drawDoor(a) { paint(house.door, render(M.doorPanelX(HOUSE.x + HOUSE.w, DOOR.y0 + DOOR.w, DOOR.w, DOOR.h, a, -1), P, { cull: false })); }

  const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const seg = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));

  let burstId = 0;
  function burst(staticOnly) {
    confetti.replaceChildren();
    const token = ++burstId;
    const colors = ['#e5502f', '#5b8a3c', '#f6c96e', '#9fd6ea', '#fbf2e3', '#c2311e'];
    const n = staticOnly ? 18 : 42;
    let i = 0;
    const chunk = () => { if (token !== burstId) return; const end = Math.min(n, i + (staticOnly ? n : 14)); for (; i < end; i++) piece(i); if (i < n) requestAnimationFrame(chunk); };
    chunk();
    function piece(i) {
      const p = document.createElement('i'); p.style.background = colors[i % colors.length];
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3, dist = 40 + Math.random() * 90;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.9, rot = (Math.random() - 0.5) * 720;
      confetti.appendChild(p);
      if (staticOnly) { p.style.transform = `translate(${dx.toFixed(1)}px, ${(dy + 30).toFixed(1)}px) rotate(${rot.toFixed(0)}deg)`; return; }
      p.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${(rot / 2).toFixed(0)}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${(dx * 1.2).toFixed(1)}px, ${(dy + 70).toFixed(1)}px) rotate(${rot.toFixed(0)}deg)`, opacity: i % 3 ? 0 : 0.95 }],
      { duration: 1500 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards', delay: Math.random() * 120 });
    }
  }

  /** t: order minutes; dt: real seconds since last frame; snap: jump transitions to their end state */
  function update(t, dt, snap = false, coarse = false) {
    const big = lastT === null || Math.abs(t - lastT) > 0.75;
    const jump = snap || reduced || big;
    lastT = t;
    const target = { boxing: t >= T.boxAt ? 1 : 0, gone: t >= T.rideAt ? 1 : 0, arrive: t >= T.doneAt ? 1 : 0 };
    for (const k in A) {
      const a = A[k];
      if (jump || target[k] < a.v) a.v = target[k];
      else a.v = Math.min(target[k], a.v + dt / a.dur);
    }
    // oven pizza → flying pizza → box pizza; then the lid folds shut
    const b = A.boxing.v;
    const fly = seg(b, 0.02, 0.42);
    setFlag(oven.pizza, 'is-hidden', b > 0.02);
    setFlag(box_.pizza, 'is-hidden', b < 0.42);
    const flying = fly > 0 && fly < 1;
    setFlag(flyer.el, 'is-on', flying);
    if (flying) {
      const e = ease(fly), [x0, y0] = oven.mouth, [x1, y1] = box_.center;
      const sx = x0 + (x1 - x0) * e, sy = y0 + (y1 - y0) * e - Math.sin(e * Math.PI) * 70;
      flyer.at(sx, sy);
    }
    const phi = LID_OPEN * (1 - ease(seg(b, 0.5, 1)));
    if (lastPhi === null || Math.abs(phi - lastPhi) > 0.004) { drawLid(box_, phi); lastPhi = phi; }
    // the box leaves with the courier
    const gone = A.gone.v;
    const op = (1 - gone).toFixed(2);
    if (box_.op !== op) { boxLayer.style.opacity = op; box_.op = op; }
    setFlag(steam, 'is-on', t >= T.boxAt && t < T.rideAt);
    // glow: brightest while baking
    setFlag(glow, 'is-hot', t < T.boxAt);
    setFlag(flames, 'is-hot', t < T.boxAt);

    // scooter
    const arrive = A.arrive.v;
    const s = PARK_AT + rideShare(t) * (ROUTE.len - PARK_AT);
    const p = routeAt(s);
    const withRider = arrive < 0.04;
    const q = coarse ? 3 : 1, deg = Math.round(p.h * 180 / Math.PI / q) * q, key = deg + '|' + withRider;
    if (key !== riderKey) {
      let polys = riderCache.get(key);
      if (!polys) { polys = render(M.scooter(0, 0, 0, deg * Math.PI / 180, withRider), P0); riderCache.set(key, polys); }
      paint(rider.g, polys); riderKey = key;
    }
    const [sx, sy] = P(p.x, p.y, 0);
    rider.at(sx, sy);

    // courier walks from the scooter to the door, the door swings open, confetti
    setFlag(courier.el, 'is-on', arrive > 0.02);
    if (arrive > 0.02) {
      const w = ease(seg(arrive, 0.02, 0.5));
      const from = P(p.x - 0.6, p.y + 0.3, 0), to = P(COURIER_END[0], COURIER_END[1], 0);
      courier.at(from[0] + (to[0] - from[0]) * w, from[1] + (to[1] - from[1]) * w, ` translateY(${(-Math.abs(Math.sin(w * Math.PI * 5)) * 3 * (w < 1 ? 1 : 0)).toFixed(2)}%)`);
    }
    const da = 1.75 * ease(seg(arrive, 0.3, 0.75));
    if (lastDoor === null || Math.abs(da - lastDoor) > 0.004) { drawDoor(da); lastDoor = da; }
    setFlag(pin, 'is-done', arrive > 0.5);
    if (arrive >= 0.5 && !confettiFired) { confettiFired = true; burst(reduced); }
    if (arrive < 0.5 && confettiFired) { confettiFired = false; burstId++; confetti.replaceChildren(); }
    return { scooter: [sx, sy], heading: p.h, focus: focusFor(t, sx, sy) };
  }

  function focusFor(t, sx, sy) {
    if (t < T.boxAt) return [oven.mouth[0] + 60, oven.mouth[1]];
    if (t < T.rideAt) return [box_.center[0] + 40, box_.center[1] + 30];
    if (t < T.doneAt) return [(sx + house.pinAt[0]) / 2, (sy + house.pinAt[1]) / 2 + 40];
    return [house.doorAt[0], house.doorAt[1]];
  }

  // camera: cover the card; pan to the action when the card is narrower than the world
  let s = 1, cam = [0, 0], vis = [W, H], camKey = '';
  function layout() {
    const cw = root.clientWidth, ch = root.clientHeight;
    if (!cw || !ch) return;
    s = Math.max(cw / W, ch / H);
    world.style.width = (W * s) + 'px'; world.style.height = (H * s) + 'px';
    vis = [cw / s, ch / s];
    camKey = '';
  }
  function camera(focus, dt, snap) {
    const tx = Math.max(0, Math.min(W - vis[0], focus[0] - vis[0] * 0.5)), ty = Math.max(0, Math.min(H - vis[1], focus[1] - vis[1] * 0.55));
    if (snap || reduced) cam = [tx, ty];
    else { const k = 1 - Math.exp(-dt * 3.2); cam = [cam[0] + (tx - cam[0]) * k, cam[1] + (ty - cam[1]) * k]; }
    const dpr = devicePixelRatio || 1, r = (v) => Math.round(v * dpr) / dpr;
    const v = `translate3d(${r(-cam[0] * s)}px, ${r(-cam[1] * s)}px, 0)`;
    if (v !== camKey) { world.style.transform = v; camKey = v; }
  }
  new ResizeObserver(() => { layout(); }).observe(root);
  layout();

  /** fill the scooter cache (every whole degree the route can face, with and without the rider) while idle */
  function warm() {
    const keys = []; for (let d = -93; d <= 3; d++) keys.push([d, true], [d, false]);
    const step = (dl) => { while (keys.length && (!dl || dl.timeRemaining() > 2)) { const [d, w] = keys.pop(), k = d + '|' + w; if (!riderCache.has(k)) riderCache.set(k, render(M.scooter(0, 0, 0, d * Math.PI / 180, w), P0)); if (!dl) break; } if (keys.length) idle(step); };
    const idle = window.requestIdleCallback || ((f) => setTimeout(() => f(null), 30));
    idle(step);
  }
  warm();

  /** restart a transition from its beginning (stage tiles): the next frames animate it */
  function replay(name, t) { if (A[name]) A[name].v = 0; lastT = t; if (name === 'arrive') { confettiFired = false; burstId++; confetti.replaceChildren(); } }

  return { update, camera, replay, world, svg, routeLen: ROUTE.len, get scale() { return s; }, get vis() { return vis; } };
}
