// DV49 v2 · the pizzatime town as a real-time three.js diorama (r186, vendored).
// Same contract as the SVG scene (update / camera / replay), so the tracker logic is shared.
// Draw-call budget: static town = 2 merged meshes; every moving thing is 1 mesh or 1 instanced mesh (~24 draws total).
// The sun's shadow map is rendered only when something that casts it changes (time of day); moving things get
// soft contact shadows instead, so a frame is one scene pass + a cheap tilt-shift.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { T, rideShare } from './timeline.js';

// ---------------------------------------------------------------- palette (concept)
const P = {
  tomato: '#e5502f', tomatoDeep: '#c2311e', brick: '#b8532f', brickDark: '#8f3a20', cream: '#fbf2e3', creamDeep: '#f1e2c8',
  block: '#e8d2b0', block2: '#dfc39c', street: '#f6eedf', grass: '#7aa74b', grassDeep: '#5f8f3c', basil: '#5b8a3c',
  water: '#8fd0e6', asphalt: '#5a5d63', kraft: '#c99a62', kraftIn: '#e2bd88', skin: '#f1c29a', shirt: '#dc452b',
  trousers: '#5b8a3c', shoe: '#3a2a22', tire: '#2c2c30', chrome: '#d9dde2', roof: '#d2492c', house: '#f4e7d2', wood: '#9a5a33',
  trunk: '#8a5a36', leaf: '#4f8f34', leafLight: '#6aa83f', crust: '#e3a256', sauce: '#d8462b', cheese: '#f6d074', pep: '#b5321e',
  board: '#e9d7ba', boardEdge: '#c9a77c',
};
const col = (h) => new THREE.Color(h);

// ---------------------------------------------------------------- geometry helpers (vertex-coloured, merged)
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = col(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
function at(geo, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
  E.set(rx, ry, rz); Q.setFromEuler(E); M4.compose(V.set(x, y, z), Q, S1.set(s, s, s)); geo.applyMatrix4(M4); return geo;
}
const rbox = (w, h, d, r = 0.08, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
const cyl = (rt, rb, h, seg = 18) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r, ws = 14, hs = 10, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, ts, tl);
class Builder {
  constructor() { this.parts = []; }
  add(geo, color) { this.parts.push(paint(geo, color)); return this; }
  build() { const g = mergeGeometries(this.parts, false); g.computeBoundingSphere(); return g; }
}

// ---------------------------------------------------------------- town layout (world units, y up)
// The camera's home view is from +x,+z: screen-left is (-x,+z), "far" is (-x,-z). Pizzeria top-left, house right.
const HALF = 16;
const SX = [-12, -3, 4, 12], SZ = [-10, -2, 6], SW = 2.0;
const BX = [[-HALF, -13], [-11, -4], [-2, 3], [5, 11], [13, HALF]], BZ = [[-HALF, -11], [-9, -3], [-1, 5], [7, HALF]];
const OVEN = new THREE.Vector3(-5.7, 0, 1.3), TABLE = new THREE.Vector3(-5.3, 0, 3.9), HOUSE = new THREE.Vector3(8, 0, -6.2);
const DOOR = new THREE.Vector3(8, 0, -4.66);

// the route: pizzeria → along z=6 → north on x=-3 → east on z=-2 → the house; corners rounded
const ROUTE = (() => {
  const R = 2.2, pts = [];
  const line = (a, b, n) => { for (let i = 0; i < n; i++) { const u = i / n; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * u, 0, a[1] + (b[1] - a[1]) * u)); } };
  const arc = (c, a0, a1, n) => { for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push(new THREE.Vector3(c[0] + Math.cos(a) * R, 0, c[1] + Math.sin(a) * R)); } };
  line([-7.4, 6], [-3 - R, 6], 12);
  arc([-3 - R, 6 - R], Math.PI / 2, 0, 12);
  line([-3, 6 - R], [-3, -2 + R], 14);
  arc([-3 + R, -2 + R], Math.PI, Math.PI * 1.5, 12);
  line([-3 + R, -2], [8.2, -2], 24);
  pts.push(new THREE.Vector3(8.2, 0, -2));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = 600;
  return curve;
})();
const PARK_U = 0.06;                      // the scooter waits here while the kitchen works

// ---------------------------------------------------------------- canvas textures (sign, sticker, bricks, sprites)
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const softDot = () => canvasTex(64, 64, (g, w) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
const blobTex = () => canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(40,20,10,.55)'); r.addColorStop(0.55, 'rgba(40,20,10,.22)'); r.addColorStop(1, 'rgba(40,20,10,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }, false);
function brickTex() {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#b8532f'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) {
      const x = c * 32 + (r % 2) * 16, y = r * 16, k = ((r * 7 + c * 13) % 5) / 5;
      g.fillStyle = `hsl(${12 + k * 6}, ${52 + k * 10}%, ${40 + k * 7}%)`; g.fillRect(x + 1.5, y + 1.5, 29, 13);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function signTex() {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#fbf2e3'; g.beginPath(); g.roundRect(8, 8, w - 16, h - 16, 60); g.fill();
    g.fillStyle = '#c2311e'; g.font = '800 150px Outfit, "Avenir Next", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('pizzatime', w / 2, h / 2 + 8);
  });
}
function stickerTex() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#e5502f'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fbf2e3'; g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e5502f'; g.beginPath(); g.moveTo(70, 92); g.quadraticCurveTo(128, 60, 186, 92); g.lineTo(128, 196); g.closePath(); g.fill();
    g.fillStyle = '#f6c96e'; g.beginPath(); g.moveTo(84, 104); g.quadraticCurveTo(128, 82, 172, 104); g.lineTo(128, 180); g.closePath(); g.fill();
    g.fillStyle = '#c2311e'; for (const [x, y] of [[112, 112], [142, 110], [128, 140]]) { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); }
    g.fillStyle = '#c2311e'; g.font = '800 30px Outfit, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('pizzatime', 128, 236);
  });
}

