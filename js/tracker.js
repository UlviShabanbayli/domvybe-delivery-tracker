// DV49 · pizzatime DELIVERY tracker: state, demo clock, UI sync, announcements, dialogs.
import { createScene, kmLeft } from './scene.js';
import { STAGES, T, SHOWCASE_T, stageIndex, trackShare, minutesLeft } from './timeline.js';
import { buildTiles } from './tiles.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- storage (versioned keys, old ones wiped)
const KEY = 'dv49a.';
const store = {
  get(k) { try { return localStorage.getItem(KEY + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(KEY + k, v); } catch { /* blocked storage: the page still works */ } },
};
try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('dv49') && !k.startsWith(KEY)) localStorage.removeItem(k); } } catch { /* ignore */ }

// ---------------------------------------------------------------- orders (fictional)
const ORDERS = {
  'PT-48213': {
    no: 'PT-48213', t0: SHOWCASE_T,
    items: [['1', 'Margherita Napoletana', '12" · fior di latte, basil', 14.5], ['1', 'Pepperoni Fire', '12" · hot honey', 16.0], ['1', 'Garlic knots', '6 pieces · parsley butter', 5.5], ['2', 'Lemon soda', '330 ml cans', 5.0]],
    fee: 2.49, tip: 3.0, courier: { name: 'Marco R.', first: 'Marco', rating: '4.9', ride: 'Red scooter · PT 12', tel: '+13125550134' },
    addr: 'Flat 3, 27 Basil Lane', note: 'Ring the green door. Buzzer 3.', paid: 'Card ending 4242 · tip included',
  },
  'PT-48257': {
    no: 'PT-48257', t0: 3.2,
    items: [['2', 'Quattro Formaggi', '12" · gorgonzola, honey', 33.0], ['1', 'Rocket salad', 'parmesan, lemon', 7.5]],
    fee: 2.49, tip: 2.0, courier: { name: 'Sofia L.', first: 'Sofia', rating: '4.8', ride: 'Red scooter · PT 07', tel: '+13125550161' },
    addr: '9 Oregano Court', note: 'Leave with the concierge.', paid: 'Apple Pay · tip included',
  },
  'PT-48190': {
    no: 'PT-48190', t0: T.doneAt,
    items: [['1', 'Diavola', '12" · spicy salami, chilli', 15.5], ['1', 'Tiramisu jar', 'mascarpone, espresso', 6.0]],
    fee: 2.49, tip: 2.5, courier: { name: 'Dani K.', first: 'Dani', rating: '5.0', ride: 'Red e-bike · PT 21', tel: '+13125550147' },
    addr: '41 Mill Street, 2nd floor', note: 'Call when outside.', paid: 'Card ending 1881 · tip included',
  },
};

// ---------------------------------------------------------------- state
const params = new URLSearchParams(location.search);
const qStage = STAGES.find((s) => s.id === params.get('stage'));
const S = {
  order: ORDERS['PT-48213'],
  t: params.has('t') ? Math.min(T.end, Math.max(0, +params.get('t') || 0)) : qStage ? stageT(qStage.id) : SHOWCASE_T,
  speed: +(params.get('speed') || store.get('speed') || 10),
  playing: !reduced && !params.has('paused'),
  stage: -1,
  placedAt: 0,
  rated: 0,
};
if (![1, 10, 60].includes(S.speed)) S.speed = 10;
function anchorClock() { const now = Date.now(); S.placedAt = Math.floor((now - S.t * 60000) / 60000) * 60000; }
anchorClock();

function stageT(id) { return { baking: 2.5, boxed: T.boxAt, onway: SHOWCASE_T, delivered: T.doneAt }[id]; }
// one formatter, one string per wall-clock minute (toLocaleTimeString per call cost ~1 ms on a throttled phone)
const fmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }), clockMemo = new Map();
const clock = (min) => {
  const k = Math.floor((S.placedAt + min * 60000) / 60000);
  let v = clockMemo.get(k); if (v === undefined) { v = fmt.format(new Date(k * 60000)); clockMemo.set(k, v); }
  return v;
};
const money = (v) => '$' + v.toFixed(2);

