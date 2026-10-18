import { TUNING } from './rules.js';
import { isFormed, fwdOf, clamp, dist } from './core.js';
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
  // The men behind, if they are pressing, push him on.
  const pressure = pressureBehind(world, u, s);
  rate += T.pressPush * pressure;
  const c = u.contingents[s.contingent];
  if (c.surgeCallT > 0) rate += T.resolveCall;
  if (opening) rate += T.resolveOpening * opening.value * (0.5 + s.courage);
  if (s.nerve < T.nerveSteady) rate *= 0.3;
  // Stepping back is catching too: when the men beside him pull back, his own nerve for it fades.
  rate -= 0.25 * backing;
  // After a fight a man needs to catch his breath before he can work himself up again.
  if (s.breathT > 0) rate *= 0.15;
  let reason = 'worked up';
  if (opening && opening.value > 0.25) reason = opening.kind;
  else if (pull > 0.9) reason = 'follow';
  else if (pressure > 1) reason = 'pushed';
  else if (c.surgeCallT > 0) reason = 'called';
  // Stepping into the gap alone is terrifying. A man waits for the men beside him unless
  // he is following someone, has been called forward, or is brave enough for the opening he sees.
  const bold = opening && opening.value * (0.5 + s.courage) > 0.6;
  const winded = s.breathT > 0;
  const ready = !winded ? shouting > 0.7 || pull > 0.9 || pressure > 1 || c.surgeCallT > 0 || near === 0 || bold : bold && opening.kind === 'turned';
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

// How hard the ranks behind a front-rank man are pressing him on: their eagerness, less
// whatever of the call to step back they have taken in.
export function pressureBehind(world, u, s) {
  let p = 0;
  for (let r = 1; r <= 2; r++) {
    const b = occupant(world, u, s.slot.f, r);
    if (b && isFormed(b)) p += b.resolve * (1 - b.halt) / r;
  }
  return p;
}

// Veterans pass the word along and are listened to; so is the leader.
export function discipline(world, s) {
  const u = world.units[s.unit];
  let d = s.veteran ? 0.6 : 0;
  for (const { o, d: dd } of s.friends) {
    if (dd > 2.5 || !isFormed(o)) continue;
    if (o.veteran) d = Math.max(d, 0.4 + 0.5 * o.reputation);
    if (o.id === u.leaderId || o.id === u.contingents[s.contingent].leaderId) d = Math.max(d, 0.5 + 0.5 * o.reputation);
  }
  return Math.min(1, d);
}

// A man waiting behind the front rank: fresh, listening to the fight, he works himself up to
// get into it, unless the word to step back has reached him and he heeds it.
export function stepRearMan(world, s, dt) {
  const T = TUNING;
  const u = world.units[s.unit];
  const c = u.contingents[s.contingent];
  if (c.inContact && c.mode === 'formed' && !c.charging && s.breathT <= 0) {
    let rate = T.eagerRate * (0.4 + s.courage) * (0.4 + s.nerve) * (0.3 + s.stamina);
    if (c.surgeCallT > 0) rate += T.resolveCall * 0.5;
    rate += 0.03 * Math.max(0, u.momentum);
    // Told to wait, a man who heeds it stops working himself up.
    s.resolve += rate * (1 - s.halt * (0.4 + 0.6 * s.discipline)) * dt;
  }
  if (s.breathT > 0) s.breathT -= dt;
  s.resolve -= s.halt * T.haltListen * (0.3 + 0.7 * s.discipline) * dt;
  if (s.nerve < T.nerveSteady) s.resolve -= 0.05 * dt;
  s.resolve = clamp(s.resolve, 0, 1);
}

// The word to step back starts with spent men at the front and with the leader's shout, and is
// passed back rank by rank. Each man takes a moment to hear it; veterans pass it on whole,
// raw men only partly. A call forward drowns it out. Each contingent's leader shouts to his own men.
export function passTheWord(world, u, dt) {
  const T = TUNING;
  const k = Math.min(1, dt / 0.6);
  for (let f = 0; f < u.files; f++) {
    let carried = 0;
    const c = u.contingents[u.fileOwner[f]];
    const leader = c.leaderId >= 0 ? world.soldiers[c.leaderId] : null;
    const voice = c.haltCallT > 0 && leader && isFormed(leader) ? leader : null;
    const shout = voice ? 0.5 + 0.5 * voice.reputation : 0;
    for (let r = 0; r < u.ranks; r++) {
      const s = occupant(world, u, f, r);
      if (!s || !isFormed(s)) continue;
      s.discipline = discipline(world, s);
      let heard = r === 0 ? (s.wantsOut ? 1 : 0) : carried;
      if (shout) heard = Math.max(heard, shout * (dist(s.pos, voice.pos) < 6 ? 1 : 0.6));
      if (c.surgeCallT > 0 || !c.inContact) heard = 0;
      s.halt += (heard - s.halt) * k;
      carried = s.halt * (T.haltRelay + (1 - T.haltRelay) * s.discipline);
    }
  }
}
