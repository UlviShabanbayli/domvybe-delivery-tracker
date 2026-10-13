// The four stage tiles under the tracker: small illustrations of each state, drawn with the scene's own models.
import { projector, render, paint, svgEl, box } from './iso.js';
import * as M from './models.js';
import { kit, buildOven, buildBox, drawLid } from './scene.js';

const VB = [300, 200];
function svgFor(host, bg) {
  const s = svgEl('svg', { viewBox: `0 0 ${VB[0]} ${VB[1]}`, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid slice' });
  svgEl('rect', { width: VB[0], height: VB[1], fill: bg }, s);
  host.appendChild(s);
  return { s, defs: svgEl('defs', {}, s) };
}

function baking(host) {
  const { s, defs } = svgFor(host, '#f7e6cc');
  const g = svgEl('linearGradient', { id: 'tile-hot', x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
  svgEl('stop', { offset: 0, 'stop-color': '#e5502f' }, g); svgEl('stop', { offset: 1, 'stop-color': '#f39a3d' }, g);
  svgEl('polygon', { points: '0,0 205,0 0,150', fill: 'url(#tile-hot)' }, s);
  const k = kit(projector(138, 122, 24));
  k.mesh(s, box(-3.2, -3.2, -0.3, 6.6, 6.6, 0.3, '#d8d3cb', { colors: { right: '#b7afa4', left: '#c5beb4' } }));
  const glow = svgEl('radialGradient', { id: 'tile-glow' }, defs);
  svgEl('stop', { offset: 0, 'stop-color': '#ffcf6a', 'stop-opacity': 0.8 }, glow); svgEl('stop', { offset: 1, 'stop-color': '#ffb050', 'stop-opacity': 0 }, glow);
  const o = buildOven(s, defs, k, [0, 0, 0], 'tile');
  svgEl('circle', { cx: o.mouth[0], cy: o.mouth[1], r: 48, fill: 'url(#tile-glow)' }, s);
}

function boxed(host) {
  const { s } = svgFor(host, '#f6eadb');
  const k = kit(projector(150, 92, 38));
  const b = buildBox(s, k, [-1.25, -1.25, 0]);
  drawLid(b, 0.95);
  // steam
  for (const [x, d] of [[178, 0], [196, 6], [212, 2]]) svgEl('path', { d: `M${x} ${70 + d} c-8 -10 8 -16 0 -26 c-6 -8 6 -14 0 -22`, fill: 'none', stroke: '#ffffff', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.9 }, s);
}

function onway(host) {
  const { s } = svgFor(host, '#7aa156');
  const P = projector(122, 14, 17), k = kit(P);
  k.quad(s, -3, -4, 14, 14, 0, '#fdf8ef');
  const blocks = [[-3, -4, 1.4, 2.8, '#ecdcc4'], [2.6, -4, 7.4, 2.8, '#9fd6ea'], [8.6, -4, 14, 2.8, '#7aa156'], [-3, 4.2, 1.4, 9, '#ecdcc4'], [2.6, 4.2, 7.4, 9, '#ecdcc4'], [8.6, 4.2, 14, 9, '#ecdcc4'], [-3, 10.4, 1.4, 14, '#7aa156'], [2.6, 10.4, 7.4, 14, '#ecdcc4'], [8.6, 10.4, 14, 14, '#ecdcc4']];
  for (const [x0, y0, x1, y1, c] of blocks) k.quad(s, x0, y0, x1, y1, 0, c);
  k.quad(s, 3.2, -3.4, 6.8, 0.6, 0.01, '#ecdcc4');
  // dashed route ahead of the scooter, to the pin
  const route = [[6.4, 7.1], [8, 7.1], [8, 3.5], [8, -1.5]];
  k.line(s, route.map(([x, y]) => [x, y, 0.02]), { stroke: '#2d211b', 'stroke-width': 3.2, 'stroke-dasharray': '7 6', 'stroke-linecap': 'round' });
  const p0 = projector(0, 0, 17);
  const g = svgEl('g', { transform: `translate(${P(5.2, 7.1)[0].toFixed(1)} ${P(5.2, 7.1)[1].toFixed(1)}) scale(.95)` }, s);
  svgEl('ellipse', { cx: 0, cy: 3, rx: 34, ry: 10, fill: 'rgba(0,0,0,.15)' }, g);
  const sg = svgEl('g', {}, g); paint(sg, render(M.scooter(0, 0, 0, 0, true), p0));
  const [px, py] = P(8, -1.5, 0);
  const pin = svgEl('g', { transform: `translate(${(px - 19).toFixed(1)} ${(py - 52).toFixed(1)}) scale(.6)` }, s);
  pin.innerHTML = '<ellipse cx="32" cy="80" rx="12" ry="4" fill="rgba(0,0,0,.18)"/><path d="M32 2C16 2 4 14 4 29c0 20 24 44 26.6 49.4a1.6 1.6 0 0 0 2.8 0C36 73 60 49 60 29 60 14 48 2 32 2Z" fill="#d93a22"/><circle cx="32" cy="29" r="17" fill="#fff"/><path d="M22 30 32 21l10 9v10H22Z" fill="#5b8a3c"/>';
}

function delivered(host) {
  const { s } = svgFor(host, '#f6eadb');
  const P = projector(128, 112, 30), k = kit(P);
  k.quad(s, -3, 0, 4, 3.2, 0, '#efe0c8');
  // wall with a door opening (plane y = 0, faces +y)
  k.mesh(s, box(-2.2, -0.35, 0, 4.4, 0.35, 3.3, '#f4e7d2', { colors: { left: '#f6ead8', right: '#e9d6ba', top: '#e2cfb2' } }));
  k.poly(s, [[-0.55, 0.004, 0], [0.45, 0.004, 0], [0.45, 0.004, 2.0], [-0.55, 0.004, 2.0]], '#7a4526');
  k.poly(s, [[-0.45, 0.006, 0], [0.35, 0.006, 0], [0.35, 0.006, 1.9], [-0.45, 0.006, 1.9]], '#ffd88a');
  k.poly(s, [[-0.75, 0.2, 0.01], [0.65, 0.2, 0.01], [0.65, 1.15, 0.01], [-0.75, 1.15, 0.01]], '#5f9a45');
  const door = svgEl('g', {}, s); paint(door, render(M.doorPanel(-0.45, 0, 0.8, 1.9, 1.7), P, { cull: false }));
  // a green welcome sign on the wall
  k.poly(s, [[0.8, 0.004, 2.15], [1.9, 0.004, 2.15], [1.9, 0.004, 2.55], [0.8, 0.004, 2.55]], '#5b8a3c');
  // courier with the pizza
  const p0 = projector(0, 0, 30), [cx, cy] = P(2.3, 0.75, 0), hd = Math.PI * 0.55;
  const g = svgEl('g', { transform: `translate(${cx.toFixed(1)} ${cy.toFixed(1)})` }, s);
  svgEl('ellipse', { cx: 0, cy: 3, rx: 28, ry: 9, fill: 'rgba(0,0,0,.15)' }, g);
  const cg = svgEl('g', {}, g); paint(cg, render(M.courier(0, 0, 0, hd), p0));
  const f = M.SCOOTER_SCALE, pz = svgEl('g', {}, g); M.pizza(pz, p0, 0.91 * f * Math.cos(hd), 0.91 * f * Math.sin(hd), 1.33 * f + 0.02, 0.62);
  // confetti
  const colors = ['#e5502f', '#5b8a3c', '#f6c96e', '#9fd6ea', '#c2311e'];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 34; i++) {
    const x = 20 + rnd() * 260, y = 8 + rnd() * 120;
    if (x > 95 && x < 215 && y > 30) continue;
    svgEl('rect', { x: x.toFixed(1), y: y.toFixed(1), width: 4.5, height: 7, rx: 1, fill: colors[i % colors.length], transform: `rotate(${(rnd() * 180).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})` }, s);
  }
}

export function buildTiles(root) {
  const fns = { baking, boxed, onway, delivered };
  for (const host of root.querySelectorAll('[data-art]')) {
    // the tiles show renders of the 3D scene; if an image is missing, the SVG illustration stands in
    const img = host.querySelector('img');
    const svg = () => { img?.remove(); fns[host.dataset.art]?.(host); };
    if (!img) svg(); else if (img.complete && !img.naturalWidth) svg(); else img.addEventListener('error', svg, { once: true });
  }
}