// ---------------------------------------------------------------- the static town
function buildTown() {
  const B = new Builder(), Em = new Builder();
  // the board: a thick toy slab with a darker rim
  B.add(at(rbox(HALF * 2, 1.4, HALF * 2, 0.5, 3), 0, -0.72, 0), P.board);
  B.add(at(rbox(HALF * 2 + 0.3, 0.5, HALF * 2 + 0.3, 0.24, 2), 0, -1.25, 0), P.boardEdge);
  // blocks (streets are the board top, slightly lighter)
  B.add(at(new THREE.BoxGeometry(HALF * 2 - 0.4, 0.02, HALF * 2 - 0.4), 0, 0.0, 0), P.street);
  const PARKS = new Set(['2,2', '1,3', '4,3', '0,1']), POND = '2,2';
  BX.forEach(([x0, x1], i) => BZ.forEach(([z0, z1], j) => {
    const key = `${i},${j}`, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const green = PARKS.has(key);
    B.add(at(rbox(w, 0.3, d, 0.12, 2), cx, 0.08, cz), green ? P.grass : ((i + j) % 2 ? P.block : P.block2));
    if (key === POND) { B.add(at(rbox(w * 0.56, 0.06, d * 0.5, 0.03, 2), cx - w * 0.12, 0.22, cz + d * 0.14), '#5fb3d3'); }
    if (!green && (i + j) % 3 === 0) B.add(at(rbox(w * 0.42, 0.04, d - 0.8, 0.02, 1), cx + w * 0.22, 0.24, cz), '#e8d6ba');
  }));
  // the route as a real asphalt road (rendered by the route mesh), plus kerbs at the plaza
  // ---- pizzeria (block 1,2: x -11..-4, z -1..5)
  const pz = new Builder();
  B.add(at(rbox(3.6, 3.0, 5.6, 0.14, 2), -9.0, 1.7, 2.0), P.tomato);              // building
  B.add(at(rbox(3.9, 0.35, 5.9, 0.12, 2), -9.0, 3.25, 2.0), P.cream);             // roof slab
  B.add(at(rbox(0.9, 0.9, 1.6, 0.1, 2), -9.6, 3.8, 0.6), P.brickDark);            // roof unit
  B.add(at(cyl(0.22, 0.22, 1.4, 12), -9.4, 4.0, 3.6), '#6e4a3a');                 // flue
  for (let i = 0; i < 9; i++) {                                                   // striped awning on the +x face
    const z = -0.3 + i * 0.6;
    B.add(at(new THREE.BoxGeometry(0.9, 0.06, 0.6), -6.85, 2.45, z + 0.3, 0, 0, -0.42), i % 2 ? P.cream : P.tomatoDeep);
  }
  B.add(at(rbox(0.12, 1.9, 1.1, 0.04), -7.18, 1.15, 4.0), P.wood);                // door
  Em.add(at(new THREE.BoxGeometry(0.06, 1.2, 2.4), -7.16, 1.35, 1.6), '#ffd27a');  // window (lit at night)
  B.add(at(new THREE.BoxGeometry(0.1, 1.36, 2.56), -7.2, 1.35, 1.6), P.cream);
  // patio: paving, table, bench, plants
  B.add(at(rbox(3.0, 0.08, 5.6, 0.04, 1), -5.6, 0.27, 2.0), '#d9d3ca');
  B.add(at(cyl(0.55, 0.55, 0.08, 20), TABLE.x, 0.95, TABLE.z), P.cream);
  B.add(at(cyl(0.08, 0.12, 0.65, 10), TABLE.x, 0.6, TABLE.z), '#6e4a3a');
  for (const [x, z] of [[-4.6, -0.6], [-10.6, -0.6], [-10.6, 5.3]]) { B.add(at(cyl(0.34, 0.26, 0.5, 14), x, 0.5, z), '#b9643c'); B.add(at(sph(0.42, 12, 10), x, 1.1, z), P.leaf); }
  // ---- the customer's house (block 3,1)
  const hx = HOUSE.x, hz = HOUSE.z;
  B.add(at(rbox(3.2, 2.2, 3.0, 0.1, 2), hx, 1.3, hz), P.house);
  const roof = new THREE.CylinderGeometry(2.0, 2.0, 3.6, 3, 1); roof.rotateZ(Math.PI / 2); roof.scale(1, 0.62, 1.0);
  B.add(at(roof, hx, 3.02, hz, Math.PI / 2), P.roof);
  B.add(at(rbox(0.5, 1.0, 0.5, 0.06), hx + 0.9, 3.5, hz - 0.4), '#b9583c');
  for (const dx of [-0.46, 0.46]) B.add(at(new THREE.BoxGeometry(0.1, 1.62, 0.1), DOOR.x + dx, 0.99, DOOR.z), '#7a4526');   // door frame
  B.add(at(new THREE.BoxGeometry(1.02, 0.1, 0.1), DOOR.x, 1.8, DOOR.z), '#7a4526');
  Em.add(at(new THREE.BoxGeometry(0.82, 1.5, 0.04), DOOR.x, 0.96, DOOR.z - 0.04), '#ffd88a');  // warm doorway
  for (const dx of [-1.0, 1.0]) { Em.add(at(new THREE.BoxGeometry(0.6, 0.6, 0.04), hx + dx, 1.45, DOOR.z + 0.005), '#ffe2a0'); B.add(at(new THREE.BoxGeometry(0.72, 0.72, 0.03), hx + dx, 1.45, DOOR.z - 0.01), P.cream); }
  B.add(at(rbox(1.1, 0.04, 0.6, 0.02, 1), DOOR.x, 0.25, DOOR.z + 0.45), '#5f9a45');            // doormat
  B.add(at(rbox(0.9, 0.04, 2.3, 0.02, 1), DOOR.x, 0.245, DOOR.z + 1.5), '#efe3cf');           // path
  for (const dx of [-1.3, 1.3]) { B.add(at(sph(0.38, 10, 8), hx + dx, 0.55, DOOR.z + 0.5), P.leaf); }
  // ---- other houses + shops on the blocks (toy town filler)
  const homes = [[-8.5, -6, P.cream, P.roof], [-6.0, -6.6, '#f3d6a4', '#c96b3a'], [0.5, -6.5, '#e8efe0', P.basil], [-0.8, -5.4, P.cream, P.tomatoDeep],
    [9.6, 9.8, P.cream, '#c96b3a'], [-8.2, 10.2, '#f3d6a4', P.roof], [14.6, -6, P.cream, P.basil], [14.6, 2.0, '#e8efe0', P.roof],
    [-14.6, 2.2, P.cream, P.roof], [0.2, -13.5, '#f6e2c6', P.roof], [-7.6, -13.4, P.cream, P.basil], [8.0, -13.4, '#f3d6a4', P.tomatoDeep]];
  homes.forEach(([x, z, wall, rf], k) => {
    const w = 2.2 + (k % 3) * 0.3, h = 1.5 + (k % 2) * 0.5;
    B.add(at(rbox(w, h, 2.2, 0.08), x, 0.2 + h / 2, z), wall);
    const r = new THREE.CylinderGeometry(1.45, 1.45, w + 0.3, 3, 1); r.rotateZ(Math.PI / 2); r.scale(1, 0.55, 1.05);
    B.add(at(r, x, 0.2 + h + 0.4, z), rf);
    Em.add(at(new THREE.BoxGeometry(0.5, 0.5, 0.04), x - 0.4, 0.2 + h * 0.55, z + 1.11), '#ffe2a0');
    Em.add(at(new THREE.BoxGeometry(0.04, 0.5, 0.5), x + w / 2 + 0.01, 0.2 + h * 0.55, z + 0.2), '#ffe2a0');
  });
  // streetlights along the route (bulbs are emissive; at night they also get glow sprites)
  const LAMPS = [[-5.6, 7.3], [-1.7, 3.8], [-1.7, -0.6], [2.2, -0.7], [6.0, -0.7], [-4.3, -3.3]];
  for (const [x, z] of LAMPS) {
    B.add(at(cyl(0.06, 0.08, 2.4, 8), x, 1.4, z), '#4a4f57');
    B.add(at(rbox(0.4, 0.12, 0.4, 0.05), x, 2.62, z), '#4a4f57');
    Em.add(at(sph(0.15, 10, 8), x, 2.5, z), '#ffe7b0');
  }
  // trees: trunks are static, crowns are an instanced mesh (they sway)
  const TREES = [];
  const treeSpots = [[-14.5, -13.2], [-10, -13], [-1, 9], [2, 11.5], [-1.5, 12.8], [9, 12.5], [6, 8.5], [14.2, 9.5], [14.5, 13.5], [-14.6, 8.2], [-14.6, 13.6],
    [6.2, -9.0], [10.6, -8.6], [-2.2, -8.4], [2.5, -4.0], [-10.8, -7.5], [-5.5, -8.5], [2.2, 4.2], [0.9, 0.2], [14.4, -13.5], [-13.5, 10.6], [13.8, -9.2], [-13.8, -3.0], [-6.0, 9.2], [-10.2, 12.2]];
  for (const [x, z] of treeSpots) { const s = 0.8 + ((x * 7 + z * 3) % 5 + 5) % 5 * 0.09; B.add(at(cyl(0.09, 0.13, 1.0 * s, 7), x, 0.6 * s + 0.2, z), P.trunk); TREES.push([x, 1.2 * s + 0.75 * s + 0.15, z, s]); }
  // the oven (its own brick material) is built separately
  return { town: B.build(), emissive: Em.build(), lamps: LAMPS, trees: TREES };
}

