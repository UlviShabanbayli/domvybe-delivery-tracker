// Low-poly models for the pizzatime street. Each returns a Mesh in world (or local) units; see iso.js.
import { Mesh, box, cylinder, dome, extrude, wheel, place, svgEl } from './iso.js';

export const C = {
  tomato: '#e5502f', tomatoDeep: '#c2311e', brick: '#b8532f', brickDark: '#8f3a20', ledge: '#7a3a22', dome: '#c4633b',
  cream: '#fbf2e3', block: '#ecdcc4', street: '#fdf8ef', grass: '#7aa156', grassDark: '#5f8a43', water: '#9fd6ea',
  asphalt: '#55585e', dash: '#ffffff', plaza: '#cfcac3', plazaEdge: '#b9b2a8', kraft: '#c99a62', kraftIn: '#e2bd88',
  skin: '#f1c29a', shirt: '#dc452b', trousers: '#5b8a3c', shoe: '#3a2a22', helmet: '#d63a24', tire: '#2c2c30', hub: '#a8aeb5',
  seat: '#3d2b25', chrome: '#d9dde2', pot: '#b9643c', leaf: '#4f8f3a', leafLight: '#6aa84a', house: '#f4e7d2', roof: '#d2492c',
  door: '#9a5a33', doorIn: '#ffd88a', trunk: '#8a5a36', crust: '#e3a256', sauce: '#d8462b', cheese: '#f6d074', pep: '#b5321e', basil: '#4b8a37',
};

const shift = (m, du, dy, dv) => m.map(([u, y, v]) => [u + du, y + dy, v + dv]);

// ---------------------------------------------------------------- pizza (top-down decal: ellipses, cheap and crisp)
const R2 = Math.SQRT2;
/** draw a pizza lying flat at world (x,y,z) with radius r into an svg group, using projector P */
export function pizza(g, P, x, y, z, r, o = {}) {
  const k = P.k, [cx, cy] = P(x, y, z);
  const e = (dx, dy, rr, fill, extra = {}) => { const [px, py] = P(x + dx, y + dy, z + (extra.dz || 0)); return svgEl('ellipse', { cx: px.toFixed(2), cy: py.toFixed(2), rx: (R2 * rr * k).toFixed(2), ry: (R2 * rr * k / 2).toFixed(2), fill }, g); };
  e(0, 0, r, '#c98a44', { dz: -0.02 });
  e(0, 0, r * 0.97, C.crust);
  e(0, 0, r * 0.84, C.sauce, { dz: 0.01 });
  const ch = svgEl('g', {}, g);
  // cheese: a soft lumpy disc made of overlapping blobs
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.3, d = r * 0.42; e(Math.cos(a) * d, Math.sin(a) * d, r * 0.36, C.cheese, { dz: 0.02 }); }
  e(0, 0, r * 0.5, C.cheese, { dz: 0.02 });
  const pts = o.peps || [[0.5, 0.2], [-0.15, 0.55], [-0.5, -0.1], [0.1, -0.5], [0.2, 0.05], [-0.3, 0.25], [0.48, -0.32], [-0.2, -0.3]];
  for (const [u, v] of pts) e(u * r, v * r, r * 0.13, C.pep, { dz: 0.03 });
  for (const [u, v] of [[0.3, 0.45], [-0.45, 0.35], [-0.05, -0.15], [0.35, -0.55]]) {
    const [px, py] = P(x + u * r, y + v * r, z + 0.04);
    svgEl('ellipse', { cx: px.toFixed(2), cy: py.toFixed(2), rx: (r * k * 0.2).toFixed(2), ry: (r * k * 0.09).toFixed(2), fill: C.basil, transform: `rotate(${(u * 90 + v * 40).toFixed(0)} ${px.toFixed(2)} ${py.toFixed(2)})` }, g);
  }
  return ch;
}