// ---------------------------------------------------------------- elements
const sceneEl = $('[data-scene]'), hero = $('[data-hero]'), panel = $('[data-panel]'), demoEl = $('.demo');
const phoneMQ = matchMedia('(max-width: 900px) and (min-height: 561px), (max-width: 900px) and (orientation: portrait)');
// the part of the hero the panel does not cover: the 3D camera centres its shot there
sceneEl.__free = () => {
  const h = hero.getBoundingClientRect(), p = panel.getBoundingClientRect();
  if (phoneMQ.matches) { const top = $('.title').getBoundingClientRect().bottom - h.top; return { x: 0, y: top, w: h.width, h: Math.max(120, p.top - h.top - top - 50) }; }
  return { x: 0, y: 0, w: Math.max(200, p.left - h.left - 12), h: h.height };
};
function webgl2() { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; } }
let scene = null, sceneKind = 'svg';
if (webgl2() && !params.has('svg')) {
  try { const m = await import('./scene3d.js'); const q = {}; if (params.has('dpr')) q.dpr = +params.get('dpr'); if (params.has('msaa')) q.msaa = +params.get('msaa'); if (params.has('tilt')) q.tilt = params.get('tilt') === '1';
    scene = m.createScene3D(sceneEl, { reduced, phone: matchMedia('(max-width: 900px)').matches, q }); sceneKind = '3d'; window.__todFor = m.todForHour; }
  catch (e) { scene = null; sceneEl.querySelector('canvas.gl')?.remove(); }
}
if (!scene) { sceneEl.classList.add('is-svg'); scene = createScene(sceneEl, { reduced }); }
document.documentElement.dataset.sceneKind = sceneKind;
const el = {
  eta: $('[data-eta]'), etaK: $('[data-eta-k]'), etaV: $('[data-eta-v]'), sheetEta: $('[data-sheet-eta]'),
  statusH: $('[data-status-h]'), statusSub: $('[data-status-sub]'), steps: $('[data-steps]'), fill: $('[data-fill]'),
  events: $('[data-events]'), courier: $('[data-courier]'), courierN: $('[data-courier-n]'), courierS: $('[data-courier-s]'),
  primary: $('[data-primary]'), play: $('[data-action=play]'), scrub: $('#scrub'), clock: $('[data-clock]'),
  announce: $('[data-announce]'), toast: $('[data-toast]'), tiles: $('[data-tiles]'),
};
buildTiles(el.tiles);

// ---------------------------------------------------------------- announcements + toast
let annTimer = 0;
function announce(text) { clearTimeout(annTimer); annTimer = setTimeout(() => { el.announce.textContent = ''; requestAnimationFrame(() => { el.announce.textContent = text; }); }, 350); }
let toastTimer = 0;
function toast(text) { el.toast.textContent = text; el.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600); }

// ---------------------------------------------------------------- copy per stage
function copy(i) {
  const c = S.order.courier, eta = clock(T.doneAt);
  const left = Math.ceil(minutesLeft(S.t));
  return [
    { h: 'Your pizza is in the oven', sub: `Baking at 430 °C · arriving around ${eta}`, ann: `Baking: your pizza is in the oven. Arriving around ${eta}.`, cs: `Waiting at the shop for your pizza` },
    { h: 'Boxed and ready to go', sub: `${c.first} is picking it up · arriving around ${eta}`, ann: `Boxed: your pizza is boxed and ready for ${c.first}.`, cs: `Picking up your order now` },
    { h: `${c.first} is on the way`, sub: `${kmLeft(S.t).toFixed(1)} km away · arriving around ${eta}`, ann: `On the way: ${c.first} picked up your order, about ${left} minutes away.`, cs: c.ride },
    { h: 'Delivered. Enjoy!', sub: `Handed over at ${eta} by ${c.first}`, ann: `Delivered: ${c.first} is at your door. Enjoy your pizza!`, cs: `Delivered at ${eta}` },
  ][i];
}

