import { TUNING } from './rules.js';
import { isFormed, isRunning, dist, logEvent } from './core.js';
import { nameOf, slotWorld } from './unit.js';

// Commands. Each contingent answers to its own leader, AI or player, and every order is his:
// he cannot give orders to the contingents beside him, and he hears what they are doing only
// when word has been passed along the line to him.

export function callSurge(world, u, c) {
  if (c.surgeCooldown > 0 || c.mode !== 'formed') return false;
  const leader = c.leaderId >= 0 ? world.soldiers[c.leaderId] : null;
  if (!leader || !isFormed(leader)) return false;
  c.surgeCallT = 3;
  c.surgeCooldown = c.ai ? 18 + world.rng.range(0, 8) : 10;
  leader.stamina = Math.max(0, leader.stamina - 0.1);
  logEvent(world, 'order', `${leader.name} calls the ${nameOf(u, c)} forward.`, { unit: u.id });
  return true;
}

// The front-rank men of a contingent's files.
function frontMen(world, u, c) {
  const men = [];
  for (let f = c.file0; f < c.file1; f++) {
    const s = world.soldiers[u.grid[0][f]];
    if (s && isFormed(s)) men.push(s);
  }
  return men;
}

// Share of a contingent's front rank that is out in the gap attacking.
function frontAggressors(world, u, c) {
  const men = frontMen(world, u, c);
  return men.length ? men.filter((s) => s.aggressor && (s.state === 'fighting' || s.state === 'surging')).length / men.length : 0;
}

// Share of a contingent's front rank that is spent and calling for a breather.
function frontSpent(world, u, c) {
  const men = frontMen(world, u, c);
  return men.length ? men.filter((s) => s.wantsOut || s.stamina < 0.45).length / men.length : 0;
}

function contingentDiscipline(world, c) {
  let sum = 0;
  let n = 0;
  for (const id of c.members) {
    const s = world.soldiers[id];
    if (!isFormed(s)) continue;
    sum += s.discipline || 0;
    n++;
  }
  return n ? sum / n : 0;
}

// The leader shouts his men back: "Enough! Step back!" How far it carries depends on who he
// is, and on the veterans in the ranks passing it on.
export function callHalt(world, u, c, quiet) {
  if ((c.haltCooldown > 0 && !quiet) || c.mode !== 'formed' || !c.inContact) return false;
  const leader = c.leaderId >= 0 ? world.soldiers[c.leaderId] : null;
  if (!leader || !isFormed(leader)) return false;
  c.haltCallT = 3;
  c.lastHaltT = world.t;
  c.haltCooldown = c.ai ? 25 : 6;
  c.surgeCallT = 0;
  const words = ['Enough! Step back!', 'Back! Give them room, catch your breath!', 'Ease off! Ease off!'];
  if (!quiet) logEvent(world, 'order', `${leader.name} shouts the ${nameOf(u, c)} back: "${words[world.rng.int(words.length)]}"`, { unit: u.id });
  return true;
}

export function beginWithdraw(world, u, c, reason) {
  if (c.mode !== 'formed') return;
  c.mode = 'withdrawing';
  c.order = 'withdraw';
  c.withdrawReason = reason;
  c.yielding = false;
  u.lastWithdraw = c.index;
  for (const id of c.members) {
    const s = world.soldiers[id];
    if (s.state === 'surging' || s.state === 'fighting') recoil(s);
  }
  const who = nameOf(u, c);
  let why = `The ${who} give ground and withdraw in order.`;
  if (reason === 'standoff') why = `Neither side will close again. The ${who} step back.`;
  else if (c.withdrawNote && c.withdrawNote.flank) why = `With word that the ${c.withdrawNote.flank} have gone, the ${who} fear for their flank and withdraw in order.`;
  logEvent(world, 'withdraw', why, { unit: u.id });
}

export function cancelWithdraw(world, u, c) {
  if (c.mode !== 'withdrawing') return;
  c.mode = 'formed';
  c.withdrawReason = null;
  logEvent(world, 'order', `The ${nameOf(u, c)} halt and face the enemy again.`, { unit: u.id });
}

