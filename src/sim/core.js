// Shared helpers used by every simulation module.

// States where a man is part of his formation, as opposed to running, chasing or dead.
export const FORMED = new Set(['inRank', 'surging', 'fighting', 'yielding', 'recoiling', 'wavering', 'returning']);

export function isFormed(s) {
  return FORMED.has(s.state);
}

export function isGone(s) {
  return s.state === 'dead' || s.state === 'escaped';
}

export function isRunning(s) {
  return s.state === 'fleeing' || s.state === 'rallying';
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
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
  return s.kind === 'light' ? world.lights[s.side] : world.units[s.unit];
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