function renderOrder() {
  const o = S.order;
  $$('[data-order-no]').forEach((n) => { n.textContent = '#' + o.no; });
  $('[data-placed]').textContent = clock(0);
  const items = $('[data-items]'); items.replaceChildren();
  let sub = 0;
  for (const [q, n, d, p] of o.items) {
    sub += p; const li = document.createElement('li');
    li.innerHTML = `<span class="q">${q}×</span><span><span class="n"></span><span class="d"></span></span><span class="p">${money(p)}</span>`;
    li.querySelector('.n').textContent = n; li.querySelector('.d').textContent = d; items.appendChild(li);
  }
  $('[data-totals]').innerHTML = `<dt>Subtotal</dt><dd>${money(sub)}</dd><dt>Delivery</dt><dd>${money(o.fee)}</dd><dt>Tip for ${o.courier.first}</dt><dd>${money(o.tip)}</dd><dt class="grand">Total</dt><dd class="grand">${money(sub + o.fee + o.tip)}</dd>`;
  $('[data-addr]').textContent = o.addr; $('[data-addr-note]').textContent = o.note; $('[data-paid]').textContent = o.paid;
  el.courierN.firstChild.textContent = o.courier.name + ' ';
  const r = el.courierN.querySelector('.rating'); r.textContent = '★ ' + o.courier.rating; r.setAttribute('aria-label', `rated ${o.courier.rating} out of 5`);
  $('[data-call]').href = 'tel:' + o.courier.tel;
  $('[data-call]').setAttribute('aria-label', `Call ${o.courier.first}`);
  $('[data-action=message]').setAttribute('aria-label', `Message ${o.courier.first}`);
  $('[data-courier-first]').textContent = o.courier.first;
  S.notes = [];
  S.stage = -1;
}

function renderEvents() {
  const i = stageIndex(S.t), c = S.order.courier;
  const rows = [[0, 'Order placed · into the oven'], [T.boxAt, 'Boxed and sealed'], [T.rideAt, `Picked up by ${c.first}`], [T.doneAt, 'Delivered to your door']];
  el.events.replaceChildren();
  rows.forEach(([m, text], k) => {
    const li = document.createElement('li'); const next = k > i;
    li.className = next ? 'is-next' : '';
    li.innerHTML = `<time>${next ? '~' : ''}${clock(m)}</time><span></span>`; li.lastChild.textContent = text;
    el.events.appendChild(li);
  });
  for (const n of S.notes || []) { const li = document.createElement('li'); li.className = 'is-you'; li.innerHTML = `<time>${n.at}</time><span></span>`; li.lastChild.textContent = `You → ${c.first}: “${n.text}”`; el.events.appendChild(li); }
}

// A stage change is split over two frames: the progress + headline change with the scene; the secondary copy
// (timeline list, courier line, primary button, tiles, the scene's label) follows one frame later.
let later = null;
function renderStage(i, quiet) {
  const c = copy(i);
  el.statusH.textContent = c.h; el.statusSub.textContent = c.sub;
  $$('li[data-step]', el.steps).forEach((li, k) => {
    const done = k < i || (k === i && i === 3);
    if (li.classList.contains('is-done') !== done) li.classList.toggle('is-done', done);
    if (k === i) li.setAttribute('aria-current', 'step'); else if (li.hasAttribute('aria-current')) li.removeAttribute('aria-current');
  });
  if (el.steps.classList.contains('is-road') !== i >= 2) el.steps.classList.toggle('is-road', i >= 2);
  later = () => renderSecondary(i);
  if (!quiet) announce(c.ann);
}
function renderSecondary(i) {
  const c = copy(i);
  el.courierS.textContent = c.cs;
  el.primary.textContent = i === 3 ? (S.rated ? `You rated it ${'★'.repeat(S.rated)}` : 'Rate your pizza') : `Message ${S.order.courier.first}`;
  el.primary.dataset.act = i === 3 ? 'rate' : 'message';
  $$('.tile', el.tiles).forEach((b) => { const v = String(b.dataset.goto === STAGES[i].id); if (b.getAttribute('aria-current') !== v) b.setAttribute('aria-current', v); });
  sceneEl.setAttribute('aria-label', `Map of your delivery. ${c.h}. ${i < 3 ? `About ${Math.ceil(minutesLeft(S.t))} minutes to go.` : ''}`);
  renderEvents();
}

