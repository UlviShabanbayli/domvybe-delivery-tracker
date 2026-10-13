// The order's timeline in order-minutes. Scene and UI derive everything from one number, t.
export const T = { boxAt: 9, rideAt: 11, doneAt: 31, end: 31 };
export const SHOWCASE_T = 19;            // mid-route, 12 min to go

export const STAGES = [
  { id: 'baking', label: 'Baking', short: 'Baking', from: 0, tile: 'the oven glows' },
  { id: 'boxed', label: 'Boxing', short: 'Boxed', from: T.boxAt, tile: 'the lid folds shut' },
  { id: 'onway', label: 'On the way', short: 'On the way', from: T.rideAt, tile: 'scooter rides the map' },
  { id: 'delivered', label: 'Delivered', short: 'Delivered', from: T.doneAt, tile: 'door opens, confetti' },
];

export function stageIndex(t) { let i = 0; for (let k = 0; k < STAGES.length; k++) if (t >= STAGES[k].from - 1e-9) i = k; return i; }

/** 0..1 share of the ride done (linear in distance, with a short pull-away and roll-in) */
export function rideShare(t) {
  const x = Math.min(1, Math.max(0, (t - T.rideAt) / (T.doneAt - T.rideAt)));
  const a = 0.03;                                  // ease the first and last 3%
  if (x < a) return (x * x) / (2 * a) / (1 - a);
  if (x > 1 - a) { const y = 1 - x; return 1 - (y * y) / (2 * a) / (1 - a); }
  return (x - a / 2) / (1 - a);
}

/** progress along the four-knob tracker: knobs sit at 0, 1/3, 2/3, 1 */
export function trackShare(t) {
  const i = stageIndex(t);
  if (i >= 3) return 1;
  const s = STAGES[i], n = STAGES[i + 1];
  return (i + (t - s.from) / (n.from - s.from)) / 3;
}

export const minutesLeft = (t) => Math.max(0, T.doneAt - t);