function buildOven() {
  const g = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ map: brickTex(), roughness: 0.9, metalness: 0 });
  const geoB = [];
  const base = rbox(2.6, 1.3, 3.0, 0.08); base.translate(0, 0.65, 0.2); geoB.push(base);
  const dome = sph(1.25, 28, 14, 0, Math.PI / 2); dome.scale(1, 0.92, 1); dome.translate(0, 1.4, -0.3); geoB.push(dome);
  // portal around the mouth (faces +z in local space)
  const shape = new THREE.Shape(); shape.moveTo(-0.85, 0); shape.lineTo(0.85, 0); shape.lineTo(0.85, 0.65); shape.absarc(0, 0.65, 0.85, 0, Math.PI, false); shape.lineTo(-0.85, 0);
  const hole = new THREE.Path(); hole.moveTo(-0.55, 0); hole.lineTo(0.55, 0); hole.lineTo(0.55, 0.5); hole.absarc(0, 0.5, 0.55, 0, Math.PI, false); hole.lineTo(-0.55, 0); shape.holes.push(hole);
  const portal = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 14 });
  portal.translate(0, 1.32, 0.9); geoB.push(portal);
  // tunnel floor (the pizza sits on it)
  const floorG = new THREE.BoxGeometry(1.1, 0.04, 0.8); floorG.translate(0, 1.34, 1.3); geoB.push(floorG);
  const merged = mergeGeometries(geoB.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k); return y; }), false);
  const ovenMesh = new THREE.Mesh(merged, brick); ovenMesh.castShadow = ovenMesh.receiveShadow = true; g.add(ovenMesh);
  const trim = new Builder();
  trim.add(at(rbox(2.85, 0.18, 3.25, 0.06), 0, 1.38, 0.2), '#7a3a22');            // ledge
  trim.add(at(cyl(0.22, 0.24, 1.2, 14), -0.35, 2.7, -0.75), '#6e4a3a');           // chimney
  trim.add(at(cyl(0.3, 0.3, 0.12, 14), -0.35, 3.33, -0.75), '#4a332a');
  // log store under the oven
  trim.add(at(new THREE.BoxGeometry(1.8, 0.7, 0.1), 0, 0.5, 1.66), '#3f2214');
  for (let i = 0; i < 7; i++) { const l = cyl(0.13, 0.13, 0.5, 10); l.rotateX(Math.PI / 2); trim.add(at(l, -0.6 + (i % 4) * 0.4 + (i > 3 ? 0.2 : 0), 0.33 + (i > 3 ? 0.26 : 0), 1.55), '#c79a63'); }
  const trimMesh = new THREE.Mesh(trim.build(), CLAY()); trimMesh.castShadow = trimMesh.receiveShadow = true; g.add(trimMesh);
  // the mouth: an emissive arch (fire glow) behind which the pizza sits
  const mouthShape = new THREE.Shape(); mouthShape.moveTo(-0.55, 0); mouthShape.lineTo(0.55, 0); mouthShape.lineTo(0.55, 0.5); mouthShape.absarc(0, 0.5, 0.55, 0, Math.PI, false); mouthShape.lineTo(-0.55, 0);
  const fireTex = canvasTex(128, 128, (c) => { const r = c.createRadialGradient(64, 92, 4, 64, 80, 80); r.addColorStop(0, '#fff3c4'); r.addColorStop(0.3, '#ffc65a'); r.addColorStop(0.7, '#f07f2a'); r.addColorStop(1, '#7a2412'); c.fillStyle = r; c.fillRect(0, 0, 128, 128); });
  const mouthGeo = new THREE.ShapeGeometry(mouthShape, 14); mouthGeo.translate(0, 1.32, 0.93);
  const uvs = mouthGeo.attributes.position; const uv = new Float32Array(uvs.count * 2);
  for (let i = 0; i < uvs.count; i++) { uv[i * 2] = (uvs.getX(i) + 0.55) / 1.1; uv[i * 2 + 1] = (uvs.getY(i) - 1.32) / 1.05; }
  mouthGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mouthMat = new THREE.MeshBasicMaterial({ map: fireTex, toneMapped: false, color: new THREE.Color(1.6, 1.25, 1.0) });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat); g.add(mouth);
  return { group: g, mouthMat };
}

// one clay material for every vertex-coloured mesh
let _clay = null;
function CLAY() { return _clay || (_clay = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.55 })); }

// ---------------------------------------------------------------- props
function pizzaGeo(r = 0.5) {
  const B = new Builder();
  B.add(at(cyl(r, r * 1.02, 0.07, 28), 0, 0.035, 0), P.crust);
  B.add(at(new THREE.TorusGeometry(r * 0.93, r * 0.09, 8, 28).rotateX(Math.PI / 2), 0, 0.07, 0), '#e8ac62');
  B.add(at(cyl(r * 0.86, r * 0.86, 0.02, 28), 0, 0.075, 0), P.sauce);
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.3, d = r * 0.4; B.add(at(cyl(r * 0.3, r * 0.3, 0.02, 14), Math.cos(a) * d, 0.088, Math.sin(a) * d), P.cheese); }
  B.add(at(cyl(r * 0.42, r * 0.42, 0.02, 16), 0, 0.09, 0), P.cheese);
  for (const [u, v] of [[0.5, 0.2], [-0.15, 0.55], [-0.5, -0.1], [0.1, -0.5], [0.2, 0.05], [-0.3, 0.25], [0.48, -0.32], [-0.2, -0.3]]) B.add(at(cyl(r * 0.12, r * 0.12, 0.03, 12), u * r, 0.1, v * r), P.pep);
  for (const [u, v, a] of [[0.3, 0.45, 0.4], [-0.45, 0.35, 1.2], [-0.05, -0.15, 2.1], [0.35, -0.55, 0.9]]) B.add(at(new THREE.BoxGeometry(r * 0.2, 0.012, r * 0.1), u * r, 0.115, v * r, a), '#4b8a37');
  return B.build();
}

function boxParts() {
  const w = 1.15, h = 0.2, t = 0.04;
  const tray = new Builder();
  tray.add(at(new THREE.BoxGeometry(w, 0.03, w), 0, 0.015, 0), P.kraftIn);
  tray.add(at(new THREE.BoxGeometry(w, h, t), 0, h / 2, -w / 2 + t / 2), P.kraft);
  tray.add(at(new THREE.BoxGeometry(w, h, t), 0, h / 2, w / 2 - t / 2), P.kraft);
  tray.add(at(new THREE.BoxGeometry(t, h, w), -w / 2 + t / 2, h / 2, 0), P.kraft);
  tray.add(at(new THREE.BoxGeometry(t, h, w), w / 2 - t / 2, h / 2, 0), P.kraft);
  // lid geometry: hinge along the back edge (local z = 0), the lid extends +z
  const lid = new Builder();
  lid.add(at(new THREE.BoxGeometry(w + 0.02, 0.03, w + 0.02), 0, 0, w / 2), P.kraft);
  lid.add(at(new THREE.BoxGeometry(w + 0.02, 0.18, 0.03), 0, -0.09, w + 0.005), '#b98a54');
  return { tray: tray.build(), lid: lid.build(), w, h };
}