// ---------------------------------------------------------------- per-frame UI sync (writes only when values change)
const ui = { eta: '', etaK: '', share: -1, scrub: -1, clock: '', sub: '', play: '', five: false, textAt: 0 };
let scrubbing = false;
function sync(force = false) {
  const i = stageIndex(S.t);
  if (i !== S.stage) { const first = S.stage === -1; S.stage = i; renderStage(i, first || force === 'quiet'); }
  const done = i === 3;
  // while the thumb is dragged, text (ETA, km, clock, value text) refreshes at 10 Hz; the map keeps every frame
  const now = performance.now(), text = force || !scrubbing || now - ui.textAt > 100;
  if (text) ui.textAt = now;
  const etaK = done ? 'Delivered at' : 'Live ETA';
  const left = Math.ceil(minutesLeft(S.t) - 1e-6);
  const etaV = done ? clock(T.doneAt) : `${Math.max(1, left)} min`;
  if (etaK !== ui.etaK) { el.etaK.textContent = etaK; el.eta.classList.toggle('is-done', done); ui.etaK = etaK; }
  if (text && etaV !== ui.etaV) { el.etaV.textContent = etaV; el.sheetEta.textContent = done ? 'Delivered' : etaV; ui.etaV = etaV; }
  if (i === 2 && text) { const sub = copy(2).sub; if (sub !== ui.sub) { el.statusSub.textContent = sub; ui.sub = sub; } }
  // a single "5 minutes away" heads-up while playing forward
  if (i === 2 && left <= 5 && !ui.five && S.playing) { ui.five = true; announce(`${S.order.courier.first} is about 5 minutes away.`); }
  if (left > 5) ui.five = false;
  const share = trackShare(S.t);
  if (Math.abs(share - ui.share) > 0.0015) { el.fill.style.setProperty('--share', share.toFixed(4)); ui.share = share; }
  if (scrubbing) { const pv = (S.t / T.end * 100).toFixed(1) + '%'; if (pv !== ui.p) { el.scrub.style.setProperty('--p', pv); ui.p = pv; } }
  if (text && (Math.abs(S.t - ui.scrub) >= 0.05 || force)) {
    if (!scrubbing) el.scrub.value = S.t.toFixed(2);
    ui.p = (S.t / T.end * 100).toFixed(1) + '%'; el.scrub.style.setProperty('--p', ui.p); ui.scrub = S.t;
    el.scrub.setAttribute('aria-valuetext', `${clock(S.t)}, ${STAGES[i].label}${done ? '' : `, ${Math.max(1, left)} minutes to go`}`);
  }
  const ck = clock(S.t); if (text && ck !== ui.clock) { el.clock.textContent = ck; ui.clock = ck; }
  const mode = S.t >= T.end - 1e-6 && !S.playing ? 'replay' : S.playing ? 'pause' : 'play';
  if (mode !== ui.play) {
    el.play.dataset.mode = mode === 'pause' ? '' : mode;
    el.play.setAttribute('aria-label', mode === 'pause' ? 'Pause the demo' : mode === 'play' ? 'Play the demo' : 'Replay the order from the oven');
    ui.play = mode;
  }
}