// ---------------------------------------------------------------- oven
/** the wood-fired oven, base centred at (cx, cy) on a floor at z. Returns {mesh, mouth:{...}} so the scene can add glow decals */
export function oven(cx, cy, z) {
  const m = new Mesh();
  const b = 1.75;                                 // half size of the base
  m.add(box(cx - b, cy - b, z, b * 2, b * 2, 1.45, C.brick, { colors: { top: C.ledge } }));
  m.add(box(cx - b - 0.12, cy - b - 0.12, z + 1.45, b * 2 + 0.24, b * 2 + 0.24, 0.24, C.ledge));
  const dz = z + 1.69;
  m.add(dome(cx - 0.15, cy, dz, 1.62, C.dome, { seg: 26, rings: 9, sz: 0.92 }));
  // chimney (behind the dome top, slightly back)
  m.add(cylinder(cx - 0.75, cy - 0.35, dz + 1.25, 0.3, 1.55, '#6e4a3a', 14, { topColor: '#3b2a24' }));
  m.add(cylinder(cx - 0.75, cy - 0.35, dz + 2.7, 0.38, 0.18, '#5a3c30', 14, { topColor: '#2c201b' }));
  // the arched portal on the +x side
  const ar = 0.95, base = dz, h0 = 0.55; const prof = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI - i / 12 * Math.PI; prof.push([cy + Math.cos(a) * ar, base + h0 + Math.sin(a) * ar]); }
  prof.push([cy + ar, base], [cy - ar, base]);
  const portal = new Mesh();
  const x0 = cx + 0.7, x1 = cx + b + 0.12;
  const P0 = prof.map(([yy, zz]) => [x0, yy, zz]), P1 = prof.map(([yy, zz]) => [x1, yy, zz]);
  const ctr = [(x0 + x1) / 2, cy, base + 0.6];
  portal.face(P1, C.brick, { center: ctr });
  for (let i = 0; i < prof.length; i++) { const j = (i + 1) % prof.length; portal.face([P0[i], P0[j], P1[j], P1[i]], C.brick, { center: ctr }); }
  m.add(portal);
  return { mesh: m, mouth: { x: x1 + 0.005, cy, base, h0, r: 0.66 }, logs: { x: cx + b + 0.005, cy, z: z + 0.15 }, dz };
}

/** points of an arch (opening) on the plane x = const */
export function archPts(x, cy, base, h0, r, n = 14) {
  const pts = [[x, cy + r, base]];
  for (let i = 0; i <= n; i++) { const a = i / n * Math.PI; pts.push([x, cy + Math.cos(a) * r, base + h0 + Math.sin(a) * r]); }
  pts.push([x, cy - r, base]);
  return pts;
}

/** a circle on the plane x = const (log ends on the oven base) */
export function circleX(x, cy, cz, r, n = 12) { return Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [x, cy + Math.cos(a) * r, cz + Math.sin(a) * r]; }); }

// ---------------------------------------------------------------- pizza box (tray + hinged lid)
export const BOX = { w: 2.5, d: 2.5, h: 0.42 };
export function tray(x, y, z) {
  const { w, d, h } = BOX, t = 0.07;
  const back = new Mesh();
  back.face([[x + t, y + t, z + h], [x + t, y + d, z + h], [x + t, y + d, z + 0.03], [x + t, y + t, z + 0.03]], C.kraftIn, { flat: true }); // inner wall at x (faces +x)
  back.face([[x + t, y + t, z + h], [x + w, y + t, z + h], [x + w, y + t, z + 0.03], [x + t, y + t, z + 0.03]], '#d6ad75', { flat: true }); // inner wall at y
  const floor = new Mesh().face([[x + t, y + t, z + 0.04], [x + w - t, y + t, z + 0.04], [x + w - t, y + d - t, z + 0.04], [x + t, y + d - t, z + 0.04]], '#ecd0a2', { flat: true });
  const front = new Mesh();
  front.add(box(x + w - t, y, z, t, d, h, C.kraft));
  front.add(box(x, y + d - t, z, w, t, h, C.kraft));
  return { back, floor, front };
}

/** lid hinged on the back edge (x = x0) at the tray rim; phi = 0 closed, ~1.9 rad open (leaning back) */
export function lid(x, y, z, phi) {
  const { w, d, h } = BOX; const zt = z + h + 0.01;
  const c = Math.cos(phi), s = Math.sin(phi);
  const A = [x, y, zt], B = [x, y + d, zt], Cc = [x + w * c, y + d, zt + w * s], D = [x + w * c, y, zt + w * s];
  const outer = -s + c > 0;                                 // outer (printed) side faces the viewer
  const m = new Mesh();
  m.face([A, B, Cc, D], outer ? C.kraft : C.kraftIn, { both: true, flat: true });
  // front tuck flap, hanging from the free edge
  const fl = 0.36, fx = s * fl, fz = -c * fl;
  m.face([D, Cc, [Cc[0] + fx, Cc[1], Cc[2] + fz], [D[0] + fx, D[1], D[2] + fz]], outer ? '#b98a54' : '#d9b07a', { both: true, flat: true });
  // side flaps (little triangles) when partly closed
  if (phi < 1.4) {
    m.face([B, Cc, [Cc[0] + fx * 0.6, Cc[1], Cc[2] + fz * 0.6]], '#b78750', { both: true, flat: true });
  }
  return { mesh: m, outer, frame: { A, B, Cc, D } };
}