// Break into a run for the last stretch. A counter-charge is the same order given in reply.
export function startCharge(world, u, c, counter, following) {
  const e = world.units[1 - u.id];
  const ec = c.facing >= 0 ? e.contingents[c.facing] : null;
  if (c.mode !== 'formed' || c.charging || c.inContact || !ec) return false;
  const d = c.d;
  if (d > TUNING.chargeDistance + 8 || d < TUNING.gap + 2) return false;
  c.charging = true;
  c.counterCharge = !!counter;
  c.bracing = false;
  c.order = 'advance';
  world.charges.push({ t: world.t, unit: u.id, contingent: c.index, counter: !!counter, distance: d });
  const who = nameOf(u, c);
  let text = `The ${who} break into a run and charge, ${Math.round(d)} m out.`;
  if (counter) text = `The ${who} run out to meet them!`;
  else if (following) text = `Seeing the ${following} go, the ${who} charge too, ${Math.round(d)} m out.`;
  logEvent(world, 'charge', text, { unit: u.id });
  return true;
}

// The whole side gives way: every contingent still standing goes with it.
export function rout(world, u, why) {
  if (u.mode === 'routed') return;
  const e = world.units[1 - u.id];
  u.routNote = { why: why || 'running', running: u.running, present: u.present, nerve: u.nerve, enemyNerve: e.nerve };
  u.mode = 'routed';
  u.routT = world.t;
  for (const c of u.contingents) {
    c.charging = false;
    c.order = 'hold';
    if (c.mode !== 'routed') {
      c.mode = 'routed';
      c.routT = world.t;
    }
  }
  if (world.contactT == null) u.routDistance = Math.min(99, ...u.contingents.map((c) => c.d).filter(Number.isFinite));
  if (u.decisionT == null) u.decisionT = world.t;
  logEvent(world, 'rout', `The ${u.adjective} line breaks!`, { unit: u.id });
}

export function startPursuit(world, u, c) {
  c.mode = 'pursuing';
  c.pursuitT = 0;
  c.pursued = true;
  c.charging = false;
  let n = 0;
  for (const id of c.members) {
    const s = world.soldiers[id];
    if (!isFormed(s) || !s.slot) continue;
    if (s.nerve < 0.4 || s.stamina < 0.35) continue;
    s.state = 'pursuing';
    s.stateT = 0;
    s.target = -1;
    n++;
  }
  logEvent(world, 'pursuit', `${n} of the ${nameOf(u, c)} run after the beaten enemy.`, { unit: u.id });
}

export function recallPursuit(world, u, c) {
  c.mode = 'formed';
  for (const id of c.members) {
    const s = world.soldiers[id];
    if (s.state === 'pursuing') {
      s.state = s.slot ? 'returning' : 'rallying';
      s.stateT = 0;
      s.target = -1;
    }
  }
  logEvent(world, 'pursuit', `The ${nameOf(u, c)} are called back to their ranks.`, { unit: u.id });
}

export function recoil(s) {
  // Stepping back spends what courage he had left; he has to work it up again.
  s.resolve = Math.min(s.resolve, 0.1 * s.courage);
  s.breathT = (6 + 0.6 * (s.fightT || 0)) * (1.3 - s.courage);
  s.state = 'recoiling';
  s.stateT = 0;
  s.target = -1;
  s.aggressor = false;
}

function anyRunningNear(world, u, c, e, range) {
  const p = slotWorld(u, (c.file0 + c.file1 - 1) / 2, 0);
  for (const id of e.members) {
    const o = world.soldiers[id];
    if (isRunning(o) && dist(o.pos, p) < range) return true;
  }
  return false;
}

// ---- Word along the line ----

// How long word from the next contingent takes to reach this one's commander.
export function wordDelay(c) {
  const T = TUNING;
  return (T.wordBase + T.wordPerFile * (c.file1 - c.file0)) * (T.wordRelay[c.quality] || 1);
}

// What a contingent is doing, as the men beside it would see it and pass it on.
function statusOf(c) {
  if (c.mode !== 'formed') return c.mode;
  if (c.charging) return 'charging';
  if (c.yielding || c.order === 'back') return 'yielding';
  if (c.contacted) return c.surgeCallT > 0 ? 'surging' : 'fighting';
  return c.order === 'advance' ? 'advancing' : 'holding';
}