// ---------------------------------------------------------------- the loop
let last = performance.now(), snapNext = true, raf = 0;
function frame(now) {
  if (later) { const f = later; later = null; f(); }
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (S.playing) {
    S.t = Math.min(T.end, S.t + dt * S.speed / 60);
    if (S.t >= T.end) S.playing = false;
  }
  let snap = snapNext; snapNext = false;
  if (pendingReplay) { scene.update(S.t, 0, true); scene.replay(pendingReplay, S.t); pendingReplay = null; snap = false; }
  const r = scene.update(S.t, dt, snap, scrubbing);
  scene.camera(r.focus, dt, snap);
  scene.render?.();
  scene.frameTime?.(dt * 1000);
  sync();
  raf = requestAnimationFrame(frame);
}

function setT(t, { snap = true, keepPlaying = true } = {}) {
  S.t = Math.min(T.end, Math.max(0, t));
  if (!keepPlaying) S.playing = false;
  if (S.t >= T.end) S.playing = false;
  snapNext = snap;
}

// ---------------------------------------------------------------- controls
el.play.addEventListener('click', () => {
  if (S.t >= T.end - 1e-6) { setT(0); S.playing = true; announce('Replaying the order from the oven.'); }
  else S.playing = !S.playing;
  sync();
});
el.scrub.addEventListener('input', () => { setT(+el.scrub.value); });
el.scrub.addEventListener('pointerdown', () => { scrubbing = true; });
for (const ev of ['pointerup', 'pointercancel', 'change', 'blur']) el.scrub.addEventListener(ev, () => { if (scrubbing) { scrubbing = false; snapNext = true; } });
$$('input[name=speed]').forEach((r) => {
  r.checked = +r.value === S.speed;
  r.addEventListener('change', () => { S.speed = +r.value; store.set('speed', String(S.speed)); });
});
el.tiles.addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]'); if (!b) return;
  const r = sceneEl.getBoundingClientRect();            // read layout before anything changes (no forced reflow)
  goto(b.dataset.goto);
  if (r.top < 56 || r.bottom > innerHeight) $('#tracker').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
});
// a stage jump is applied in the next animation frame (one snap, then the entry transition replays from its start)
let pendingReplay = null;
function goto(id) {
  setT(stageT(id));
  pendingReplay = { boxed: 'boxing', delivered: 'arrive' }[id] || null;
  if (id !== 'delivered' && !reduced) S.playing = true;
}

// primary (phone) + courier actions
el.primary.addEventListener('click', () => { if (el.primary.dataset.act === 'rate') openRate(); else openMsg(el.primary); });
$('[data-action=message]').addEventListener('click', (e) => openMsg(e.currentTarget));

const msgDlg = $('#msg-dialog'), trackDlg = $('#track-dialog'), rateDlg = $('#rate-dialog'), scrim = $('[data-scrim]');
// Sheets open non-modally (show) with aria-modal, a scrim and a focus trap. showModal() would make the whole
// 2.5k-node page inert, a ~10-20 ms style recalc on a throttled phone: a dropped frame on every open and close.
let returnFocus = null, current = null, warming = false;
const focusables = (d) => [...d.querySelectorAll('button, input:not([type=radio]), input[type=radio]:checked, textarea, a[href]')].filter((e) => !e.disabled && e.offsetParent);
function open(dlg, from) {
  returnFocus = from || document.activeElement; current = dlg;
  dlg.returnValue = ''; dlg.show(); scrim.hidden = false;
  (dlg.querySelector('[autofocus]') || focusables(dlg)[0])?.focus();
}
[msgDlg, trackDlg, rateDlg].forEach((d) => {
  d.addEventListener('close', () => { if (warming) return; current = null; scrim.hidden = true; if (returnFocus && document.contains(returnFocus)) returnFocus.focus(); });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.close('cancel'); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(d), first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
});
scrim.addEventListener('click', () => current?.close('cancel'));
// focus that escapes an open sheet (e.g. a click on the page through a gap) is pulled back in
document.addEventListener('focusin', (e) => { if (current && !current.contains(e.target)) (focusables(current)[0])?.focus(); });
// warm-up: lay each sheet out once while idle, so the first real open is cheap
(window.requestIdleCallback || ((f) => setTimeout(f, 600)))(() => {
  warming = true;
  for (const d of [msgDlg, trackDlg, rateDlg]) { d.classList.add('is-warm'); d.show(); void d.offsetHeight; d.close(); d.classList.remove('is-warm'); }
  warming = false;
});
function openMsg(from) { msgDlg.querySelector('textarea').value = ''; open(msgDlg, from); }
msgDlg.addEventListener('close', () => {
  if (msgDlg.returnValue !== 'send') return;
  const f = $('[data-msg-form]'); const note = f.note.value.trim(); const text = note || f.quick.value;
  (S.notes ||= []).push({ at: clock(S.t), text });
  renderEvents();
  const c = S.order.courier.first;
  toast(`Sent to ${c}: “${text}”`); announce(`Message sent to ${c}.`);
});
function openRate() { open(rateDlg, el.primary); }
rateDlg.addEventListener('close', () => {
  if (rateDlg.returnValue !== 'rate') return;
  S.rated = +$('[data-rate-form]').stars.value;
  renderStage(stageIndex(S.t), true); renderSecondary(stageIndex(S.t)); later = null;
  toast(`Thanks! You rated this order ${S.rated} out of 5.`); announce(`Thanks, you rated this order ${S.rated} out of 5.`);
});