function scooterGeo(withRider) {
  const B = new Builder();
  const wheel = (x) => { const tire = new THREE.TorusGeometry(0.2, 0.08, 10, 20); B.add(at(tire, x, 0.28, 0), P.tire); B.add(at(cyl(0.12, 0.12, 0.12, 14).rotateX(Math.PI / 2), x, 0.28, 0), P.chrome); };
  wheel(-0.62); wheel(0.66);
  B.add(at(rbox(0.85, 0.42, 0.56, 0.18, 3), -0.48, 0.62, 0), P.tomatoDeep);            // rear body
  B.add(at(rbox(0.6, 0.1, 0.42, 0.04), 0.12, 0.38, 0), '#a5261a');                       // floorboard
  B.add(at(rbox(0.2, 0.95, 0.56, 0.08, 2), 0.52, 0.8, 0, 0, 0, -0.22), P.tomato);        // leg shield
  B.add(at(rbox(0.45, 0.16, 0.3, 0.06), 0.72, 0.5, 0), P.tomato);                       // front fender
  B.add(at(rbox(0.62, 0.1, 0.42, 0.05), -0.42, 0.88, 0), '#3d2b25');                    // seat
  B.add(at(cyl(0.035, 0.035, 0.8, 8).rotateX(Math.PI / 2), 0.62, 1.3, 0), P.chrome);   // handlebar
  B.add(at(cyl(0.1, 0.1, 0.08, 14).rotateZ(Math.PI / 2), 0.78, 1.16, 0), '#fff6d8');   // headlight
  B.add(at(rbox(0.5, 0.46, 0.56, 0.06), -0.92, 1.15, 0), P.tomato);                     // top box
  B.add(at(new THREE.BoxGeometry(0.02, 0.26, 0.26), -0.66, 1.17, 0), P.cream);
  if (withRider) {
    for (const s of [-0.13, 0.13]) {
      B.add(at(rbox(0.6, 0.18, 0.18, 0.06), -0.12, 0.98, s), P.trousers);                // thigh
      B.add(at(rbox(0.16, 0.55, 0.16, 0.06), 0.14, 0.72, s, 0, 0, 0.12), P.trousers);    // shin
      B.add(at(rbox(0.26, 0.1, 0.16, 0.04), 0.22, 0.44, s), P.shoe);
    }
    B.add(at(rbox(0.36, 0.62, 0.5, 0.14, 2), -0.32, 1.36, 0, 0, 0, -0.18), P.shirt);    // torso
    for (const s of [-0.29, 0.29]) B.add(at(cyl(0.065, 0.065, 0.78, 8).rotateZ(Math.PI / 2 - 0.42), 0.18, 1.45, s), P.shirt);
    B.add(at(sph(0.19, 14, 10), -0.24, 1.86, 0), P.skin);
    B.add(at(sph(0.225, 16, 10, 0, Math.PI * 0.58), -0.26, 1.9, 0), '#d63a24');          // helmet
    B.add(at(rbox(0.2, 0.06, 0.34, 0.02), -0.06, 1.88, 0, 0, 0, -0.3), '#2f3a44');        // visor
  }
  return B.build();
}

function courierGeo() {
  const B = new Builder();
  for (const s of [-0.12, 0.12]) { B.add(at(rbox(0.18, 0.8, 0.18, 0.06), 0, 0.48, s), P.trousers); B.add(at(rbox(0.28, 0.1, 0.18, 0.04), 0.05, 0.06, s), P.shoe); }
  B.add(at(rbox(0.34, 0.72, 0.56, 0.14, 2), 0, 1.22, 0), P.shirt);
  for (const s of [-0.33, 0.33]) B.add(at(cyl(0.065, 0.065, 0.6, 8).rotateZ(Math.PI / 2 - 0.25), 0.25, 1.2, s), P.shirt);
  B.add(at(sph(0.2, 14, 10), 0, 1.78, 0), P.skin);
  B.add(at(sph(0.21, 14, 8, 0, Math.PI * 0.5), 0, 1.84, 0), '#d63a24');
  B.add(at(rbox(0.26, 0.04, 0.34, 0.02), 0.17, 1.85, 0), '#d63a24');
  return B.build();
}

function carGeo(body) {
  const B = new Builder();
  B.add(at(rbox(1.5, 0.42, 0.8, 0.16, 3), 0, 0.42, 0), body);
  B.add(at(rbox(0.8, 0.36, 0.7, 0.14, 3), -0.08, 0.78, 0), '#f4f1ea');
  B.add(at(rbox(0.82, 0.24, 0.72, 0.1, 2), -0.08, 0.8, 0), '#9fc9dc');
  for (const x of [-0.48, 0.48]) for (const z of [-0.38, 0.38]) B.add(at(cyl(0.16, 0.16, 0.12, 14).rotateX(Math.PI / 2), x, 0.18, z), P.tire);
  return B.build();
}

