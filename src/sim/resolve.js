import { TUNING } from './rules.js';
import { isFormed, fwdOf } from './core.js';
import { occupant } from './unit.js';
import { reachOf, attackersOf, maxAttackersOn } from './combat.js';

// Resolve is a front-rank man's readiness to step into the gap. It builds during a lull,
// faster for brave, rested men next to veterans; it jumps when he sees an opening or the
// man beside him goes forward; and it burns away while he fights. When it is spent he
// steps back. Surges and lulls come out of this, not out of a timer.

const OPENINGS = {
  turned: 0.35, // an enemy right in front of him stepping back with his guard down
  wavering: 0.6,
  wounded: 0.45,
  gap: 0.4, // a hole in the enemy front rank
  exhausted: 0.3,
};

// What a front-rank man can see across the gap that invites an attack.
export function findOpening(world, s) {
  const u = world.units[s.unit];
  const e = world.units[1 - s.unit];
  const fw = fwdOf(u.heading);
  const range = TUNING.gap + reachOf(s) + 1;
  let best = null;
  for (const { o, d } of s.enemies) {
    if (d > range || !isFormed(o)) continue;
    if ((o.pos.x - s.pos.x) * fw.x + (o.pos.y - s.pos.y) * fw.y < 0.5) continue;
    if (attackersOf(world, o).length >= maxAttackersOn(world, o)) continue;
    let kind = null;
    if (o.state === 'recoiling' && o.stateT < 1.5 && d < reachOf(s) + 0.5) kind = 'turned';
    else if (o.state === 'wavering') kind = 'wavering';
    else if (o.health < 0.35) kind = 'wounded';
    else if (o.slot && o.slot.r === 0 && hasGapBeside(world, e, o)) kind = 'gap';
    else if (o.stamina < 0.3) kind = 'exhausted';
    if (!kind) continue;
    const value = OPENINGS[kind] * (1 - d / (range + 1));
    if (!best || value > best.value) best = { target: o.id, kind, value };
  }
  return best;
}

function hasGapBeside(world, e, o) {
  for (const df of [-1, 1]) {
    const f = o.slot.f + df;
    if (f >= 0 && f < e.files && !occupant(world, e, f, 0)) return true;
  }
  return false;
}

export function frontNeighboursEngaged(world, u, s) {
  let engaged = 0;
  let total = 0;
  for (const df of [-2, -1, 1, 2]) {
    const nb = occupant(world, u, s.slot.f + df, 0);
    if (!nb) continue;
    total++;
    if (nb.state === 'surging' || nb.state === 'fighting') engaged++;
  }
  return total ? engaged / total : 0;
}

// How fast a front-rank man's resolve is rising right now, and why.
export function resolveRate(world, s, opening) {
  const T = TUNING;
  const u = world.units[s.unit];
  let rate = T.resolveRate * (0.4 + s.courage) * (0.3 + s.nerve) * (0.3 + s.stamina);
  let pull = 0;
  let example = 0;
  let together = 0;
  let near = 0;
  let backing = 0;
  for (const df of [-2, -1, 1, 2]) {
    const nb = occupant(world, u, s.slot.f + df, 0);
    if (!nb) continue;
    near++;
    if (nb.state === 'inRank') together += nb.resolve;
    if (nb.state === 'recoiling') backing += 1 / Math.abs(df);
    if (nb.aggressor && (nb.state === 'surging' || nb.state === 'fighting')) pull += (0.5 + nb.reputation) / Math.abs(df);
    if (nb.veteran || nb.id === u.leaderId) example = Math.max(example, nb.reputation * (nb.id === u.leaderId ? 1.3 : 1) / Math.abs(df));
  }
  // Men shout each other up: resolve builds faster when the men beside you are working up too.
  const shouting = near ? together / near : 0;
  rate += T.resolveRate * (example + shouting) + T.resolvePull * pull;
  if (u.surgeCallT > 0) rate += T.resolveCall;
  if (opening) rate += T.resolveOpening * opening.value * (0.5 + s.courage);
  if (s.nerve < T.nerveSteady) rate *= 0.3;
  // Stepping back is catching too: when the men beside him pull back, his own nerve for it fades.
  rate -= 0.25 * backing;
  // After a fight a man needs to catch his breath before he can work himself up again.
  if (s.breathT > 0) rate *= 0.15;
  let reason = 'worked up';
  if (opening && opening.value > 0.25) reason = opening.kind;
  else if (pull > 0.9) reason = 'follow';
  else if (u.surgeCallT > 0) reason = 'called';
  // Stepping into the gap alone is terrifying. A man waits for the men beside him unless
  // he is following someone, has been called forward, or is brave enough for the opening he sees.
  const bold = opening && opening.value * (0.5 + s.courage) > 0.6;
  const winded = s.breathT > 0;
  const ready = !winded ? shouting > 0.7 || pull > 0.9 || u.surgeCallT > 0 || near === 0 || bold : bold && opening.kind === 'turned';
  return { rate, reason, ready };
}

// Fighting burns resolve: faster for the timid, the tired, and a man left out on his own.
export function spendResolve(world, s, dt) {
  const T = TUNING;
  const u = world.units[s.unit];
  const alone = s.slot && s.slot.r === 0 ? 1 - frontNeighboursEngaged(world, u, s) : 0;
  const spend = T.resolveSpend * (1.3 - s.courage) + T.resolveAlone * alone + (s.stamina < 0.4 ? 0.1 : 0);
  s.resolve -= spend * dt;
}
