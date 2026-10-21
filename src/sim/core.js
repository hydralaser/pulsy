import { BODY, TUNING } from './rules.js';

// Shared helpers used by every simulation module.

// States where a man is part of his formation, as opposed to running, chasing or dead.
export const FORMED = new Set(['inRank', 'surging', 'fighting', 'yielding', 'recoiling', 'wavering', 'returning']);

export function isFormed(s) {
  return FORMED.has(s.state);
}

// Out of the battle: dead, down on the ground, or off the field.
export function isGone(s) {
  return s.state === 'dead' || s.state === 'down' || s.state === 'escaped';
}

// Lying on the field, dead or alive.
export function isFallen(s) {
  return s.state === 'dead' || s.state === 'down';
}

export function isRunning(s) {
  return s.state === 'fleeing' || s.state === 'rallying';
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Off the field: far out from where the fighting is, wherever it has moved to. A man running away
// is gone once he is this far from the middle of the two lines, not when he crosses a fixed line
// on the ground the battle may since have pushed past.
export function offTheField(world, p) {
  const [a, b] = world.units;
  const cx = (a.anchor.x + b.anchor.x) / 2;
  const cy = (a.anchor.y + b.anchor.y) / 2;
  return Math.abs(p.x - cx) > TUNING.fieldHalfW || Math.abs(p.y - cy) > TUNING.fieldHalfH;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function fwdOf(heading) {
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

export function rightOf(heading) {
  return { x: -Math.sin(heading), y: Math.cos(heading) };
}

export function angleWrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function logEvent(world, kind, text, extra) {
  world.events.push({ t: world.t, kind, text, ...extra });
}

// The body a man belongs to: his side's phalanx, or its light troops.
export function bodyOf(world, s) {
  if (s.kind === 'light') return world.lights[s.side];
  if (s.kind === 'horse') return world.horse[s.wing];
  return world.units[s.unit];
}

// Every change to a man's nerve goes through here, so each unit keeps a tally of
// what frightened it. That tally explains the result at the end of the battle.
export function shiftNerve(world, s, delta, cause) {
  const before = s.nerve;
  s.nerve = clamp(s.nerve + delta, 0, s.nerveCap);
  const lost = before - s.nerve;
  if (lost > 0 && cause) {
    const causes = bodyOf(world, s).causes;
    causes[cause] = (causes[cause] || 0) + lost;
  }
}

// How fast a man tires, and gets his breath back, for his endurance (see BODY in rules.js).
export function windOf(s) {
  return clamp(1 - BODY.wind * ((s.endurance ?? BODY.endurance) - BODY.endurance), 0.3, 2);
}

export function recoveryOf(s) {
  return clamp(1 + BODY.recover * ((s.endurance ?? BODY.endurance) - BODY.endurance), 0.3, 2);
}

// How hard his blows land, and how heavy his kit is on him, for his strength.
export function powerOf(s) {
  return 1 + BODY.power * ((s.strength ?? BODY.strength) - BODY.strength);
}

export function burdenOf(s) {
  return clamp(1 + BODY.burden * (BODY.strength - (s.strength ?? BODY.strength)), 0.5, 2);
}

// How far one man's weight drives another back.
export function heftOf(att, def) {
  return (BODY.shove + (att.strength ?? BODY.strength)) / (BODY.shove + (def.strength ?? BODY.strength));
}