// ---------------------------------------------------------------- tilt-shift (two separable passes, focus band follows the subject)
const TiltShift = (horizontal) => ({
  uniforms: { tDiffuse: { value: null }, uDelta: { value: new THREE.Vector2(horizontal ? 1 : 0, horizontal ? 0 : 1) }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: 0.5 }, uBand: { value: 0.18 }, uAmount: { value: 2.6 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDelta, uRes; uniform float uFocus, uBand, uAmount; varying vec2 vUv;
    void main(){
      float d = max(0.0, abs(vUv.y - uFocus) - uBand);
      float r = clamp(d * 4.0, 0.0, 1.0) * uAmount;
      vec2 st = uDelta / uRes * r;
      vec4 c = texture2D(tDiffuse, vUv) * 0.2270;
      c += (texture2D(tDiffuse, vUv + st * 1.384) + texture2D(tDiffuse, vUv - st * 1.384)) * 0.3162;
      c += (texture2D(tDiffuse, vUv + st * 3.230) + texture2D(tDiffuse, vUv - st * 3.230)) * 0.0703;
      gl_FragColor = c;
    }`,
});

// ---------------------------------------------------------------- time of day
export const TOD = {
  day: { sun: '#fff1dc', sunI: 2.5, sunDir: [-9, 16, 7], hemiSky: '#d6e6ff', hemiGround: '#e9cfae', hemiI: 0.75, env: 0.5, exposure: 0.95, night: 0, lamps: 0.15, bg: ['#fbf1e1', '#f3e1c6'] },
  golden: { sun: '#ffa65c', sunI: 2.6, sunDir: [-16, 6.5, 10], hemiSky: '#ffd2a6', hemiGround: '#d9a173', hemiI: 0.6, env: 0.32, exposure: 0.98, night: 0.35, lamps: 0.55, bg: ['#fbd9ac', '#f2b989'] },
  night: { sun: '#9fb6ff', sunI: 0.5, sunDir: [10, 16, -6], hemiSky: '#46578f', hemiGround: '#221a2a', hemiI: 0.4, env: 0.08, exposure: 1.0, night: 1, lamps: 1, bg: ['#27305a', '#141a33'] },
};
export function todForHour(h) { return h >= 7 && h < 16.5 ? 'day' : (h >= 16.5 && h < 19.5) || (h >= 5.5 && h < 7) ? 'golden' : 'night'; }

// ---------------------------------------------------------------- the scene
export function createScene3D(root, { reduced = false, phone = false, q = {} } = {}) {
  const canvas = document.createElement('canvas'); canvas.className = 'gl';
  canvas.setAttribute('aria-hidden', 'true'); root.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  const tier = { dprCap: q.dpr ?? 1.5, budget: 2.8e6, adaptCap: 9, shadow: phone ? 1024 : 2048, particles: phone ? 0.5 : 1, tilt: q.tilt ?? true, msaa: q.msaa ?? (phone ? 2 : 4), half: q.half ?? false };
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 200);

  // lights
  const hemi = new THREE.HemisphereLight('#dfeeff', '#f0dcc0', 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.6); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  sun.shadow.mapSize.set(tier.shadow, tier.shadow); sun.shadow.radius = 5; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fire = new THREE.PointLight('#ff8a3a', 6, 7, 1.6); scene.add(fire);
  const head = new THREE.SpotLight('#fff1c8', 0, 9, 0.5, 0.6, 1.2); scene.add(head, head.target);

  // town
  const town = buildTown();
  const townMesh = new THREE.Mesh(town.town, CLAY()); townMesh.castShadow = townMesh.receiveShadow = true; scene.add(townMesh);
  const emMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); const emMesh = new THREE.Mesh(town.emissive, emMat); scene.add(emMesh);
  // the sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.7, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, emissiveMap: null }));
  sign.position.set(-7.17, 2.95, 2.0); sign.rotation.y = Math.PI / 2; scene.add(sign);
  // route: asphalt ribbon + progress line (fills as the scooter rides)
  const ribbon = (width, y, samples = 260) => {
    const pos = [], uvA = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples, p = ROUTE.getPointAt(u), tg = ROUTE.getTangentAt(u), nx = -tg.z, nz = tg.x;
      pos.push(p.x + nx * width / 2, y, p.z + nz * width / 2, p.x - nx * width / 2, y, p.z - nz * width / 2);
      uvA.push(u, 0, u, 1);
      if (i < samples) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const road = new THREE.Mesh(ribbon(1.7, 0.03), new THREE.MeshStandardMaterial({ color: P.asphalt, roughness: 0.9 })); road.receiveShadow = true; scene.add(road);
  const routeLen = ROUTE.getLength();
  const lineMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uP: { value: 0 }, uT: { value: 0 }, uLen: { value: routeLen }, uDone: { value: new THREE.Color(P.tomato) }, uAhead: { value: new THREE.Color('#ffffff') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uP, uT, uLen; uniform vec3 uDone, uAhead; varying vec2 vUv;
      void main(){
        float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        float s = vUv.x * uLen;
        if (vUv.x <= uP) { gl_FragColor = vec4(uDone * 1.15, edge); return; }
        float dash = step(0.5, fract((s - uT * 1.2) / 1.1));
        gl_FragColor = vec4(uAhead, edge * dash * 0.9);
      }`,
  });
  const routeLine = new THREE.Mesh(ribbon(0.32, 0.05), lineMat); routeLine.renderOrder = 2; scene.add(routeLine);

  // oven + fire particles + smoke
  const oven = buildOven(); oven.group.position.copy(OVEN).setY(0.28); oven.group.rotation.y = Math.PI / 4; scene.add(oven.group);
  const ovenFwd = new THREE.Vector3(Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4));
  const mouthPos = OVEN.clone().setY(1.75).addScaledVector(ovenFwd, 1.5);
  fire.position.copy(mouthPos).addScaledVector(ovenFwd, 0.6).setY(1.95);
  const dot = softDot();
  const pts = (n, size, color, blending, opacity = 1) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.PointsMaterial({ size, map: dot, color, transparent: true, depthWrite: false, blending, opacity, sizeAttenuation: true, toneMapped: false });
    const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p); return p;
  };
  const NF = Math.round(26 * tier.particles), NS = Math.round(30 * tier.particles);
  const flames = pts(NF, 0.32, new THREE.Color(1.8, 0.9, 0.35), THREE.AdditiveBlending);
  const smoke = pts(NS, 1.1, new THREE.Color('#ffffff'), THREE.NormalBlending, 0.5);
  const flameS = Array.from({ length: NF }, (_, i) => ({ age: i / NF, x: 0, z: 0 }));
  const SMOKE_SRC = [OVEN.clone().add(new THREE.Vector3(-0.78, 3.45, -0.28)), new THREE.Vector3(-9.4, 4.8, 3.6), new THREE.Vector3(HOUSE.x + 0.9, 4.1, HOUSE.z - 0.4)];
  const smokeS = Array.from({ length: NS }, (_, i) => ({ age: i / NS, src: i % 3, j: Math.random() }));
  const lampGlow = pts(town.lamps.length + 4, 1.6, new THREE.Color('#ffd58a'), THREE.AdditiveBlending, 0);
  town.lamps.forEach(([x, z], i) => lampGlow.geometry.attributes.position.setXYZ(i, x, 2.5, z));

  // trees (instanced crowns)
  const crownGeo = paint(new THREE.IcosahedronGeometry(0.75, 1), '#ffffff'); crownGeo.computeVertexNormals();
  const crowns = new THREE.InstancedMesh(crownGeo, CLAY(), town.trees.length); crowns.castShadow = true; crowns.receiveShadow = true;
  const leafA = col(P.leaf), leafB = col(P.leafLight);
  town.trees.forEach((tr, i) => crowns.setColorAt(i, leafA.clone().lerp(leafB, (i * 0.37) % 1)));
  scene.add(crowns);
  const treeM = new THREE.Object3D();
  function swayTrees(time) {
    town.trees.forEach(([x, y, z, s], i) => {
      treeM.position.set(x, y, z); treeM.scale.set(s, s * 1.08, s);
      treeM.rotation.set(Math.sin(time * 1.3 + i) * 0.05, i, Math.cos(time * 1.1 + i * 1.7) * 0.05);
      treeM.updateMatrix(); crowns.setMatrixAt(i, treeM.matrix);
    });
    crowns.instanceMatrix.needsUpdate = true;
  }

  // pizza, box, sticker
  const pizzaMesh = new THREE.Mesh(pizzaGeo(0.42), CLAY()); scene.add(pizzaMesh);
  const bubbles = new THREE.InstancedMesh(paint(sph(0.05, 8, 6), P.cheese), CLAY(), 7); scene.add(bubbles);
  const bx = boxParts();
  const boxG = new THREE.Group(); boxG.position.copy(TABLE).setY(0.99); boxG.rotation.y = Math.PI / 4; scene.add(boxG);
  const trayMesh = new THREE.Mesh(bx.tray, CLAY()); boxG.add(trayMesh);
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, bx.h, -bx.w / 2); boxG.add(lidPivot);
  const lidMesh = new THREE.Mesh(bx.lid, CLAY()); lidPivot.add(lidMesh);
  const sticker = new THREE.Mesh(new THREE.CircleGeometry(0.26, 32), new THREE.MeshStandardMaterial({ map: stickerTex(), roughness: 0.6, transparent: true }));
  sticker.rotation.x = -Math.PI / 2; sticker.position.set(0, 0.02, bx.w / 2); lidPivot.add(sticker);
  const boxBlob = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false })); boxBlob.rotation.x = -Math.PI / 2; boxBlob.position.copy(TABLE).setY(1.0); boxBlob.visible = false; scene.add(boxBlob);

  // scooter (+ headlight cone), courier, contact shadows
  const scooterG = new THREE.Group(); scene.add(scooterG);
  const scooterRider = new THREE.Mesh(scooterGeo(true), CLAY()), scooterEmpty = new THREE.Mesh(scooterGeo(false), CLAY());
  scooterRider.castShadow = scooterEmpty.castShadow = false;
  scooterG.add(scooterRider, scooterEmpty); scooterEmpty.visible = false;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 20, 1, true).rotateZ(Math.PI / 2).translate(2.4, 1.0, 0), new THREE.MeshBasicMaterial({ color: '#fff1c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  scooterG.add(cone);
  head.position.set(0.85, 1.15, 0); head.target.position.set(4, 0, 0); scooterG.add(head, head.target);
  const courierG = new THREE.Group(); courierG.add(new THREE.Mesh(courierGeo(), CLAY())); scene.add(courierG);
  const carryBox = new THREE.Mesh(bx.tray, CLAY()); carryBox.scale.setScalar(0.62); carryBox.position.set(0.42, 1.12, 0); courierG.add(carryBox);
  const carryLid = new THREE.Mesh(bx.lid, CLAY()); carryLid.scale.setScalar(0.62); carryLid.position.set(0.42 - 0.36, 1.25, 0); carryLid.rotation.y = Math.PI / 2; courierG.add(carryLid);
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }), 4); blobs.renderOrder = 1; scene.add(blobs);
  const doorPivot = new THREE.Group(); doorPivot.position.set(DOOR.x - 0.4, 0.2, DOOR.z + 0.02); scene.add(doorPivot);
  const doorMesh = new THREE.Mesh(paint(rbox(0.8, 1.48, 0.07, 0.03).translate(0.4, 0.74, 0), P.wood), CLAY()); doorPivot.add(doorMesh);
  const knob = new THREE.Mesh(paint(sph(0.05, 8, 6).translate(0.68, 0.72, 0.06), '#f4cf6e'), CLAY()); doorPivot.add(knob);

  // cars on the outer streets
  const cars = [new THREE.Mesh(carGeo('#9fd6ea'), CLAY()), new THREE.Mesh(carGeo('#f6c96e'), CLAY()), new THREE.Mesh(carGeo(P.basil), CLAY())];
  cars.forEach((c) => scene.add(c));
  const CAR_PATHS = [{ axis: 'z', c: 12.55, dir: 1, off: 0 }, { axis: 'x', c: -10.55, dir: -1, off: 0.45 }, { axis: 'z', c: 11.45, dir: -1, off: 0.7 }];

  // confetti
  const NC = Math.round(90 * tier.particles);
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.14), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), NC);
  confetti.frustumCulled = false; scene.add(confetti);
  const CC = ['#e5502f', '#5b8a3c', '#f6c96e', '#9fd6ea', '#fbf2e3', '#c2311e'].map(col);
  for (let i = 0; i < NC; i++) confetti.setColorAt(i, CC[i % CC.length]);
  const conf = Array.from({ length: NC }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), live: false }));
  let confT = -1;
  function burst(staticOnly) {
    confT = 0;
    for (const c of conf) {
      c.p.set(DOOR.x + (Math.random() - 0.5) * 0.4, 1.9, DOOR.z + 0.5);
      const a = Math.random() * Math.PI * 2, s = 1.6 + Math.random() * 2.6;
      c.v.set(Math.cos(a) * s * 0.55, 3.2 + Math.random() * 2.6, Math.sin(a) * s * 0.4 + 0.8);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); c.w.set(Math.random() * 9 - 4.5, Math.random() * 9 - 4.5, Math.random() * 9 - 4.5);
      c.live = true;
      if (staticOnly) { c.p.set(DOOR.x + (Math.random() - 0.5) * 3.4, 0.27, DOOR.z + 0.4 + Math.random() * 2.2); c.v.set(0, 0, 0); c.live = false; }
    }
  }

  // ---------------------------------------------------------------- composer (MSAA + tilt-shift + output)
  let composer = null, tiltH, tiltV;
  function makeComposer() {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: tier.msaa });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    tiltH = new ShaderPass(TiltShift(true)); tiltV = new ShaderPass(TiltShift(false));
    composer.addPass(tiltH); composer.addPass(tiltV); composer.addPass(new OutputPass());
  }
  makeComposer();

  // ---------------------------------------------------------------- time of day
  let tod = 'day', todMix = null;
  const cur = { night: 0 };
  function applyTod(name, instant = true) {
    tod = name; const p = TOD[name];
    sun.color.set(p.sun); sun.intensity = p.sunI; sun.position.set(...p.sunDir); hemi.color.set(p.hemiSky); hemi.groundColor.set(p.hemiGround); hemi.intensity = p.hemiI;
    scene.environmentIntensity = p.env; renderer.toneMappingExposure = p.exposure; cur.night = p.night;
    emMat.color.setScalar(0.35 + 0.65 * Math.max(p.night, 0.25) + (p.night > 0.5 ? 0.6 : 0));
    lampGlow.material.opacity = p.lamps * 0.85;
    head.intensity = p.night * 40; cone.material.opacity = p.night * 0.16;
    sign.material.emissiveIntensity = p.night * 0.25; sign.material.emissiveMap = sign.material.map; sign.material.needsUpdate = true;
    root.style.setProperty('--sky-a', p.bg[0]); root.style.setProperty('--sky-b', p.bg[1]); root.dataset.tod = name;
    renderer.shadowMap.needsUpdate = true;
  }

  // ---------------------------------------------------------------- camera shots
  // target, framing width (world units that must fit across), azimuth (deg, from +z toward +x), elevation (deg)
  const SHOTS = {
    baking: { t: mouthPos.clone().add(new THREE.Vector3(-0.2, -0.2, 0.25)), w: 6.6, az: 40, el: 19, focus: 0.5 },
    boxed: { t: TABLE.clone().lerp(OVEN, 0.3).setY(1.2), w: 5.6, az: 52, el: 30, focus: 0.5 },
    onway: { t: new THREE.Vector3(1.6, 0, 1.0), w: 27, az: 45, el: 40, focus: 0.5 },
    delivered: { t: DOOR.clone().add(new THREE.Vector3(0.3, 0.9, 1.4)), w: 8.4, az: 22, el: 24, focus: 0.5 },
  };
  const view = { offX: 0, offY: 0, w: 1, h: 1, safeW: 1, safeH: 1 };     // free area (CSS px) not covered by the panel
  const camState = { t: new THREE.Vector3().copy(SHOTS.onway.t), w: 27, az: 45, el: 40, focus: 0.5 };
  let from = null, to = null, glideT = 1, shotKey = '';
  const easeIO = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  function liveShot(key, scooterPos) {
    const s = SHOTS[key];
    if (key !== 'onway') return s;
    // the wide shot drifts gently with the scooter (a third of the way toward it)
    return { ...s, t: s.t.clone().lerp(scooterPos, 0.3) };
  }
  function placeCamera() {
    // the frustum spans the whole canvas; the shot must fit the free sub-rect (safeW × safeH) of it
    const fov = camera.fov * Math.PI / 180, tv = Math.tan(fov / 2), th = tv * view.w / view.h;
    const dist = Math.max(camState.w / 2 / (th * view.safeW / view.w), camState.w * 0.62 / 2 / (tv * view.safeH / view.h));
    const az = camState.az * Math.PI / 180, el = camState.el * Math.PI / 180;
    camera.position.set(camState.t.x + dist * Math.cos(el) * Math.sin(az), camState.t.y + dist * Math.sin(el), camState.t.z + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(camState.t);
    camera.near = Math.max(0.5, dist - 40); camera.far = dist + 60; camera.updateProjectionMatrix();
    if (tiltH) { tiltH.uniforms.uFocus.value = tiltV.uniforms.uFocus.value = camState.focus; }
  }

  function resize() {
    const r = root.getBoundingClientRect(); const w = Math.max(1, r.width), h = Math.max(1, r.height);
    // pixel budget: the canvas never exceeds ~2.8 MP (DPR 1.5 at 1440×900, ~1.05 on a 2560 screen); text is HTML, so it stays sharp
    const pr = Math.min(devicePixelRatio || 1, tier.dprCap, tier.adaptCap, Math.max(1, Math.sqrt(tier.budget / (w * h))));
    if (Math.abs(renderer.getPixelRatio() - pr) > 0.01) { renderer.setPixelRatio(pr); composer.setPixelRatio?.(pr); }
    renderer.setSize(w, h, false); composer.setSize(w, h);
    const px = renderer.getPixelRatio();
    tiltH.uniforms.uRes.value.set(w * px, h * px); tiltV.uniforms.uRes.value.set(w * px, h * px);
    view.w = w; view.h = h; camera.aspect = w / h;
    // the floating panel covers part of the hero: centre the action in the free area with a view offset
    const free = root.__free ? root.__free() : { x: 0, y: 0, w, h };
    view.safeW = free.w; view.safeH = free.h;
    const cx = free.x + free.w / 2, cy = free.y + free.h / 2;
    camera.setViewOffset(w, h, (w / 2 - cx), (h / 2 - cy), w, h);
    placeCamera();
  }
  new ResizeObserver(resize).observe(root);

  // ---------------------------------------------------------------- transitions (same model as the SVG scene)
  const A = { boxing: { v: 0, dur: 2.2 }, gone: { v: 0, dur: 0.8 }, arrive: { v: 0, dur: 3.2 } };
  let lastT = null, confettiFired = false, clock = 0;
  const seg = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  const tmpQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), dummy = new THREE.Object3D();
  const stageKey = (t) => t < T.boxAt ? 'baking' : t < T.rideAt ? 'boxed' : t < T.doneAt ? 'onway' : 'delivered';

  function update(t, dt, snap = false) {
    clock += dt;
    const big = lastT === null || Math.abs(t - lastT) > 0.75, jump = snap || reduced || big; lastT = t;
    const target = { boxing: t >= T.boxAt ? 1 : 0, gone: t >= T.rideAt ? 1 : 0, arrive: t >= T.doneAt ? 1 : 0 };
    for (const k in A) { const a = A[k]; if (jump || target[k] < a.v) a.v = target[k]; else a.v = Math.min(target[k], a.v + dt / a.dur); }
    const b = A.boxing.v, gone = A.gone.v, arrive = A.arrive.v;

    // oven: fire flicker (stronger while baking), pizza in the oven → peel → box
    const hot = t < T.boxAt ? 1 : 0.55;
    const flick = 0.8 + 0.2 * Math.sin(clock * 13.1) * Math.sin(clock * 7.3 + 1) + 0.08 * Math.sin(clock * 31);
    fire.intensity = (cur.night ? 9 : 5) * hot * (reduced ? 0.9 : flick);
    oven.mouthMat.color.setRGB(1.3 + 0.5 * hot * flick, 1.0 + 0.3 * hot * flick, 0.85);
    const inOven = mouthPos.clone().addScaledVector(ovenFwd, -0.25).setY(1.63);
    const inBox = TABLE.clone().setY(1.03);
    const fly = easeIO(seg(b, 0.02, 0.4));
    pizzaMesh.visible = gone < 0.5;
    pizzaMesh.position.lerpVectors(inOven, inBox, fly); pizzaMesh.position.y += Math.sin(fly * Math.PI) * 1.4;
    pizzaMesh.rotation.y = fly * Math.PI * 1.5;
    // bubbling cheese while baking
    bubbles.visible = t < T.boxAt && !reduced;
    if (bubbles.visible) for (let i = 0; i < 7; i++) {
      const a = i * 2.4, r = 0.12 + (i % 3) * 0.08, ph = (clock * (0.7 + i * 0.13) + i * 0.37) % 1;
      dummy.position.set(inOven.x + Math.cos(a) * r, inOven.y + 0.1, inOven.z + Math.sin(a) * r); dummy.scale.setScalar(Math.sin(ph * Math.PI) * 1.2 + 0.01); dummy.updateMatrix(); bubbles.setMatrixAt(i, dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate = true;
    // lid folds shut, then the sticker slaps on
    const lidK = easeIO(seg(b, 0.45, 0.82));
    lidPivot.rotation.x = -(1 - lidK) * 1.95;
    const st = seg(b, 0.84, 1);
    sticker.visible = st > 0;
    const slap = st < 1 ? 1 + (1 - easeIO(st)) * 1.6 : 1;
    sticker.scale.setScalar(slap); sticker.rotation.z = (1 - st) * 0.8; sticker.position.y = 0.02 + (1 - easeIO(st)) * 0.5;
    boxG.visible = gone < 0.98; boxG.position.y = 0.99 + gone * 0.4; boxG.scale.setScalar(1 - gone * 0.6);

    // the ride
    const u = PARK_U + rideShare(t) * (1 - PARK_U);
    const p = ROUTE.getPointAt(u), tg = ROUTE.getTangentAt(u);
    scooterG.position.copy(p).setY(0.05);
    scooterG.rotation.y = Math.atan2(-tg.z, tg.x);
    scooterRider.visible = arrive < 0.04; scooterEmpty.visible = !scooterRider.visible;
    lineMat.uniforms.uP.value = t < T.rideAt ? 0 : u; lineMat.uniforms.uT.value = clock;
    if (t >= T.rideAt && t < T.doneAt && !reduced) scooterG.position.y += Math.abs(Math.sin(clock * 9)) * 0.02;

    // arrival: courier walks to the door with the box, door opens, confetti, handover
    courierG.visible = arrive > 0.02;
    if (courierG.visible) {
      const w = easeIO(seg(arrive, 0.02, 0.45)), a0 = new THREE.Vector3(p.x + 0.2, 0.25, p.z + 0.7), a1 = new THREE.Vector3(DOOR.x + 1.0, 0.25, DOOR.z + 0.62);
      courierG.position.lerpVectors(a0, a1, w); courierG.position.y += (w > 0 && w < 1 ? Math.abs(Math.sin(w * Math.PI * 6)) * 0.06 : 0);
      const face = w < 1 ? Math.atan2(-(a1.z - a0.z), a1.x - a0.x) : -Math.PI * 0.35;
      courierG.rotation.y = face;
      const give = easeIO(seg(arrive, 0.62, 0.85));
      carryBox.position.x = 0.42 + give * 0.25; carryLid.position.x = 0.06 + give * 0.25;
    }
    doorPivot.rotation.y = -easeIO(seg(arrive, 0.32, 0.62)) * 1.75;
    if (arrive >= 0.5 && !confettiFired) { confettiFired = true; burst(reduced); }
    if (arrive < 0.5 && confettiFired) { confettiFired = false; confT = -1; for (const c of conf) c.live = false; }
    confetti.visible = confettiFired;
    if (confetti.visible) {
      for (let i = 0; i < NC; i++) {
        const c = conf[i];
        if (c.live) { c.v.y -= 9.8 * dt * 0.55; c.v.multiplyScalar(1 - dt * 1.2); c.p.addScaledVector(c.v, dt); c.r.addScaledVector(c.w, dt); if (c.p.y < 0.27) { c.p.y = 0.27; c.live = false; c.r.x = Math.PI / 2; } }
        dummy.position.copy(c.p); dummy.rotation.set(c.r.x, c.r.y, c.r.z); dummy.scale.setScalar(1); dummy.updateMatrix(); confetti.setMatrixAt(i, dummy.matrix);
      }
      confetti.instanceMatrix.needsUpdate = true;
    }

    // contact shadows: scooter, courier, two cars
    const blob = (i, x, z, sx, sz, rot, on) => { dummy.position.set(x, 0.26, z); dummy.rotation.set(0, rot, 0); dummy.scale.set(on ? sx : 0.0001, 1, on ? sz : 0.0001); dummy.updateMatrix(); blobs.setMatrixAt(i, dummy.matrix); };
    blob(0, p.x, p.z, 2.4, 1.2, scooterG.rotation.y, true);
    blob(1, courierG.position.x, courierG.position.z, 1.0, 1.0, 0, courierG.visible);

    // cars, trees, smoke, flames
    cars.forEach((c, i) => {
      const cp = CAR_PATHS[i], k = (((clock * 0.045 * (1 + i * 0.2)) + cp.off) % 1), s = -HALF + 0.8 + k * (HALF * 2 - 1.6), sDir = cp.dir > 0 ? s : -s;
      const edge = Math.min(1, Math.min(k, 1 - k) * 14);
      if (cp.axis === 'z') { c.position.set(cp.c, 0.02, sDir); c.rotation.y = cp.dir > 0 ? -Math.PI / 2 : Math.PI / 2; }
      else { c.position.set(sDir, 0.02, cp.c); c.rotation.y = cp.dir > 0 ? 0 : Math.PI; }
      c.scale.setScalar(Math.max(0.001, edge));
      if (i < 2) blob(2 + i, c.position.x, c.position.z, 2.0 * edge, 1.2 * edge, c.rotation.y, true);
    });
    blobs.instanceMatrix.needsUpdate = true;
    if (!reduced) swayTrees(clock);
    const fp = flames.geometry.attributes.position;
    for (let i = 0; i < NF; i++) {
      const f = flameS[i]; f.age += dt * (1.6 + (i % 5) * 0.2);
      if (f.age > 1) { f.age -= 1; f.x = (Math.random() - 0.5) * 0.7; f.z = (Math.random() - 0.5) * 0.2; }
      const q = mouthPos.clone().addScaledVector(ovenFwd, -0.42);
      fp.setXYZ(i, q.x + f.x * ovenFwd.z + f.z * ovenFwd.x, 1.66 + f.age * 0.55 * hot, q.z - f.x * ovenFwd.x + f.z * ovenFwd.z);
    }
    fp.needsUpdate = true; flames.material.size = 0.3 * (0.6 + hot * 0.6);
    const sp = smoke.geometry.attributes.position;
    for (let i = 0; i < NS; i++) {
      const s = smokeS[i]; s.age += dt * 0.22; if (s.age > 1) { s.age -= 1; s.j = Math.random(); }
      const src = SMOKE_SRC[s.src];
      sp.setXYZ(i, src.x + Math.sin(s.age * 4 + s.j * 6) * 0.25 + s.age * 0.9, src.y + s.age * 3.0, src.z - s.age * 0.6);
    }
    sp.needsUpdate = true; smoke.material.opacity = reduced ? 0 : 0.42 * (1 - cur.night * 0.5);

    // camera: glide to the stage's shot (no cuts); the wide shot follows the scooter softly
    const key = stageKey(t);
    const live = liveShot(key, p);
    if (key !== shotKey) {
      from = { t: camState.t.clone(), w: camState.w, az: camState.az, el: camState.el, focus: camState.focus };
      glideT = (shotKey === '' || reduced) ? 1 : 0; shotKey = key;
    }
    glideT = Math.min(1, glideT + dt / 2.6);
    const k = easeIO(glideT);
    if (k >= 1) { camState.t.copy(live.t); camState.w = live.w; camState.az = live.az; camState.el = live.el; camState.focus = live.focus; }
    else {
      camState.t.lerpVectors(from.t, live.t, k); camState.w = from.w + (live.w - from.w) * k; camState.az = from.az + (live.az - from.az) * k;
      // arc up through a higher elevation mid-glide (a crane move instead of a straight dolly)
      camState.el = from.el + (live.el - from.el) * k + Math.sin(k * Math.PI) * 10; camState.focus = from.focus + (live.focus - from.focus) * k;
    }
    placeCamera();
    // tilt-shift: strongest on the wide map, gentle on the close-ups
    tiltH.uniforms.uAmount.value = tiltV.uniforms.uAmount.value = tier.tilt ? (key === 'onway' ? 3.0 : 1.5) : 0;
    tiltH.enabled = tiltV.enabled = tier.tilt;

    return { focus: [0, 0], stage: key };
  }

  function replay(name, t) {
    if (A[name]) A[name].v = 0; lastT = t;
    if (name === 'arrive') { confettiFired = false; confT = -1; }
  }

  // adaptive quality: if frames run long for a second, step the pixel ratio down (then drop tilt-shift)
  const adapt = { n: 0, slow: 0, last: 0 };
  function frameTime(ms) {
    adapt.n++; if (ms > 11.5) adapt.slow++;
    if (adapt.n >= 90) {
      if (adapt.slow > 30) {
        const pr = renderer.getPixelRatio();
        if (pr > 1.01) { tier.adaptCap = Math.max(1, pr - 0.25); resize(); }
        else if (tier.tilt) { tier.tilt = false; }
      }
      adapt.n = adapt.slow = 0;
    }
  }

  applyTod('day');
  resize();
  // compile every program now (hidden things too), so the first delivery or confetti burst never stalls a frame
  const hidden = []; scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  renderer.compile(scene, camera); composer.render();
  for (const o of hidden) o.visible = false;
  renderer.shadowMap.needsUpdate = true;
  return {
    update, replay, camera: () => {}, render: () => composer.render(), resize, frameTime, setTimeOfDay: (n) => applyTod(n), get tod() { return tod; },
    get vis() { return [view.w, view.h]; }, renderer, kind: '3d', debug: { scene, scooterG, scooterRider, camera },
    probe: () => {
      const v = scooterG.position.clone().setY(1).project(camera), r = canvas.getBoundingClientRect();
      return { shot: shotKey, glide: +glideT.toFixed(3), lid: +lidPivot.rotation.x.toFixed(3), sticker: sticker.visible ? +sticker.scale.x.toFixed(3) : 0,
        pizza: pizzaMesh.visible ? pizzaMesh.position.toArray().map((x) => +x.toFixed(2)) : null, box: boxG.visible, door: +doorPivot.rotation.y.toFixed(3),
        confetti: confetti.visible, courier: courierG.visible, rider: scooterRider.visible, route: +lineMat.uniforms.uP.value.toFixed(4), tod, fire: +fire.intensity.toFixed(2),
        scooter: [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height], calls: renderer.info.render.calls, pr: renderer.getPixelRatio(), tilt: tier.tilt };
    },
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: renderer.getPixelRatio(), tilt: tier.tilt }),
  };
}