export function recordHistory(world, c) {
  c.history.push({ t: world.t, status: statusOf(c), mode: c.mode, charging: c.charging, ground: c.ground, contacted: c.contacted, nerve: c.nerve });
  while (c.history.length > 2 && c.history[1].t < world.t - 40) c.history.shift();
}

// What the commander of c believes the contingent on his left (-1) or right (+1) is doing: what
// it was doing when word set out, a few seconds ago.
export function heardOf(world, u, c, side) {
  const n = u.contingents[c.index + side];
  if (!n) return null;
  const t = world.t - wordDelay(c);
  let seen = null;
  for (const h of n.history) {
    if (h.t > t) break;
    seen = h;
  }
  return seen ? { ...seen, name: n.name, index: n.index } : null;
}

const WORD = {
  advancing: 'are advancing.',
  holding: 'have halted.',
  charging: 'are charging!',
  yielding: 'are giving ground.',
  surging: 'are going forward into the enemy.',
  withdrawing: 'are pulling back.',
  out: 'have left the field.',
  pursuing: 'are chasing the beaten enemy.',
  routed: 'have broken and run!',
};

// Brings each commander's picture of his flanks up to date. The player's own commander gets
// it as word in the log, when something worth passing on reaches him.
function listen(world, u, c) {
  [-1, 1].forEach((side, k) => {
    const now = heardOf(world, u, c, side);
    const before = c.heard[k];
    c.heard[k] = now;
    if (c.ai || !now || !before || now.status === before.status) return;
    const from = `Word from the ${side < 0 ? 'left' : 'right'}: the ${now.name}`;
    if (now.contacted && !before.contacted) {
      logEvent(world, 'word', `${from} have met the enemy.`, { unit: u.id });
      return;
    }
    // Before the lines meet, men pass on every move; once they are in it, only what matters.
    if (now.contacted && (now.status === 'fighting' || now.status === 'holding' || now.status === 'advancing')) return;
    if (WORD[now.status]) logEvent(world, 'word', `${from} ${WORD[now.status]}`, { unit: u.id });
  });
}

// ---- The commanders' decisions, made every half second ----

