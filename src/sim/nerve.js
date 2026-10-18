import { TUNING } from './rules.js';
import { isFormed, fwdOf, clamp, shiftNerve } from './core.js';
import { occupant, fileCloser, frontDistance } from './unit.js';
import { attackersOf } from './combat.js';

// Continuous fear and steadiness for a man in formation, applied every step.
export function updateNerve(world, s, dt) {
  const u = world.units[s.unit];
  const fw = fwdOf(u.heading);

  let aura = 0;
  let fleeingNear = 0;
  let waveringNear = 0;
  for (const { o, d } of s.friends) {
    if (isFormed(o) && d < 2.6) aura = Math.max(aura, o.reputation);
    if (o.id === u.leaderId && d < 4) aura += 0.15;
    // A man's own townsmen or tribesmen running is worse than strangers from further down the line.
    if (o.state === 'fleeing' && d < 7) fleeingNear += o.contingent === s.contingent ? 1 : 0.5;
    if (o.state === 'wavering' && d < 2.2) waveringNear++;
  }
  aura = Math.min(1, aura);

  let enemyClose = false;
  let enemyBehind = false;
  for (const { o, d } of s.enemies) {
    if (o.state === 'dead' || o.state === 'fleeing' || o.state === 'rallying') continue;
    if (d < 6) enemyClose = true;
    if (d < 4 && (o.pos.x - s.pos.x) * fw.x + (o.pos.y - s.pos.y) * fw.y < -0.3) enemyBehind = true;
  }

  let menBehind = 0;
  let sideFriends = 0;
  let closer = null;
  if (s.slot) {
    for (let r = s.slot.r + 1; r < u.ranks; r++) if (occupant(world, u, s.slot.f, r)) menBehind++;
    for (const df of [-1, 1]) {
      const nb = occupant(world, u, s.slot.f + df, s.slot.r);
      if (nb && isFormed(nb)) sideFriends++;
    }
    closer = fileCloser(world, u, s.slot.f);
    if (closer === s) closer = null;
  }

  const nAtt = attackersOf(world, s).length;

  // Every moment in contact wears a man down a little for good: the battle's clock.
  if (u.inContact) {
    const strain = (s.slot && s.slot.r === 0 ? 0.004 : 0.0015) * (1.3 - s.courage) * dt;
    s.nerveCap = Math.max(0.15, s.nerveCap - strain);
    if (s.nerve > s.nerveCap) shiftNerve(world, s, s.nerveCap - s.nerve - 1e-9, 'fighting');
  }
  let lost = 0;
  for (const id of u.members) {
    const o = world.soldiers[id];
    if (o.state === 'dead' || o.state === 'fleeing' || o.state === 'escaped') lost++;
  }
  const lossShare = lost / u.members.length;
  const damp = (1 - 0.45 * aura) * (1 - 0.07 * Math.min(3, menBehind));
  const drain = (amount, cause) => {
    if (amount > 0) shiftNerve(world, s, -amount * damp * dt, cause);
  };

  // Watching the enemy come on. A walking line is unsettling; a charging one is frightening,
  // more so the more ordered it is and the more men it has. Running out to meet it, or
  // bracing behind shields, steadies men.
  const e = world.units[1 - u.id];
  let underCharge = false;
  if (world.contactT == null && world.impactAt == null && e.mode !== 'routed' && e.present > 0) {
    const d = frontDistance(u, e);
    if (d < TUNING.approachFear && d > 0) {
      const prox = 1 - d / TUNING.approachFear;
      const pace = e.charging ? 1 : e.order === 'advance' ? 0.2 : 0.05;
      const threat = pace * (0.5 + 0.5 * e.cohesion) * clamp(Math.pow(e.present / Math.max(1, u.present), 1.2), 0.5, 2.2);
      const own = u.charging ? 0.35 : u.bracing || u.order === 'hold' ? 0.7 : 1;
      underCharge = e.charging;
      drain(0.15 * prox * threat * own * (1.3 - s.courage), 'approach');
    }
  }

  drain(s.state === 'fighting' ? 0.012 * (1.3 - s.courage) : 0, 'fighting');
  const disorder = 1.5 - 0.5 * u.cohesion;
  drain(((nAtt > 1 ? 0.035 * (nAtt - 1) : 0) + (enemyClose ? (2 - sideFriends) * 0.01 : 0) + (enemyBehind ? 0.05 : 0)) * disorder, 'exposure');
  drain(0.03 * lossShare, 'casualties');
  drain(s.stamina < 0.35 ? 0.012 : 0, 'fatigue');
  // Giving ground is unsettling, much less so for a disciplined unit doing it on purpose.
  drain(u.inContact && (u.order === 'back' || u.order === 'withdraw') ? 0.012 * (u.yielding ? 0.6 * (1 - (s.discipline || 0)) : 1) : 0, 'ground');
  drain(Math.min(0.08, 0.02 * fleeingNear) + 0.006 * waveringNear, 'panic');

  const calm = s.state === 'inRank' || s.state === 'wavering' || s.state === 'recoiling' || s.state === 'returning' || s.state === 'yielding';
  if (calm && nAtt === 0) {
    let rec = 0.012 + 0.02 * aura + 0.005 * menBehind + 0.005 * sideFriends;
    if (closer && closer.nerve > 0.5) rec += 0.01 * (0.5 + closer.reputation);
    if (enemyClose) rec *= 0.6;
    if (underCharge) rec *= u.bracing ? 0.35 : 0.2;
    shiftNerve(world, s, rec * dt);
  }
}

// When a man's nerve gives out, a steady file-closer or a nearby leader may still hold him in place.
export function heldInPlace(world, s) {
  const u = world.units[s.unit];
  let p = 0;
  if (s.slot) {
    const closer = fileCloser(world, u, s.slot.f);
    if (closer && closer !== s && isFormed(closer) && closer.nerve > TUNING.nerveSteady) p += 0.3 + 0.4 * closer.reputation;
  }
  for (const { o, d } of s.friends) {
    if (o.id === u.leaderId && d < 3 && isFormed(o)) p += 0.2;
  }
  return world.rng.chance(Math.min(0.85, p));
}
