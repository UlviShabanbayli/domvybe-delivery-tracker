// A tiny flat-shaded isometric renderer that writes SVG polygons.
// World units: x runs screen right-down, y runs screen left-down, z is up. 2:1 dimetric projection.
// Depth toward the viewer is x + y + z (the projection's null direction), so painters' order = ascending x+y+z.

export const SVGNS = 'http://www.w3.org/2000/svg';

export function projector(ox, oy, k) {
  const p = (x, y, z = 0) => [ox + (x - y) * k, oy + (x + y) * k / 2 - z * k];
  p.k = k; p.ox = ox; p.oy = oy;
  return p;
}

// ---- colour
const hex2 = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const rgb2 = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = hex2(a), B = hex2(b); return rgb2(A.map((v, i) => v + (B[i] - v) * t)); };
export const scale = (a, f) => rgb2(hex2(a).map((v) => v * f));

const L = (() => { const v = [0.28, 0.62, 1]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
const TOP = 0.62 + 0.38 * L[2];
/** flat shading: top faces keep their colour, the left (+y) face is a little darker, the right (+x) face darker still */
export function shade(color, n) {
  const d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
  const b = (0.62 + 0.38 * d) / TOP;
  return b >= 1 ? mix(color, '#ffffff', Math.min(0.25, (b - 1) * 1.2)) : scale(color, 0.35 + 0.65 * b);
}

// ---- vector helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
}
const centroid = (pts) => { const c = [0, 0, 0]; for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return c.map((v) => v / pts.length); };

/**
 * A mesh: a list of faces {pts, color, flat?, both?, bias?}. `center` orients normals outward for culling + shading.
 * flat: no shading (decals). both: never culled (thin cards like a box lid).
 */
let PID = 0;
export class Mesh {
  constructor() { this.faces = []; }
  face(pts, color, o = {}) { this.faces.push({ pts, color, ...o }); return this; }
  /** merge another mesh; each merged mesh becomes one "part" (sorted as a unit, then its faces among themselves) */
  add(m) { const id = ++PID; for (const f of m.faces) this.faces.push(f.part ? f : { ...f, part: id }); return this; }
  /** resolve normals against a solid centre (outward), drop back faces, compute colour + depth */
  solid(center) { for (const f of this.faces) if (!f.n) f.center = f.center || center; return this; }
  map(fn) { for (const f of this.faces) f.pts = f.pts.map(fn); for (const f of this.faces) if (f.center) f.center = fn(f.center); return this; }
}

function finish(f) {
  let n = newell(f.pts);
  const c = centroid(f.pts);
  if (f.center && dot(n, sub(c, f.center)) < 0) n = n.map((v) => -v);
  if (!f.center && n[2] < 0) n = n.map((v) => -v);
  const visible = f.both || dot(n, [1, 1, 1]) > 1e-4;
  const nv = visible && dot(n, [1, 1, 1]) < 0 ? n.map((v) => -v) : n;
  return { ...f, n: nv, visible, depth: c[0] + c[1] + c[2] + (f.bias || 0), fill: f.flat ? f.color : shade(f.color, nv) };
}

/** sort + project a mesh into an array of {d, fill} (svg polygon points) */
export function render(mesh, P, { cull = true, sort = true } = {}) {
  let fs = mesh.faces.map(finish);
  if (sort) {
    // part depth = mean depth of all its faces (before culling); faces outside a part are their own part
    // sort === 'insertion': parts keep the order they were added in (hand-ordered models like the oven)
    const pd = new Map();
    fs.forEach((f, i) => { const k = f.part || 'f' + i; const e = pd.get(k) || [0, 0, pd.size]; e[0] += f.depth; e[1]++; pd.set(k, e); f._k = k; });
    for (const f of fs) { const e = pd.get(f._k); f._pd = sort === 'insertion' ? e[2] : e[0] / e[1]; }
    fs.sort((a, b) => (a._pd - b._pd) || (a.depth - b.depth));
  }
  if (cull) fs = fs.filter((f) => f.visible);
  return fs.map((f) => ({ points: f.pts.map((p) => P(p[0], p[1], p[2]).map((v) => v.toFixed(2)).join(',')).join(' '), fill: f.fill, cls: f.cls, stroke: f.stroke }));
}

export function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/** write rendered polys into a <g> (creating or reusing polygon children: cheap for per-frame updates) */
export function paint(g, polys) {
  const kids = g.children;
  for (let i = 0; i < polys.length; i++) {
    let e = kids[i];
    if (!e) e = svgEl('polygon', {}, g);
    const p = polys[i];
    if (e._p !== p.points) { e.setAttribute('points', p.points); e._p = p.points; }
    if (e._f !== p.fill) { e.setAttribute('fill', p.fill); e.setAttribute('stroke', p.stroke || p.fill); e._f = p.fill; }
    if (e.style.display) e.style.display = '';
  }
  for (let i = polys.length; i < kids.length; i++) kids[i].style.display = 'none';
}

// ---------------------------------------------------------------- primitives (all return Mesh)

export function box(x, y, z, w, d, h, color, o = {}) {
  const m = new Mesh();
  const c = o.colors || {};
  const A = [x, y, z], B = [x + w, y, z], C = [x + w, y + d, z], D = [x, y + d, z];
  const A2 = [x, y, z + h], B2 = [x + w, y, z + h], C2 = [x + w, y + d, z + h], D2 = [x, y + d, z + h];
  m.face([A2, B2, C2, D2], c.top || color);            // top
  m.face([B, C, C2, B2], c.right || color);            // +x face
  m.face([D, C, C2, D2], c.left || color);             // +y face
  if (o.back) { m.face([A, B, B2, A2], color); m.face([A, D, D2, A2], color); }
  if (o.bottom) m.face([A, B, C, D], color);
  return m.solid([x + w / 2, y + d / 2, z + h / 2]);
}

export function cylinder(cx, cy, z, r, h, color, seg = 20, o = {}) {
  const m = new Mesh();
  const ring = (zz, rr = r) => Array.from({ length: seg }, (_, i) => { const a = i / seg * Math.PI * 2; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, zz]; });
  const lo = ring(z, o.r0 ?? r), hi = ring(z + h, r);
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; m.face([lo[i], lo[j], hi[j], hi[i]], color, { center: [cx, cy, z + h / 2] }); }
  if (o.top !== false) m.face(hi, o.topColor || color, { center: [cx, cy, z] });
  return m;
}