// track another order
$$('[data-action=track-another]').forEach((b) => b.addEventListener('click', (e) => {
  const f = $('[data-track-form]'); f.no.value = ''; setErr(''); open(trackDlg, e.currentTarget); f.no.focus();
}));
trackDlg.querySelector('[data-close]').addEventListener('click', () => trackDlg.close('cancel'));
function setErr(msg) { const e = $('#track-err'), i = $('#track-no'); e.textContent = msg; e.hidden = !msg; i.setAttribute('aria-invalid', String(!!msg)); }
$('[data-track-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = e.currentTarget.no.value.trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) { setErr('Enter your order number, like PT-48257.'); e.currentTarget.no.focus(); return; }
  const m = raw.match(/^(?:PT)?-?(\d{5})$/);
  if (!m) { setErr('Order numbers look like PT-48257: “PT-” and five digits.'); e.currentTarget.no.focus(); return; }
  const no = 'PT-' + m[1], o = ORDERS[no];
  if (!o) { setErr(`We couldn't find ${no}. Check the number in your confirmation email.`); e.currentTarget.no.focus(); return; }
  S.order = o; S.rated = 0; setT(o.t0); anchorClock(); renderOrder();
  if (!reduced && o.t0 < T.end) S.playing = true;
  returnFocus = $('#tracker');
  trackDlg.close('ok');
  sync('quiet');
  const st = STAGES[stageIndex(S.t)].label;
  announce(`Now tracking order ${no}: ${st}.`); toast(`Now tracking #${no}`);
});

// reorder + cart popover
let cart = 0;
const cartBtn = $('.nav-cart'), cartPop = $('#cart-pop');
$$('[data-action=reorder]').forEach((b) => b.addEventListener('click', () => {
  const n = S.order.items.reduce((s, it) => s + +it[0], 0);
  cart += n;
  const badge = $('.cart-n'); badge.hidden = false; badge.textContent = cart;
  cartBtn.setAttribute('aria-label', `Cart, ${cart} items`);
  $('.cart-empty').textContent = `${cart} items in your cart, the same as your last order. Demo: nothing is charged.`;
  toast(`Added ${n} items to your cart (demo)`); announce(`Added ${n} items to your cart.`);
  if (!cartPop.hidden) closeCart();
}));
function closeCart() { cartPop.hidden = true; cartBtn.setAttribute('aria-expanded', 'false'); }
cartBtn.addEventListener('click', () => { const openIt = cartPop.hidden; cartPop.hidden = !openIt; cartBtn.setAttribute('aria-expanded', String(openIt)); if (openIt) cartPop.querySelector('button').focus(); });

