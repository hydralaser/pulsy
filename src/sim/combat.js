import { TUNING, WEAPONS, SHIELDS, ARMOUR, HELMETS, WOUND_LOCATIONS, pickWeighted } from './rules.js';
import { isFormed, isGone, isRunning, dist, clamp, fwdOf, rightOf, shiftNerve, logEvent } from './core.js';
import { slotWorld, occupant, vacateSlot, placeInSlot, rearSlot, handleLeaderLoss } from './unit.js';

// Centre-to-centre distance at which a man can land a blow.
export function reachOf(s) {
  return WEAPONS[s.weapon].reach + TUNING.bodyRadius * 2;
}

// Who is actually striking at whom this step: men with a target inside their reach.
export function computeAttackers(world) {
  const map = {};
  for (const s of world.soldiers) {
    if (s.target < 0) continue;
    if (s.state !== 'fighting' && s.state !== 'surging' && s.state !== 'pursuing') continue;
    const t = world.soldiers[s.target];
    if (isGone(t) || dist(s.pos, t.pos) > reachOf(s) + 0.4) continue;
    (map[t.id] ||= []).push(s.id);
  }
  world.attackers = map;
}

export function attackersOf(world, s) {
  return world.attackers[s.id] || [];
}

// Attackers who chose to come at him, as opposed to men only defending themselves.
export function threatsTo(world, s) {
  return attackersOf(world, s).filter((id) => {
    const o = world.soldiers[id];
    return o.aggressor || o.state === 'pursuing';
  });
}

function addAttacker(world, s, targetId) {
  if (targetId < 0) return;
  const list = (world.attackers[targetId] ||= []);
  if (!list.includes(s.id)) list.push(s.id);
}

// Friends on both sides mean only two enemies can reach a man; an open side lets more in.
export function maxAttackersOn(world, t) {
  if (!t.slot) return 4;
  const u = world.units[t.unit];
  let n = 0;
  for (const df of [-1, 1]) {
    const nb = occupant(world, u, t.slot.f + df, t.slot.r);
    if (nb && isFormed(nb)) n++;
  }
  // In a disordered line the gaps between shields let an extra man in.
  if (u.contingents[t.contingent].cohesion < 0.6) n = Math.max(0, n - 1);
  return n === 2 ? 2 : n === 1 ? 3 : 5;
}