/** a sphere cap / dome: from polar angle 0 (top) to `to` (π/2 = hemisphere) */
export function dome(cx, cy, z, r, color, o = {}) {
  const m = new Mesh(); const seg = o.seg || 22, rings = o.rings || 8, to = o.to || Math.PI / 2, sz = o.sz || 1;
  const pt = (i, j) => { const th = j / rings * to, a = i / seg * Math.PI * 2; return [cx + Math.cos(a) * Math.sin(th) * r, cy + Math.sin(a) * Math.sin(th) * r, z + Math.cos(th) * r * sz]; };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const quad = j === 0 ? [pt(0, 0), pt(i, 1), pt(i + 1, 1)] : [pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)];
    m.face(quad, color, { center: [cx, cy, z] });
  }
  return m;
}

/** extrude a side profile (u forward, v up) across the width (local y from -w/2 to w/2); returns local-space mesh */
export function extrude(profile, w, color, o = {}) {
  const m = new Mesh(); const y0 = -w / 2, y1 = w / 2;
  const L0 = profile.map(([u, v]) => [u, y0, v]), L1 = profile.map(([u, v]) => [u, y1, v]);
  const cu = profile.reduce((s, p) => s + p[0], 0) / profile.length, cv = profile.reduce((s, p) => s + p[1], 0) / profile.length;
  const C = [cu, 0, cv];
  m.face(L0, o.side || color, { center: C }); m.face(L1, o.side || color, { center: C });
  for (let i = 0; i < profile.length; i++) { const j = (i + 1) % profile.length; m.face([L0[i], L0[j], L1[j], L1[i]], o.edge || color, { center: C }); }
  return m;
}

/** a disc lying in a vertical plane (wheel): local, axis along y */
export function wheel(u, v, r, w, color, hub, seg = 14) {
  const prof = Array.from({ length: seg }, (_, i) => { const a = i / seg * Math.PI * 2; return [u + Math.cos(a) * r, v + Math.sin(a) * r]; });
  const m = extrude(prof, w, color, { edge: color });
  if (hub) {
    const hp = Array.from({ length: 10 }, (_, i) => { const a = i / 10 * Math.PI * 2; return [u + Math.cos(a) * r * 0.45, v + Math.sin(a) * r * 0.45]; });
    m.add(extrude(hp, w + 0.04, hub));
  }
  return m;
}

/** place a local mesh: rotate by heading around z, then translate */
export function place(mesh, x, y, z, heading = 0, s = 1) {
  const c = Math.cos(heading), sn = Math.sin(heading);
  return mesh.map(([u, w, v]) => [x + (u * c - w * sn) * s, y + (u * sn + w * c) * s, z + v * s]);
}

export const clone = (m) => { const n = new Mesh(); n.faces = m.faces.map((f) => ({ ...f, pts: f.pts.map((p) => p.slice()), center: f.center && f.center.slice() })); return n; };