// phone menu
const menuBtn = $('.nav-menu'), menu = $('#mnav');
function setMenu(on) { menu.classList.toggle('is-open', on); menuBtn.setAttribute('aria-expanded', String(on)); menuBtn.setAttribute('aria-label', on ? 'Close menu' : 'Open menu'); }
menuBtn.addEventListener('click', () => { const on = !menu.classList.contains('is-open'); setMenu(on); if (on) menu.querySelector('a').focus(); });
menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menu.classList.contains('is-open')) { setMenu(false); menuBtn.focus(); }
  if (!cartPop.hidden) { closeCart(); cartBtn.focus(); }
});
document.addEventListener('pointerdown', (e) => {
  if (menu.classList.contains('is-open') && !e.target.closest('#mnav, .nav-menu')) setMenu(false);
  if (!cartPop.hidden && !e.target.closest('.cart-wrap')) closeCart();
});

// ---------------------------------------------------------------- time of day (3D scene): follows the visitor's clock unless they pick one
const todRadios = $$('input[name=tod]');
function todNow() { const d = new Date(); return (window.__todFor || (() => 'day'))(d.getHours() + d.getMinutes() / 60); }
function applyTod() {
  const pick = (todRadios.find((r) => r.checked) || {}).value || 'auto';
  const name = pick === 'auto' ? todNow() : pick;
  if (hero.dataset.tod !== name) { scene.setTimeOfDay?.(name); hero.dataset.tod = name; }
}
{ const saved = params.get('tod') || store.get('tod'); const r = todRadios.find((x) => x.value === saved); if (r) r.checked = true; }
todRadios.forEach((r) => r.addEventListener('change', () => { store.set('tod', r.value); applyTod(); announce(r.value === 'auto' ? `Scene follows your clock: ${hero.dataset.tod === 'golden' ? 'golden hour' : hero.dataset.tod}.` : `Scene set to ${r.value === 'golden' ? 'golden hour' : r.value}.`); }));
if (sceneKind !== '3d') $('.tod')?.remove();
applyTod(); setInterval(applyTod, 60000);

// ---------------------------------------------------------------- phone: the panel is a bottom sheet (demo bar moves into it)
const grab = $('.sheet-grab'), demoHome = demoEl.parentElement, demoNext = demoEl.nextSibling;
function placeDemo() {
  const phone = phoneMQ.matches;
  if (phone && demoEl.parentElement !== panel) panel.insertBefore(demoEl, $('.panel-more'));
  if (!phone && demoEl.parentElement !== demoHome) demoHome.insertBefore(demoEl, demoNext);
  if (!phone) setSheet(false);
  requestAnimationFrame(() => { hero.style.setProperty('--sheet-h', phone ? panel.getBoundingClientRect().height + 'px' : '0px'); scene.resize?.(); });
}
function setSheet(open) {
  panel.classList.toggle('is-open', open); grab.setAttribute('aria-expanded', String(open));
  grab.querySelector('.grab-l').textContent = open ? 'Hide details' : 'Order details';
}
grab.addEventListener('click', () => setSheet(!panel.classList.contains('is-open')));
phoneMQ.addEventListener('change', placeDemo);
placeDemo();

// ---------------------------------------------------------------- start
renderOrder();
sync('quiet'); later?.(); later = null;
requestAnimationFrame((n) => { last = n; frame(n); });
const ready = document.fonts ? document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))) : Promise.resolve();

window.__dv49 = {
  ready,
  state: () => ({ scene: sceneKind, tod: hero.dataset.tod, sheet: panel.classList.contains('is-open'), t: +S.t.toFixed(3), stage: STAGES[stageIndex(S.t)].id, playing: S.playing, speed: S.speed, order: S.order.no, eta: el.etaV.textContent, reduced, notes: (S.notes || []).length, rated: S.rated, cam: scene.vis }),
  set: (t, o = {}) => { setT(t, o); if (o.paused) S.playing = false; },
  play: () => { S.playing = true; }, pause: () => { S.playing = false; },
  goto,
  probe: () => scene.probe?.(),
  stop: () => cancelAnimationFrame(raf),
};