export function decideContingent(world, u, c) {
  const T = TUNING;
  const e = world.units[1 - u.id];
  recordHistory(world, c);
  if (c.mode === 'routed' || c.mode === 'out') return;
  listen(world, u, c);
  if (c.mode === 'pursuing') {
    if (c.pursuitT > T.pursuitTime || !anyRunningNear(world, u, c, e, 40)) recallPursuit(world, u, c);
    return;
  }
  if (e.mode === 'routed') {
    if (c.ai && !c.pursued && c.nerve > 0.45 && c.stamina > 0.4 && c.mode === 'formed') startPursuit(world, u, c);
    else if (c.ai) c.order = 'hold';
    return;
  }
  if (!c.ai || world.result) return;
  const heard = c.heard.filter(Boolean);
  const ec = c.facing >= 0 ? e.contingents[c.facing] : null;
  const leader = c.leaderId >= 0 ? world.soldiers[c.leaderId] : null;
  if (c.mode === 'withdrawing') {
    c.order = 'withdraw';
    return;
  }
  if (!ec) {
    // Nobody in front any more: the enemy here has broken or gone. Hot-headed men may run
    // after them, leaving a hole of their own; steady ones keep their place in the line.
    if (c.contacted && !c.pursued && c.nerve > 0.55 && c.stamina > 0.5 && anyRunningNear(world, u, c, e, 25)
      && world.rng.chance(0.15 * (1 - contingentDiscipline(world, c)))) {
      startPursuit(world, u, c);
      return;
    }
    c.order = 'hold';
    return;
  }
  if (!c.contacted && (!c.inContact || c.bracing || c.charging) && decideApproach(world, u, c, ec, heard)) return;

  // A commander pulls his men out when they are badly shaken, unless he can see the enemy in
  // front of him is in worse shape, in which case he holds on a little longer and hopes they
  // crack first. Word that the men beside him have gone makes him fear for his flank.
  const runningShare = c.running / Math.max(1, c.present + c.running);
  const enemyRunningShare = ec.running / Math.max(1, ec.present + ec.running);
  const enemyWorse = ec.nerve < c.nerve - 0.05 || enemyRunningShare > runningShare + 0.1;
  const flank = heard.find((h) => h.mode === 'routed' || h.mode === 'out' || h.mode === 'withdrawing');
  const base = enemyWorse ? T.withdrawNerve - 0.1 : T.withdrawNerve;
  const floor = base + (flank ? T.flankFear : 0);
  const runLimit = enemyWorse ? 0.25 : 0.15;
  // In the first moments after a charge strikes home the lines are locked together; no
  // commander can pull his men back until the shock has settled.
  const settled = c.impactT == null || world.t - c.impactT > T.impactSettle;
  if (c.inContact && ((c.nerve < floor && settled) || runningShare > runLimit)) {
    c.withdrawNote = {
      nerve: c.nerve, enemyNerve: ec.nerve, running: c.running, enemyRunning: ec.running, heldOn: !!c.heldOnLogged,
      flank: flank && c.nerve >= base ? flank.name : null,
    };
    beginWithdraw(world, u, c, 'nerve');
    return;
  }
  if (c.inContact && enemyWorse && c.nerve < T.withdrawNerve && !c.heldOnLogged && leader && isFormed(leader)) {
    c.heldOnLogged = true;
    logEvent(world, 'order', `The ${nameOf(u, c)} are badly shaken, but seeing the ${nameOf(e, ec)} in worse shape, ${leader.name} keeps them in the fight.`, { unit: u.id });
  }
  const lull = world.inPulse ? 0 : world.t - (world.lullStartT || world.t);
  if (c.inContact && lull > T.standoffIdle && c.nerve < T.standoffNerve && ec.nerve < T.standoffNerve + 0.1 && c.nerve <= ec.nerve) {
    beginWithdraw(world, u, c, 'standoff');
    return;
  }
  if (ec.mode === 'withdrawing') {
    c.followT += 0.5;
    c.order = c.followT < T.followTime && c.nerve > 0.6 && c.nerve > ec.nerve + 0.15 && c.stamina > 0.45 ? 'advance' : 'hold';
    return;
  }
  // Giving ground in order: a disciplined contingent whose front rank is spent, with the enemy
  // pressing, steps back behind its shields and refuses the fight until the enemy's push
  // runs out. An undisciplined one cannot make room to do it.
  if (c.yielding) {
    c.yieldT += 0.5;
    const pressing = frontAggressors(world, e, ec);
    const recovered = frontSpent(world, u, c) < 0.3;
    if (c.yieldT > 6 && ((pressing < 0.15 && recovered) || c.yieldT > 18)) {
      c.yielding = false;
      c.order = 'hold';
      // The enemy's push has run out against them. If their own men are the fresher, a
      // leader who has kept his men in hand turns them straight round onto the tired enemy.
      if (frontSpent(world, e, ec) > 0.4 && c.stamina > ec.stamina + 0.1) {
        c.surgeCooldown = 0;
        logEvent(world, 'order', `The enemy push spent, the ${nameOf(u, c)} stop giving ground and turn on them.`, { unit: u.id });
        callSurge(world, u, c);
      }
    } else {
      c.order = 'back';
    }
    return;
  }
  if (c.inContact && frontAggressors(world, e, ec) > 0.3 && frontSpent(world, u, c) > 0.4 && contingentDiscipline(world, c) > 0.35) {
    c.yielding = true;
    c.yieldT = 0;
    c.order = 'back';
    callHalt(world, u, c, true);
    if (c.yieldLogT == null || world.t - c.yieldLogT > 30) {
      c.yieldLogT = world.t;
      logEvent(world, 'yield', `Their front rank spent, the ${nameOf(u, c)} give ground step by step behind their shields, refusing the fight.`, { unit: u.id });
    }
    return;
  }
  // Following up an enemy who is giving ground is only worth it with fresh, confident men.
  if (ec.yielding) {
    c.order = c.nerve > 0.55 && c.stamina > ec.stamina + 0.1 ? 'advance' : 'hold';
    return;
  }
  c.order = c.d > T.gap + 0.1 ? 'advance' : 'hold';
  // When much of the front rank is spent and calling to ease off, a leader who knows his
  // business calls his men back to catch their breath.
  if (c.inContact) {
    const men = frontMen(world, u, c);
    const spent = men.filter((s) => s.wantsOut).length;
    if (men.length && spent / men.length > 0.5 && leader && isFormed(leader) && world.rng.chance(0.3 + 0.6 * leader.reputation)) callHalt(world, u, c);
  }
  if (!c.inContact || !leader || !isFormed(leader)) return;
  const sinceHalt = c.lastHaltT != null ? world.t - c.lastHaltT : 99;
  // Hearing the men beside them go forward, men take up the cry sooner.
  const cry = heard.find((h) => h.status === 'surging');
  if (sinceHalt > 12 && c.nerve > ec.nerve + 0.05 && c.stamina > 0.55) callSurge(world, u, c);
  else if (cry && sinceHalt > 6 && c.nerve > ec.nerve - 0.05 && c.stamina > 0.5 && c.surgeCooldown <= 0) {
    logEvent(world, 'order', `Hearing the ${cry.name} go forward, ${leader.name} takes up the cry.`, { unit: u.id });
    callSurge(world, u, c);
  }
}

