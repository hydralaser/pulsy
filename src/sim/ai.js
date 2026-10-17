import { TUNING } from './rules.js';
import { isFormed, isRunning, dist, logEvent } from './core.js';
import { frontDistance } from './unit.js';

// Unit-level commands. The AI (your "second") and the player both go through these.

export function callSurge(world, u) {
  if (u.surgeCooldown > 0 || u.mode !== 'formed') return false;
  const leader = u.leaderId >= 0 ? world.soldiers[u.leaderId] : null;
  if (!leader || !isFormed(leader)) return false;
  u.surgeCallT = 3;
  u.surgeCooldown = u.ai ? 18 + world.rng.range(0, 8) : 10;
  leader.stamina = Math.max(0, leader.stamina - 0.1);
  logEvent(world, 'order', `${leader.name} calls the ${u.short} forward.`, { unit: u.id });
  return true;
}

export function beginWithdraw(world, u, reason) {
  if (u.mode !== 'formed') return;
  u.mode = 'withdrawing';
  u.order = 'withdraw';
  u.withdrawReason = reason;
  if (u.decisionT == null && u.inContact) u.decisionT = world.t;
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (s.state === 'surging' || s.state === 'fighting') recoil(s);
  }
  const why = reason === 'standoff' ? 'Neither side will close again. The ' + u.short + ' step back.' : `The ${u.short} give ground and withdraw in order.`;
  logEvent(world, 'withdraw', why, { unit: u.id });
}

export function cancelWithdraw(world, u) {
  if (u.mode !== 'withdrawing') return;
  u.mode = 'formed';
  u.withdrawReason = null;
  u.decisionT = null;
  logEvent(world, 'order', `The ${u.short} halt and face the enemy again.`, { unit: u.id });
}

export function rout(world, u) {
  if (u.mode === 'routed') return;
  u.mode = 'routed';
  u.order = 'hold';
  u.routT = world.t;
  if (u.decisionT == null) u.decisionT = world.t;
  logEvent(world, 'rout', `The ${u.adjective} line breaks!`, { unit: u.id });
}

export function startPursuit(world, u) {
  u.mode = 'pursuing';
  u.pursuitT = 0;
  u.pursued = true;
  let n = 0;
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (!isFormed(s) || !s.slot) continue;
    if (s.nerve < 0.4 || s.stamina < 0.35) continue;
    s.state = 'pursuing';
    s.stateT = 0;
    s.target = -1;
    n++;
  }
  logEvent(world, 'pursuit', `${n} of the ${u.short} run after the beaten enemy.`, { unit: u.id });
}

export function recallPursuit(world, u) {
  u.mode = 'formed';
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (s.state === 'pursuing') {
      s.state = s.slot ? 'returning' : 'rallying';
      s.stateT = 0;
      s.target = -1;
    }
  }
  logEvent(world, 'pursuit', `The ${u.short} are called back to their ranks.`, { unit: u.id });
}

export function recoil(s) {
  s.state = 'recoiling';
  s.stateT = 0;
  s.target = -1;
  s.aggressor = false;
}

function anyRunningNear(world, u, e, range) {
  for (const id of e.members) {
    const o = world.soldiers[id];
    if (isRunning(o) && dist(o.pos, u.anchor) < range) return true;
  }
  return false;
}

// The commander's decisions, made every half second. Used for every AI unit, and for
// the player's unit when your second has taken over.
export function decideUnit(world, u) {
  const T = TUNING;
  const e = world.units[1 - u.id];
  if (u.mode === 'routed') return;
  if (u.mode === 'pursuing') {
    if (u.pursuitT > T.pursuitTime || !anyRunningNear(world, u, e, 40)) recallPursuit(world, u);
    return;
  }
  if (e.mode === 'routed') {
    if (u.ai && !u.pursued && u.nerve > 0.45 && u.stamina > 0.4) startPursuit(world, u);
    else if (u.ai) u.order = 'hold';
    return;
  }
  if (!u.ai || world.result) return;
  if (u.mode === 'withdrawing') {
    u.order = 'withdraw';
    return;
  }
  const leader = u.leaderId >= 0 ? world.soldiers[u.leaderId] : null;
  const runningShare = u.running / Math.max(1, u.present + u.running);
  if (u.inContact && (u.nerve < T.withdrawNerve || runningShare > 0.15)) {
    beginWithdraw(world, u, 'nerve');
    return;
  }
  if (u.inContact && u.sinceBlow > T.standoffIdle && u.nerve < T.standoffNerve && e.nerve < T.standoffNerve + 0.1 && u.nerve <= e.nerve) {
    beginWithdraw(world, u, 'standoff');
    return;
  }
  if (e.mode === 'withdrawing') {
    u.followT += 0.5;
    u.order = u.followT < T.followTime && u.nerve > 0.6 && u.nerve > e.nerve + 0.15 && u.stamina > 0.45 ? 'advance' : 'hold';
    return;
  }
  u.order = frontDistance(u, e) > T.gap + 0.1 ? 'advance' : 'hold';
  if (u.inContact && u.nerve > e.nerve + 0.05 && u.stamina > 0.55 && leader && isFormed(leader)) callSurge(world, u);
}

// Orders from the player. Returns false when the order can't be given right now.
export function playerOrder(world, u, order) {
  const e = world.units[1 - u.id];
  if (u.mode === 'routed') return false;
  switch (order) {
    case 'advance':
    case 'hold':
    case 'back':
      if (u.mode === 'withdrawing') cancelWithdraw(world, u);
      if (u.mode === 'pursuing') return false;
      u.order = order;
      return true;
    case 'withdraw':
      beginWithdraw(world, u, 'ordered');
      return u.mode === 'withdrawing';
    case 'surge':
      return callSurge(world, u);
    case 'pursue':
      if (e.mode !== 'routed' || u.mode !== 'formed') return false;
      startPursuit(world, u);
      return true;
    case 'recall':
      if (u.mode !== 'pursuing') return false;
      recallPursuit(world, u);
      return true;
    default:
      return false;
  }
}