export function chooseTarget(world, s, range) {
  const u = world.units[s.unit];
  const fw = fwdOf(u.heading);
  const home = s.slot ? slotWorld(u, s.slot.f, s.slot.r) : s.pos;
  let best = -1;
  let bestScore = Infinity;
  for (const { o, d } of s.enemies) {
    if (d > range || isGone(o)) continue;
    const ax = o.pos.x - home.x;
    const ay = o.pos.y - home.y;
    if (ax * fw.x + ay * fw.y < -0.5) continue;
    const others = attackersOf(world, o).filter((id) => id !== s.id).length;
    if (others >= maxAttackersOn(world, o)) continue;
    const lateral = Math.abs(ax * -fw.y + ay * fw.x);
    const score = d + lateral * 0.8 - (o.state === 'wavering' ? 0.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  addAttacker(world, s, best);
  return best;
}

export function closestOf(world, s, ids) {
  let best = -1;
  let bestD = Infinity;
  for (const id of ids) {
    const d = dist(s.pos, world.soldiers[id].pos);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

// How much of a blow from `from` the shield can cover: the aspis guards the front and left.
function shieldCover(def, from) {
  const dx = from.x - def.pos.x;
  const dy = from.y - def.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const f = fwdOf(def.facing);
  const r = rightOf(def.facing);
  const ahead = (dx * f.x + dy * f.y) / len;
  const right = (dx * r.x + dy * r.y) / len;
  if (ahead > 0.5) return 1;
  if (right < 0) return ahead > -0.3 ? 0.75 : 0.2;
  return ahead > -0.3 ? 0.35 : 0;
}

export function resolveBlow(world, att, def, support, bonus = 1) {
  const T = TUNING;
  const rng = world.rng;
  att.lastAttackT = world.t;
  world.units[att.unit].sinceBlow = 0;
  world.units[def.unit].sinceBlow = 0;
  world.blows++;

  const running = isRunning(def);
  const nAtt = attackersOf(world, def).length;
  let p = T.hitBase * (0.5 + att.skill * att.skillMul) / (0.5 + def.skill * def.skillMul) * (0.35 + 0.65 * att.stamina);
  if (nAtt > 1) p *= 1 + T.extraAttacker * (nAtt - 1);
  if (running) p *= 1.8;
  else if (def.state === 'wavering') p *= 1.3;
  if (support) p *= 0.7;
  // A man stepping back behind his shield is harder to reach.
  if (def.state === 'yielding') p *= 0.8;
  p *= bonus;
  if (!rng.chance(Math.min(0.95, p))) return;

  const block = SHIELDS[def.shield].block * def.shieldMul * shieldCover(def, att.pos) * (0.4 + 0.6 * def.stamina) * (0.7 + 0.3 * world.units[def.unit].contingents[def.contingent].cohesion) * (running ? 0.2 : 1)
    * (def.state === 'yielding' ? 1.25 : 1) * (def.pinnedT > 1 ? 0.8 : 1);
  if (rng.chance(block)) {
    def.record.blocks++;
    def.stamina = Math.max(0, def.stamina - 0.015);
    def.resolve -= 0.04;
    shove(world, att, def, T.giveOnBlock);
    return;
  }

  const loc = pickWeighted(rng, WOUND_LOCATIONS.map((w) => [w, w[1]]));
  const protection = loc[2] === 'helmet' ? HELMETS[def.helmet].head : loc[2] === 'armour' ? ARMOUR[def.armour].torso : 0;
  const severity = WEAPONS[att.weapon].damage * rng.range(0.25, 1.2) * (1 - protection * rng.range(0.6, 1));
  def.health -= severity;
  def.lastHitT = world.t;
  def.resolve -= 0.25;
  att.resolve += 0.1;
  shove(world, att, def, T.giveOnWound);
  if (def.health <= 0) killSoldier(world, def, att, loc[0]);
  else woundSoldier(world, def, att, loc[0], severity);
}

function woundSoldier(world, def, att, where, severity) {
  const u = world.units[def.unit];
  def.wounds.push({ where, severity, by: att.name, t: world.t });
  def.record.woundsTaken++;
  att.record.woundsGiven++;
  u.stats.wounds++;
  if (where === 'head') shiftNerve(world, def, -0.1, 'wounds');
  if (where === 'torso') def.staminaCap = Math.max(0.4, def.staminaCap - 0.15);
  if (where === 'spear arm') def.skillMul *= 0.7;
  if (where === 'shield arm') def.shieldMul *= 0.6;
  if (where === 'leg') def.speedMul *= 0.65;
  shiftNerve(world, def, -(0.1 + severity * 0.2) * (1 - 0.4 * def.courage), 'wounds');
  for (const { o, d } of def.friends) {
    if (d < 2 && isFormed(o)) shiftNerve(world, o, -0.015, 'casualties');
  }
  // A badly hurt man in the front rank drops back through the ranks.
  if (def.health < 0.4 && def.slot && def.slot.r === 0 && isFormed(def)) {
    const back = rearSlot(u, def.contingent);
    if (back) {
      vacateSlot(u, def);
      placeInSlot(u, def, back.f, back.r);
      def.state = 'returning';
      def.stateT = 0;
      def.target = -1;
      def.aggressor = false;
      if (def.veteran) logEvent(world, 'wound', `${def.name} is badly wounded and drops back.`, { unit: u.id, who: def.id });
    }
  }
}

export function killSoldier(world, def, att, where) {
  const u = world.units[def.unit];
  const wasRunning = isRunning(def);
  vacateSlot(u, def);
  def.state = 'dead';
  def.stateT = 0;
  def.target = -1;
  def.health = 0;
  def.diedAt = world.t;
  def.deathPhase = wasRunning ? 'pursuit' : 'fight';
  def.killedBy = att ? att.id : -1;
  if (wasRunning) u.stats.killedPursuit++;
  else u.stats.killed++;
  if (att) {
    att.record.kills++;
    att.resolve += 0.2;
    const au = world.units[att.unit];
    au.momentum = clamp(au.momentum + 0.15, -1, 1);
    u.momentum = clamp(u.momentum - 0.15, -1, 1);
    att.reputation = Math.min(1, att.reputation + 0.04);
    shiftNerve(world, att, 0.06);
  }
  if (!wasRunning) {
    for (const { o, d } of def.friends) {
      if (!isFormed(o)) continue;
      if (d < 3.5) shiftNerve(world, o, -0.09 * (1 - 0.4 * o.courage), 'casualties');
      else if (d < 9) shiftNerve(world, o, -0.02, 'casualties');
    }
    for (const { o, d } of def.enemies) {
      if (d < 4 && isFormed(o)) shiftNerve(world, o, 0.04);
    }
  }
  world.marks.push({ t: world.t, x: def.pos.x, y: def.pos.y, kind: 'death' });
  const by = att ? ` by ${att.name}` : '';
  const text = wasRunning
    ? `${def.name} of ${def.origin} is cut down while running${by}.`
    : `${def.name} of ${def.origin} is killed${by}` + (where ? ` (${where})` : '') + '.';
  logEvent(world, 'death', text, { unit: u.id, who: def.id });
  handleLeaderLoss(world, u, def, 'fell');
}

// A man taking blows gives ground a step at a time; the man pressing him takes it.
// The ranks behind have to move to make room, so this ripples back through the file.
function shove(world, att, def, amount) {
  if (def.slot && def.slot.r === 0 && !def.aggressor) {
    const u = world.units[def.unit];
    u.give[def.slot.f] = clamp(u.give[def.slot.f] + amount, -0.3, 1.6);
  }
  if (att.slot && att.slot.r === 0 && att.aggressor) {
    const u = world.units[att.unit];
    u.give[att.slot.f] = clamp(u.give[att.slot.f] - amount * 0.5, -0.3, 1.6);
  }
}

// Every blow that lands this step, including spears reaching past the front rank.
export function runBlows(world, dt, order = world.soldiers) {
  const rng = world.rng;
  for (const s of order) {
    if (s.target < 0) continue;
    if (s.state !== 'fighting' && s.state !== 'pursuing' && s.state !== 'wavering' && s.state !== 'yielding') continue;
    const t = world.soldiers[s.target];
    if (isGone(t)) {
      s.target = -1;
      continue;
    }
    if (dist(s.pos, t.pos) > reachOf(s) + 0.15) continue;
    s.attackT -= dt * (s.state === 'wavering' ? 0.5 : s.state === 'yielding' ? 0.3 : 1);
    if (s.attackT <= 0) {
      resolveBlow(world, s, t, false);
      s.attackT = WEAPONS[s.weapon].interval * rng.range(0.7, 1.3) / (0.5 + 0.5 * s.stamina);
    }
  }
  for (const u of world.units) {
    for (let f = 0; f < u.files; f++) {
      const front = occupant(world, u, f, 0);
      const second = occupant(world, u, f, 1);
      if (!front || !second || front.state !== 'fighting' || front.target < 0) continue;
      if (second.state !== 'inRank' || !WEAPONS[second.weapon].secondRank) continue;
      const t = world.soldiers[front.target];
      if (isGone(t) || dist(second.pos, t.pos) > reachOf(second) + 0.8) continue;
      second.supportT -= dt;
      if (second.supportT <= 0) {
        resolveBlow(world, second, t, true);
        second.supportT = WEAPONS[second.weapon].interval * 1.5 * rng.range(0.7, 1.3);
      }
    }
  }
}