// ---------------------------------------------------------------- scooter + rider (local: u forward, y left, v up)
function scooterLocal() {
  const m = new Mesh();
  m.add(wheel(-0.78, 0.3, 0.3, 0.2, C.tire, C.hub));
  m.add(wheel(0.92, 0.3, 0.3, 0.2, C.tire, C.hub));
  m.add(extrude([[-1.08, 0.36], [-1.16, 0.64], [-0.98, 0.9], [-0.12, 0.9], [-0.02, 0.66], [-0.06, 0.36]], 0.64, C.tomatoDeep, { edge: C.tomato }));
  m.add(extrude([[-0.12, 0.3], [0.62, 0.3], [0.62, 0.42], [-0.12, 0.42]], 0.5, '#a5261a', { edge: '#b52c1d' }));
  m.add(extrude([[0.5, 0.3], [0.78, 0.3], [0.9, 1.3], [0.74, 1.36], [0.58, 0.55]], 0.62, C.tomatoDeep, { edge: C.tomato }));
  m.add(extrude([[0.66, 0.46], [1.18, 0.46], [1.12, 0.66], [0.74, 0.7]], 0.36, C.tomato));
  m.add(extrude([[-1.0, 0.9], [-0.18, 0.9], [-0.12, 1.02], [-0.92, 1.04]], 0.5, C.seat));
  m.add(box(0.7, -0.48, 1.42, 0.1, 0.96, 0.08, C.chrome));            // handlebar
  m.add(box(0.86, -0.13, 1.18, 0.12, 0.26, 0.2, '#fff6d8'));           // headlight
  // delivery top box on the rear rack
  m.add(box(-1.3, -0.33, 0.98, 0.62, 0.66, 0.5, C.tomato, { colors: { top: '#f0674a' } }));
  return m;
}

function riderLocal() {
  const m = new Mesh();
  for (const sy of [-0.15, 0.15]) {
    m.add(shift(extrude([[-0.62, 0.98], [0.12, 1.0], [0.14, 1.2], [-0.6, 1.24]], 0.24, C.trousers), 0, sy, 0));   // thigh
    m.add(shift(extrude([[0.0, 0.42], [0.2, 0.42], [0.2, 1.12], [0.02, 1.12]], 0.22, C.trousers), 0, sy, 0));     // shin
    m.add(shift(extrude([[0.0, 0.4], [0.36, 0.4], [0.36, 0.5], [0.0, 0.52]], 0.24, C.shoe), 0, sy, 0));           // shoe
  }
  m.add(extrude([[-0.66, 1.16], [-0.22, 1.16], [-0.1, 1.86], [-0.52, 1.9]], 0.64, C.shirt));                       // torso
  for (const sy of [-0.36, 0.36]) m.add(shift(extrude([[-0.3, 1.8], [-0.16, 1.84], [0.72, 1.52], [0.66, 1.42]], 0.17, C.shirt), 0, sy, 0));
  m.add(dome(-0.3, 0, 2.12, 0.23, C.skin, { to: Math.PI, rings: 6, seg: 12 }));
  m.add(dome(-0.32, 0, 2.15, 0.27, C.helmet, { to: Math.PI * 0.55, rings: 4, seg: 14 }));
  return m;
}

/** courier standing, holding an open box with a pizza at waist height (local, facing +u) */
export function courierLocal() {
  const m = new Mesh();
  for (const sy of [-0.15, 0.15]) {
    m.add(shift(box(-0.12, -0.11, 0.08, 0.24, 0.22, 0.95, C.trousers), 0, sy, 0));
    m.add(shift(box(-0.12, -0.12, 0, 0.36, 0.24, 0.12, C.shoe), 0, sy, 0));
  }
  m.add(box(-0.18, -0.36, 1.0, 0.38, 0.72, 0.95, C.shirt));
  for (const sy of [-0.42, 0.42]) m.add(shift(extrude([[-0.08, 1.85], [0.08, 1.85], [0.55, 1.35], [0.45, 1.25]], 0.16, C.shirt), 0, sy, 0));
  m.add(dome(0.01, 0, 2.2, 0.25, C.skin, { to: Math.PI, rings: 6, seg: 12 }));
  m.add(dome(0.0, 0, 2.27, 0.26, C.helmet, { to: Math.PI * 0.5, rings: 3, seg: 12 }));
  m.add(box(0.12, -0.2, 2.28, 0.3, 0.4, 0.05, C.helmet));             // cap brim
  m.add(box(0.36, -0.62, 1.2, 1.1, 1.24, 0.12, C.kraft, { colors: { top: '#ecd0a2' } })); // box tray at waist
  return m;
}