// Before the lines meet: whether to charge, how to answer an enemy charge, and keeping level
// with the contingents beside him as far as he knows where they are.
// Returns true when it has settled the contingent's order for this tick.
function decideApproach(world, u, c, ec, heard) {
  const T = TUNING;
  if (c.charging) return true;
  const d = c.d;
  if (ec.charging && d < T.chargeDistance + 10) {
    if (!c.reacted) {
      c.reacted = true;
      if (c.nerve > 0.55 && c.stamina > 0.6 && world.rng.chance(0.5) && startCharge(world, u, c, true)) return true;
      c.bracing = true;
      logEvent(world, 'order', `The ${nameOf(u, c)} halt and brace behind their shields.`, { unit: u.id });
    }
    if (c.bracing) {
      c.order = 'hold';
      return true;
    }
  }
  // Word that the men beside them are charging: most will run with them.
  const going = heard.find((h) => h.charging);
  if (going && !c.followedCharge && d < T.chargeDistance + 4 && d > T.gap + 4) {
    c.followedCharge = true;
    if (c.nerve > 0.5 && c.stamina > 0.6 && world.rng.chance(0.4 + 0.5 * c.nerve) && startCharge(world, u, c, false, going.name)) return true;
  }
  // A confident, fresh contingent may break into a run for the last stretch.
  if (!ec.charging && d < T.chargeDistance && d > T.gap + 6 && c.nerve > 0.6 && c.stamina > 0.75 && world.rng.chance(0.12)) {
    if (startCharge(world, u, c, false)) return true;
  }
  // Keep the line: no commander wants to arrive alone. He waits when he is well ahead of where
  // he last heard the men beside him were.
  const behind = heard.filter((h) => !h.contacted && h.mode === 'formed').map((h) => h.ground);
  if (behind.length && c.ground - Math.min(...behind) > T.lineSlack) {
    c.order = 'hold';
    return true;
  }
  return false;
}

// Orders from the player, for the contingent he leads. Returns false when the order can't be
// given right now.
export function playerOrder(world, u, order) {
  const c = u.contingents[u.lead];
  if (!c || c.ai) return false;
  const e = world.units[1 - u.id];
  const ec = c.facing >= 0 ? e.contingents[c.facing] : null;
  if (c.mode === 'routed' || c.mode === 'out') return false;
  switch (order) {
    case 'advance':
    case 'hold':
    case 'back':
      if (c.mode === 'withdrawing') cancelWithdraw(world, u, c);
      if (c.mode === 'pursuing') return false;
      c.order = order;
      c.bracing = false;
      // Giving ground is done in order: the men step back behind their shields.
      c.yielding = order === 'back';
      if (c.yielding) callHalt(world, u, c, true);
      return true;
    case 'withdraw':
      beginWithdraw(world, u, c, 'ordered');
      return c.mode === 'withdrawing';
    case 'surge':
      return callSurge(world, u, c);
    case 'ease':
      return callHalt(world, u, c);
    case 'charge':
      return startCharge(world, u, c, !!(ec && ec.charging));
    case 'pursue':
      if (c.mode !== 'formed') return false;
      if (e.mode !== 'routed' && !(c.contacted && !ec && anyRunningNear(world, u, c, e, 25))) return false;
      startPursuit(world, u, c);
      return true;
    case 'recall':
      if (c.mode !== 'pursuing') return false;
      recallPursuit(world, u, c);
      return true;
    default:
      return false;
  }
}