export const SCOOTER_SCALE = 1.25;
const SC = scooterLocal(), RI = riderLocal(), CO = courierLocal();
const cloneMesh = (src) => { const n = new Mesh(); n.faces = src.faces.map((f) => ({ ...f, pts: f.pts.map((p) => p.slice()), center: f.center && f.center.slice() })); return n; };

/** scooter (+ optional rider) at (x,y) with heading (radians, 0 = +x) */
export function scooter(x, y, z, heading, withRider = true) {
  const m = cloneMesh(SC); if (withRider) m.add(cloneMesh(RI));
  return place(m, x, y, z, heading, SCOOTER_SCALE);
}
export function courier(x, y, z, heading, s = SCOOTER_SCALE) { return place(cloneMesh(CO), x, y, z, heading, s); }

// ---------------------------------------------------------------- props
/** three closed boxes stacked, a little askew */
export function boxStack(x, y, z) {
  const m = new Mesh(); const w = 2.1, h = 0.36;
  [[0, 0], [0.12, -0.08], [-0.06, 0.1]].forEach(([dx, dy], i) => m.add(box(x + dx, y + dy, z + i * h, w, w, h - 0.02, C.kraft, { colors: { top: '#d7ab72', right: '#b4844c', left: '#c49460' } })));
  return m;
}

export function tree(x, y, r = 0.8, h = 1.1) {
  const m = new Mesh();
  m.add(cylinder(x, y, 0, 0.12, h, C.trunk, 8));
  m.add(dome(x, y, h + r * 0.7, r, C.leaf, { to: Math.PI, rings: 6, seg: 14 }));
  return m;
}

export function topiary(x, y, z) {
  const m = new Mesh();
  m.add(cylinder(x, y, z, 0.5, 0.75, C.pot, 16, { r0: 0.4, topColor: '#5a3a26' }));
  m.add(dome(x, y, z + 1.65, 0.55, C.leaf, { to: Math.PI, rings: 7, seg: 16, sz: 1.65 }));
  return m;
}

/** the customer's house: body, gable roof (ridge along x), +y wall carries the door */
export function house(x, y, w, d, h) {
  const m = new Mesh();
  m.add(box(x, y, 0, w, d, h, C.house, { colors: { left: '#f6ead8', right: '#e9d6ba' } }));
  const o = 0.25, rz = h + 1.25, ym = y + d / 2;
  const a = [x - o, y - o, h - 0.08], b = [x + w + o, y - o, h - 0.08], c = [x + w + o, ym, rz], dd = [x - o, ym, rz];
  const e = [x - o, y + d + o, h - 0.08], f = [x + w + o, y + d + o, h - 0.08];
  const ctr = [x + w / 2, ym, h];
  m.face([a, b, c, dd], C.roof, { center: ctr });
  m.face([dd, c, f, e], C.roof, { center: ctr });
  m.face([[x + w, y, h], [x + w, y + d, h], [x + w, ym, rz - 0.05]], '#efdfc6', { center: ctr });   // gable
  m.face([[x + w + o, y - o, h - 0.08], [x + w + o, y + d + o, h - 0.08], [x + w + o, y + d + o, h - 0.2], [x + w + o, y - o, h - 0.2]], '#a8361f', { center: ctr });
  m.add(box(x + w * 0.25, y + d * 0.2, h + 0.35, 0.45, 0.45, 1.1, '#b9583c'));          // little chimney
  return m;
}

/** door panel on the +x wall (plane x = xw) hinged at y0, swinging out toward +x */
export function doorPanelX(xw, y0, w, h, ang, dir = 1) {
  const c = Math.cos(ang) * dir, s = Math.sin(ang);
  const A = [xw, y0, 0.02], B = [xw + w * s, y0 + w * c, 0.02], Cc = [xw + w * s, y0 + w * c, h], D = [xw, y0, h];
  const m = new Mesh();
  m.face([A, B, Cc, D], C.door, { both: true });
  const kx = xw + w * 0.82 * s + 0.03, ky = y0 + w * 0.82 * c;
  m.add(box(kx - 0.02, ky - 0.05, h * 0.48, 0.08, 0.1, 0.1, '#f4cf6e'));
  return m;
}

/** door panel hinged at (hx, yWall) swinging out toward +y */
export function doorPanel(hx, yw, w, h, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const A = [hx, yw, 0.02], B = [hx + w * c, yw + w * s, 0.02], Cc = [hx + w * c, yw + w * s, h], D = [hx, yw, h];
  const m = new Mesh();
  m.face([A, B, Cc, D], C.door, { both: true });
  // knob
  const kx = hx + w * 0.82 * c, ky = yw + w * 0.82 * s + 0.03;
  m.add(box(kx - 0.05, ky - 0.02, h * 0.48, 0.1, 0.08, 0.1, '#f4cf6e'));
  return m;
}
