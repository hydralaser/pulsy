import { makeRng } from './rng.js';
import { TUNING, SHIELDS, ARMOUR } from './rules.js';
import { isFormed, isGone, isRunning, dist, fwdOf, angleWrap, clamp, shiftNerve, logEvent } from './core.js';
import { createSoldier } from './soldier.js';
import {
  createUnit, slotWorld, occupant, placeInSlot, vacateSlot, frontDistance, arrange,
  closeRanks, rearSlot, handleLeaderLoss,
} from './unit.js';
import { reachOf, computeAttackers, threatsTo, chooseTarget, closestOf, runBlows, resolveBlow } from './combat.js';
import { updateNerve, heldInPlace } from './nerve.js';
import { findOpening, resolveRate, spendResolve, stepRearMan, passTheWord } from './resolve.js';
import { decideUnit, rout, recoil, startPursuit } from './ai.js';

export const DEFAULT_CONFIG = {
  seed: 404,
  sides: [
    { count: 40, files: 10, placement: 'xenophon', ai: true },
    { count: 40, files: 8, placement: 'random', ai: true },
  ],
};

export function createBattle(config) {
  const cfg = JSON.parse(JSON.stringify(config));
  const rng = makeRng(cfg.seed);
  const world = {
    config: cfg,
    rng,
    t: 0,
    step: 0,
    phase: 'setup', // setup | battle
    soldiers: [],
    units: [],
    events: [],
    marks: [],
    attackers: {},
    contactT: null,
    impactAt: null,
    charges: [],
    surgeLog: [],
    pulses: 0,
    inPulse: false,
    pulseStartT: 0,
    overlapNoted: false,
    blows: 0,
    result: null,
  };
  const half = TUNING.startDistance / 2;
  cfg.sides.forEach((side, i) => {
    const files = clamp(side.files, 2, side.count);
    const ranks = Math.ceil(side.count / files);
    const anchor = i === 0 ? { x: -half, y: 0 } : { x: half, y: 0 };
    const u = createUnit(i, i, { files, ranks, ai: side.ai }, anchor, i === 0 ? 0 : Math.PI);
    const used = new Set();
    for (let k = 0; k < side.count; k++) {
      const s = createSoldier(rng, world.soldiers.length, i, i, used);
      world.soldiers.push(s);
      u.members.push(s.id);
    }
    world.units.push(u);
  });
  // Arrange with a separate stream so changing placement never changes who the men are.
  world.units.forEach((u, i) => {
    const keep = world.rng;
    world.rng = makeRng(cfg.seed * 31 + i + 7);
    arrange(world, u, cfg.sides[i].placement);
    world.rng = keep;
  });
  // Each side's spirit on the day: omens at the sacrifice, hunger, a long march.
  // It shifts every man's nerve a little and is rolled separately from the men themselves.
  const spiritRng = makeRng(cfg.seed * 17 + 3);
  for (const u of world.units) {
    u.spirit = clamp(spiritRng.normal(0, 0.05), -0.12, 0.12);
    for (const id of u.members) {
      const s = world.soldiers[id];
      s.nerveCap = clamp(s.nerveCap + u.spirit, 0.3, 1);
      s.nerve = s.nerveCap;
    }
  }
  return world;
}

export function startBattle(world) {
  world.phase = 'battle';
  logEvent(world, 'start', 'The two phalanxes face each other across the plain.');
}

// ---- Perception: who is near whom, computed once per step ----

function perceive(world) {
  const alive = world.soldiers.filter((s) => !isGone(s));
  for (const s of alive) {
    s.friends = [];
    s.enemies = [];
  }
  for (let i = 0; i < alive.length; i++) {
    const a = alive[i];
    for (let j = i + 1; j < alive.length; j++) {
      const b = alive[j];
      const d = dist(a.pos, b.pos);
      if (d > 9) continue;
      if (a.side === b.side) {
        a.friends.push({ o: b, d });
        b.friends.push({ o: a, d });
      } else {
        a.enemies.push({ o: b, d });
        b.enemies.push({ o: a, d });
      }
    }
  }
}

function nearestHostile(world, s) {
  const e = world.units[1 - s.unit];
  let best = Infinity;
  for (const id of e.members) {
    const o = world.soldiers[id];
    if (!isFormed(o) && o.state !== 'pursuing') continue;
    best = Math.min(best, dist(o.pos, s.pos));
  }
  return best;
}

// ---- Soldier state machine ----

function setState(s, state) {
  s.state = state;
  s.stateT = 0;
}

function flee(world, s, why) {
  const u = world.units[s.unit];
  vacateSlot(u, s);
  setState(s, 'fleeing');
  s.fleeT = 0;
  s.target = -1;
  s.aggressor = false;
  s.record.fled++;
  u.stats.fled++;
  s.nerveCap = Math.max(0.2, s.nerveCap - 0.15);
  s.nerve = 0;
  for (const { o, d } of s.friends) {
    if (d < 5 && isFormed(o)) shiftNerve(world, o, -0.02, 'panic');
  }
  if (why !== 'rout') {
    if (!u.firstFlightLogged) {
      u.firstFlightLogged = true;
      logEvent(world, 'flee', `${s.name} of ${s.origin} is the first of the ${u.short} to turn and run.`, { unit: u.id, who: s.id });
    } else if (s.veteran) {
      logEvent(world, 'flee', `Even the veteran ${s.name} breaks and runs.`, { unit: u.id, who: s.id });
    }
  }
  if (s.id === u.leaderId || s.id === u.secondId) handleLeaderLoss(world, u, s, 'fled');
}

// How far a man could step back before he walks into the man behind him.
function roomBehind(world, u, s) {
  if (!s.slot) return 9;
  const behind = occupant(world, u, s.slot.f, s.slot.r + 1);
  if (!behind || !isFormed(behind)) return 9;
  const fw = fwdOf(u.heading);
  const depth = (p) => (p.x - u.anchor.x) * fw.x + (p.y - u.anchor.y) * fw.y;
  return depth(s.pos) - (depth(behind.lag) + TUNING.rankSpacing * 0.65);
}

function enemyInReach(s) {
  for (const { o, d } of s.enemies) if (isFormed(o) && d < reachOf(s) - 0.2) return true;
  return false;
}

function nearestFormedEnemyDist(s) {
  let best = Infinity;
  for (const { o, d } of s.enemies) if (isFormed(o) && d < best) best = d;
  return best;
}

// Resolve builds; when he is worked up enough he steps into the gap, at the opening he saw if
// there was one. `scale` slows it for men who are busy defending.
function buildResolve(world, s, dt, scale, forcedReason) {
  const opening = findOpening(world, s);
  const { rate, reason, ready } = resolveRate(world, s, opening);
  if (s.breathT > 0) s.breathT -= dt;
  s.resolve = clamp(s.resolve + rate * scale * dt, 0, 1.2);
  if (s.resolve < 1 || !ready) return;
  setState(s, 'surging');
  s.aggressor = true;
  s.noTargetT = 0;
  s.fightT = 0;
  s.target = opening && reason === opening.kind ? opening.target : -1;
  s.surgeReason = forcedReason && reason === 'worked up' ? forcedReason : reason;
  world.surgeLog.push({ t: world.t, id: s.id, reason: s.surgeReason, target: s.target });
  if (world.surgeLog.length > 40) world.surgeLog.shift();
}

// A spent front-rank man swaps places with an eager, fresh man pushing up behind him: the
// tired man filters back into the second rank and the fresh one goes in. In the press this
// only happens where a veteran is on hand to organise it; otherwise the tired man is stuck.
function filterBack(world, u, s) {
  if (!s.wantsOut || s.pinnedT < 1.5 || (s.stamina > 0.5 && s.health > 0.6)) return false;
  const b = occupant(world, u, s.slot.f, 1);
  if (!b || b.state !== 'inRank' || b.resolve < 0.6 || b.stamina < 0.7 || b.halt > 0.5) return false;
  if ((b.discipline || 0) < 0.5 && (s.discipline || 0) < 0.5) return false;
  const front = s.slot;
  const back = b.slot;
  u.grid[front.r][front.f] = b.id;
  u.grid[back.r][back.f] = s.id;
  s.slot = back;
  b.slot = front;
  setState(s, 'returning');
  s.aggressor = false;
  s.target = -1;
  s.wantsOut = false;
  s.breathT = Math.max(s.breathT, 6);
  setState(b, 'surging');
  b.aggressor = true;
  b.target = -1;
  b.fightT = 0;
  b.noTargetT = 0;
  b.resolve = Math.max(b.resolve, 1);
  b.surgeReason = 'fresh';
  if (!u.filterLogged) {
    u.filterLogged = true;
    logEvent(world, 'filter', `Fresh ${u.short} push up from behind: ${b.name} takes the place of the exhausted ${s.name}.`, { unit: u.id });
  }
  return true;
}

function fatigueMul(s) {
  return (SHIELDS[s.shield].fatigue + ARMOUR[s.armour].fatigue) / 2;
}

function stepSoldier(world, s, dt) {
  const T = TUNING;
  const u = world.units[s.unit];
  const rng = world.rng;
  s.stateT += dt;
  const attackers = threatsTo(world, s);
  // A front-rank man who has had enough, while he is still at it, calls for the line to ease off.
  // Once he is resting in a lull he is having his break and stops calling.
  const engaged = s.state === 'fighting' || s.state === 'surging' || s.state === 'recoiling' || attackers.length > 0;
  s.wantsOut = !!(s.slot && s.slot.r === 0 && isFormed(s) && u.inContact && (
    s.state === 'recoiling' || s.state === 'wavering' || s.state === 'yielding'
    || (engaged && (s.stamina < 0.4 || s.health < 0.5 || (!s.aggressor && s.fightT > 4)))));
  s.pinnedT = s.wantsOut ? s.pinnedT + dt : 0;
  const rest = () => {
    if (u.charging) s.stamina = Math.max(0, s.stamina - T.staminaRun * fatigueMul(s) * dt);
    else s.stamina = Math.min(s.staminaCap, s.stamina + T.staminaRecover * dt);
  };

  switch (s.state) {
    case 'inRank': {
      rest();
      if (attackers.length && s.slot) {
        // A tired or resting man, or one whose unit is giving ground, steps back behind his
        // shield rather than trade blows, if there is room behind him. Otherwise he fights.
        const tired = u.yielding || s.stamina < 0.5 || s.breathT > 0;
        setState(s, tired && roomBehind(world, u, s) > 0.3 ? 'yielding' : 'fighting');
        s.aggressor = false;
        s.fightT = 0;
        s.idleT = 0;
        s.target = closestOf(world, s, attackers);
        break;
      }
      if (s.slot && s.slot.r > 0) {
        stepRearMan(world, s, dt);
        break;
      }
      // Pushed up within spear reach of the enemy by the men behind, he has to fight.
      if (s.slot && u.inContact && s.stateT > 0.5 && enemyInReach(s)) {
        setState(s, 'fighting');
        s.aggressor = true;
        s.fightT = 0;
        s.noTargetT = 0;
        s.target = -1;
        s.resolve = Math.max(s.resolve, 0.4);
        s.surgeReason = 'pressed';
        break;
      }
      if (!s.slot || u.mode !== 'formed' || u.order === 'back' || u.charging) {
        s.resolve = Math.max(0, s.resolve - 0.05 * dt);
        break;
      }
      if (nearestFormedEnemyDist(s) > T.gap + reachOf(s) + 2.5) break;
      buildResolve(world, s, dt, 1);
      break;
    }

    case 'surging':
    case 'fighting': {
      s.stamina = Math.max(0, s.stamina - (s.state === 'fighting' ? T.staminaFight : T.staminaSurge) * fatigueMul(s) * dt);
      s.fightT += dt;
      if (u.mode !== 'formed' || u.order === 'back') {
        recoil(s);
        break;
      }
      if (s.aggressor) {
        const t = s.target >= 0 ? world.soldiers[s.target] : null;
        if (!t || isGone(t) || dist(s.pos, t.pos) > T.surgeSearch) s.target = chooseTarget(world, s, T.surgeSearch);
        if (s.target < 0) {
          s.noTargetT += dt;
          if (s.noTargetT > 1.5) {
            recoil(s);
            break;
          }
        } else {
          s.noTargetT = 0;
          if (s.state === 'surging' && dist(s.pos, world.soldiers[s.target].pos) <= reachOf(s)) setState(s, 'fighting');
        }
        if (s.stamina < 0.3 || s.nerve < T.nerveWaver + 0.05) {
          recoil(s);
          break;
        }
        if (s.slot && dist(s.pos, slotWorld(u, s.slot.f, s.slot.r)) > T.surgeReach) {
          recoil(s);
          break;
        }
        spendResolve(world, s, dt);
        if (s.resolve <= 0) recoil(s);
      } else {
        // A defender who has held his ground can find the nerve to go over to the attack,
        // or, if he is spent and a fresh man is pushing up behind him, give him his place.
        if (s.slot && s.slot.r === 0 && s.fightT > 1) buildResolve(world, s, dt, 0.5, 'counter');
        if (s.state === 'fighting' && filterBack(world, u, s)) break;
        // A defender holds his place and fights whoever is attacking him.
        if (attackers.length) {
          if (!attackers.includes(s.target)) s.target = closestOf(world, s, attackers);
          s.idleT = 0;
        } else {
          s.idleT += dt;
          if (s.idleT > 1) {
            // Holding off an attack is exhausting too; he needs his breath back before going forward.
            s.breathT = (4 + 0.4 * s.fightT) * (1.3 - s.courage);
            s.resolve *= 0.5;
            setState(s, 'inRank');
            s.target = -1;
          }
        }
      }
      break;
    }

    case 'recoiling':
    case 'returning': {
      rest();
      if (!s.slot) {
        setState(s, 'rallying');
        break;
      }
      // Trying to step back with the ranks behind still pressing: he is held at the front
      // and has to keep defending himself.
      if (s.state === 'recoiling' && attackers.length && s.slot.r === 0) {
        if (filterBack(world, u, s)) break;
        setState(s, 'fighting');
        s.aggressor = false;
        s.fightT = 0;
        s.idleT = 0;
        s.target = closestOf(world, s, attackers);
        break;
      }
      if (dist(s.pos, desiredPoint(world, s) || s.pos) < 0.3) setState(s, 'inRank');
      break;
    }

    case 'yielding': {
      s.stamina = Math.max(0, s.stamina - T.staminaSurge * dt);
      s.fightT += dt;
      if (attackers.length) {
        if (!attackers.includes(s.target)) s.target = closestOf(world, s, attackers);
        s.idleT = 0;
        // Backed up against the men behind with nowhere left to go, he has to fight.
        if (roomBehind(world, u, s) < 0.1 && s.fightT > 1) {
          setState(s, 'fighting');
          s.aggressor = false;
          s.fightT = 0;
        }
      } else {
        s.idleT += dt;
        if (s.idleT > 1) {
          s.breathT = Math.max(s.breathT, 3 * (1.3 - s.courage));
          setState(s, 'inRank');
          s.target = -1;
        }
      }
      break;
    }

    case 'wavering': {
      rest();
      s.target = attackers.length ? closestOf(world, s, attackers) : -1;
      if (s.nerve > T.nerveSteady) setState(s, 'inRank');
      break;
    }

    case 'fleeing': {
      s.stamina = Math.max(0, s.stamina - T.staminaRun * dt);
      s.fleeT += dt;
      if (Math.abs(s.pos.x) > T.fieldHalfW || Math.abs(s.pos.y) > T.fieldHalfH) {
        setState(s, 'escaped');
        break;
      }
      if (s.fleeT > 5 && u.mode !== 'routed' && s.nerveCap >= 0.35 && nearestHostile(world, s) > 25) {
        setState(s, 'rallying');
      }
      break;
    }

    case 'rallying': {
      rest();
      shiftNerve(world, s, 0.035 * dt);
      if (u.mode === 'routed' || nearestHostile(world, s) < 12) {
        setState(s, 'fleeing');
        s.fleeT = 0;
        break;
      }
      if (s.nerve >= T.nerveRally && u.mode === 'formed') {
        const back = rearSlot(u);
        if (back) {
          placeInSlot(u, s, back.f, back.r);
          setState(s, 'returning');
        }
      }
      break;
    }

    case 'pursuing': {
      s.stamina = Math.max(0, s.stamina - T.staminaRun * dt);
      // Anyone from a broken unit is fair game, including men still boxed in and waiting to turn.
      const e = world.units[1 - s.unit];
      const catchable = (o) => isRunning(o) || (e.mode === 'routed' && isFormed(o));
      const t = s.target >= 0 ? world.soldiers[s.target] : null;
      if (!t || !catchable(t)) {
        s.target = -1;
        let bestD = 30;
        for (const id of e.members) {
          const o = world.soldiers[id];
          if (!catchable(o)) continue;
          const d = dist(o.pos, s.pos);
          if (d < bestD) {
            bestD = d;
            s.target = o.id;
          }
        }
      }
      if (s.target < 0 || s.stamina < 0.25) {
        s.target = -1;
        setState(s, s.slot ? 'returning' : 'rallying');
      }
      break;
    }

    default:
      break;
  }

  if (isFormed(s)) {
    if (u.mode === 'routed') {
      // A line that breaks before contact turns from the rear: the front ranks are boxed in until the
      // men behind have cleared. Once the lines are locked together everyone turns at once.
      const boxedIn = world.contactT == null && s.slot ? (u.ranks - 1 - s.slot.r) * 0.6 : 0;
      if (s.routDelay < 0) s.routDelay = rng.range(0, 1.2) + boxedIn;
      s.routDelay -= dt;
      if (s.routDelay <= 0) flee(world, s, 'rout');
      return;
    }
    updateNerve(world, s, dt);
    if (s.nerve < T.nerveFlee) {
      // A man at breaking point takes a moment before he actually turns to run.
      if (s.fleeCheckT <= 0 && !s.breaking) s.fleeCheckT = rng.range(0.5, 2.5);
      s.breaking = true;
      s.fleeCheckT -= dt;
      if (s.fleeCheckT <= 0) {
        s.fleeCheckT = 0.5;
        if (heldInPlace(world, s)) shiftNerve(world, s, 0.03);
        else flee(world, s, 'nerve');
      }
    } else {
      s.breaking = false;
    }
    if (isFormed(s) && s.nerve < T.nerveWaver && s.state !== 'wavering' && s.state !== 'returning') {
      setState(s, 'wavering');
      s.aggressor = false;
    }
  }
}

// ---- Movement ----

// Where a man in formation actually wants to stand: his slot, loosened by disorder, moved by
// the give and take at the front, and kept a body's length behind the man in front of him.
// Each man reacts to where the man ahead was a moment ago, so a step back at the front
// ripples back through the file, and a surge draws the ranks behind up after it.
function shapeHome(world, u, s, slot, fw) {
  const T = TUNING;
  let h = slot;
  if (u.cohesion < 0.98) {
    const loose = (1 - u.cohesion) * 1.4;
    const a = Math.sin(s.id * 12.9898) * 0.5;
    const b = Math.cos(s.id * 78.233) * 0.35;
    h = { x: h.x + (fw.x * a - fw.y * b) * loose, y: h.y + (fw.y * a + fw.x * b) * loose };
  }
  const depth = (p) => (p.x - u.anchor.x) * fw.x + (p.y - u.anchor.y) * fw.y;
  const base = depth(h);
  let want = base;
  const rs = T.rankSpacing;
  if (s.slot.r === 0) {
    want -= u.give[s.slot.f];
    if (s.state === 'yielding') want -= 1.2;
    // Leaning in as he works himself up to go forward.
    if (s.state === 'inRank' && u.inContact) want += Math.min(0.3, s.resolve * 0.3);
    // Between surges he would not choose to stand inside spear reach of the enemy line.
    want = Math.min(want, base + 0.35);
  } else {
    // Eager men press up behind the man in front; men who have heard the word ease back.
    // Only men who are really worked up push forward; the merely restless keep their places.
    if (u.inContact && isFormed(s)) want += T.pressForward * Math.max(0, s.resolve - 0.4) / 0.6 * (1 - s.halt);
    // Men who have heard the word step back themselves, making room for the men in front.
    if (u.inContact && isFormed(s)) want -= 0.8 * s.halt * (0.4 + 0.6 * (s.discipline || 0));
    const ahead = occupant(world, u, s.slot.f, s.slot.r - 1);
    if (ahead && ahead.state !== 'dead') {
      const a = depth(ahead.lag);
      want = clamp(want, a - rs * 1.5, a - rs * 0.6);
    }
  }
  // Nobody can step back through the man behind him. If the ranks behind are pressing, the
  // men in front of them are held where they are until the rear gives way.
  const behind = occupant(world, u, s.slot.f, s.slot.r + 1);
  if (behind && isFormed(behind) && behind.state !== 'returning') want = Math.max(want, depth(behind.lag) + rs * 0.65);
  return { x: h.x + fw.x * (want - base), y: h.y + fw.y * (want - base) };
}

function desiredPoint(world, s) {
  const u = world.units[s.unit];
  const fw = fwdOf(u.heading);
  const home = s.slot ? shapeHome(world, u, s, slotWorld(u, s.slot.f, s.slot.r), fw) : null;
  switch (s.state) {
    case 'inRank':
    case 'yielding':
    case 'recoiling':
    case 'returning':
      return home;
    case 'wavering':
      return home ? { x: home.x - fw.x * 0.35, y: home.y - fw.y * 0.35 } : null;
    case 'surging':
    case 'fighting': {
      if (!home) return null;
      if (!s.aggressor) return home;
      if (s.target < 0) return { x: home.x + fw.x * 1.5, y: home.y + fw.y * 1.5 };
      const t = world.soldiers[s.target];
      const dx = s.pos.x - t.pos.x;
      const dy = s.pos.y - t.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      const want = reachOf(s) * 0.85;
      let p = { x: t.pos.x + (dx / len) * want, y: t.pos.y + (dy / len) * want };
      const ox = p.x - home.x;
      const oy = p.y - home.y;
      const off = Math.hypot(ox, oy);
      if (off > TUNING.surgeReach - 0.3) {
        const k = (TUNING.surgeReach - 0.3) / off;
        p = { x: home.x + ox * k, y: home.y + oy * k };
      }
      return p;
    }
    case 'pursuing':
      return s.target >= 0 ? world.soldiers[s.target].pos : null;
    default:
      return null;
  }
}

function maxSpeed(world, s) {
  const T = TUNING;
  switch (s.state) {
    case 'fleeing':
      // Turning round and getting out of the press takes a moment; then he sprints.
      if (s.fleeT < 0.8) return T.walk * 0.8 * s.speedMul;
      return T.run * s.speedMul * (0.45 + 0.55 * s.stamina);
    case 'pursuing':
      return T.run * s.speedMul * (0.5 + 0.5 * s.stamina);
    case 'surging':
    case 'fighting':
      return T.surgePace * s.speedMul;
    default:
      return (world.units[s.unit].charging ? T.run : T.walk) * s.speedMul;
  }
}

function moveSoldier(world, s, dt) {
  const u = world.units[s.unit];
  let dv = { x: 0, y: 0 };
  if (s.state === 'fleeing') {
    const e = world.units[1 - s.unit];
    const back = fwdOf(u.heading);
    let dx = s.pos.x - e.anchor.x - back.x * 4;
    let dy = s.pos.y - e.anchor.y - back.y * 4;
    const len = Math.hypot(dx, dy) || 1;
    const sp = maxSpeed(world, s);
    dv = { x: (dx / len) * sp, y: (dy / len) * sp };
  } else if (s.state !== 'dead' && s.state !== 'escaped') {
    const p = desiredPoint(world, s);
    if (p) {
      const dx = p.x - s.pos.x;
      const dy = p.y - s.pos.y;
      const d = Math.hypot(dx, dy);
      const sp = Math.min(maxSpeed(world, s), d / 0.35);
      if (d > 1e-4) dv = { x: (dx / d) * sp, y: (dy / d) * sp };
    }
  }
  // Men further back react more slowly; just after an impact the ranks behind carry their
  // momentum forward into the men in front.
  const rear = s.slot && s.slot.r > 0;
  const jolted = u.impactT != null && world.t - u.impactT < 1.2;
  const k = Math.min(1, (rear ? (jolted ? 2.5 : 5) : 8) * dt);
  s.vel.x += (dv.x - s.vel.x) * k;
  s.vel.y += (dv.y - s.vel.y) * k;
  if (s.state === 'dead') {
    s.vel.x *= 0.8;
    s.vel.y *= 0.8;
  }
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  const lagK = Math.min(1, dt / 0.3);
  s.lag.x += (s.pos.x - s.lag.x) * lagK;
  s.lag.y += (s.pos.y - s.lag.y) * lagK;

  // Facing: toward his opponent, his direction of flight, or the unit's front.
  let want = u.heading;
  if (s.target >= 0 && (s.state === 'fighting' || s.state === 'surging' || s.state === 'pursuing' || s.state === 'wavering' || s.state === 'yielding')) {
    const t = world.soldiers[s.target];
    want = Math.atan2(t.pos.y - s.pos.y, t.pos.x - s.pos.x);
  } else if (s.state === 'fleeing' && Math.hypot(s.vel.x, s.vel.y) > 0.3) {
    want = Math.atan2(s.vel.y, s.vel.x);
  }
  if (s.state !== 'dead') s.facing += angleWrap(want - s.facing) * Math.min(1, 6 * dt);
}

function separate(world) {
  const minD = TUNING.bodyRadius * 2;
  const bodies = world.soldiers.filter((s) => !isGone(s));
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d >= minD) continue;
      const push = (minD - d) * 0.5;
      const nx = dx / d;
      const ny = dy / d;
      a.pos.x -= nx * push;
      a.pos.y -= ny * push;
      b.pos.x += nx * push;
      b.pos.y += ny * push;
    }
  }
}

// ---- Units ----

function stepUnit(world, u, dt) {
  const T = TUNING;
  const e = world.units[1 - u.id];
  let present = 0;
  let running = 0;
  let nerveSum = 0;
  let weightSum = 0;
  let staminaSum = 0;
  let wavering = 0;
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (isFormed(s)) {
      present++;
      if (s.state === 'wavering') wavering++;
      const w = s.slot && (s.slot.r === 0 || s.slot.r === u.ranks - 1) ? 1.2 : 1;
      nerveSum += s.nerve * w;
      weightSum += w;
      staminaSum += s.stamina;
    } else if (isRunning(s)) {
      running++;
    }
  }
  u.present = present;
  u.running = running;
  u.nerve = weightSum ? nerveSum / weightSum : 0;
  u.stamina = present ? staminaSum / present : 0;

  const d = frontDistance(u, e);
  u.inContact = u.mode !== 'routed' && e.mode !== 'routed' && d < T.contactRange && d > -2;
  u.sinceBlow += dt;
  if (u.surgeCallT > 0) u.surgeCallT -= dt;
  if (u.haltCallT > 0) u.haltCallT -= dt;
  if (u.haltCooldown > 0) u.haltCooldown -= dt;
  u.momentum *= 1 - 0.05 * dt;
  passTheWord(world, u, dt);
  if (u.surgeCooldown > 0) u.surgeCooldown -= dt;
  if (u.mode === 'pursuing') u.pursuitT += dt;

  const threatened = world.contactT != null || (e.mode !== 'routed' && d < T.approachFear);
  if ((u.mode === 'formed' || u.mode === 'withdrawing') && threatened) {
    const share = running / Math.max(1, present + running);
    if ((share > T.routFleeing && running >= 3) || present <= Math.max(2, Math.round(0.12 * u.members.length))) rout(world, u);
    // A line that loses heart as a charge comes on turns before the impact.
    else if (e.charging && !u.charging && world.contactT == null && (wavering + running) / Math.max(1, present + running) > T.breakOnCharge) rout(world, u);
  }

  u.aiT -= dt;
  if (u.aiT <= 0) {
    u.aiT = 0.5;
    if (!world.result) decideUnit(world, u);
  }
  u.upkeepT -= dt;
  if (u.upkeepT <= 0) {
    u.upkeepT = 0.25;
    if (u.mode !== 'routed') closeRanks(world, u);
  }

  if (u.charging && e.mode === 'routed') {
    // The charge's momentum carries straight on into the pursuit.
    u.charging = false;
    if (!u.pursued) startPursuit(world, u);
  }
  if (u.charging && d <= T.gap + 0.6 && u.mode === 'formed') resolveImpact(world, u, e);

  let v = 0;
  if (u.charging && u.mode === 'formed') {
    v = T.chargePace * (0.6 + 0.4 * u.stamina);
  } else if (u.mode !== 'routed' && u.mode !== 'pursuing') {
    if (u.order === 'advance') {
      if (e.mode === 'routed' || d < -2) v = T.formationPace;
      else if (d > T.gap + 0.05) v = T.formationPace * Math.min(1, 0.25 + (d - T.gap) / 2);
    } else if (u.order === 'back') {
      v = -T.giveGround;
    } else if (u.order === 'withdraw') {
      v = -T.withdrawPace;
    }
  }
  const fw = fwdOf(u.heading);
  u.anchor.x += fw.x * v * dt;
  u.anchor.y += fw.y * v * dt;
  u.speed = v;

  // Give and take: each file's front man drifts back to the line between blows, and a line
  // being pushed back all along its front gives ground as a whole (the other side takes it).
  if (u.mode === 'formed' || u.mode === 'withdrawing') {
    let sum = 0;
    let n = 0;
    for (let f = 0; f < u.files; f++) {
      if (u.grid[0][f] < 0) continue;
      sum += u.give[f];
      n++;
    }
    const mean = n ? sum / n : 0;
    let shift = 0;
    if (u.inContact && Math.abs(mean) > 0.1) {
      shift = mean * T.groundShift * dt;
      if (shift < 0 && d < T.gap) shift = 0;
    }
    for (let f = 0; f < u.files; f++) u.give[f] -= shift + u.give[f] * 0.03 * dt;
    u.anchor.x -= fw.x * shift;
    u.anchor.y -= fw.y * shift;
  }

  // A crush: the ranks behind shoving on a front rank that wants out jumbles the formation.
  if (u.inContact && u.mode === 'formed') {
    let front = 0;
    let crushed = 0;
    for (let f = 0; f < u.files; f++) {
      const s = occupant(world, u, f, 0);
      if (!s) continue;
      front++;
      if (s.pinnedT > 1) crushed++;
    }
    if (front) u.cohesion -= 0.02 * (crushed / front) * dt;
  }

  // Pushing on after an enemy who is giving ground, while men are fighting, loosens the ranks.
  if (u.inContact && u.speed > 0 && world.inPulse) u.cohesion -= 0.03 * dt;

  if (u.charging) u.cohesion -= T.cohesionLossRun * (1.2 - 0.4 * u.nerve) * dt;
  else if (u.speed === 0 && u.mode === 'formed') u.cohesion += (u.inContact ? 0.25 : 1) * T.cohesionRecover * dt;
  else if (u.speed < 0 && u.inContact) u.cohesion -= 0.01 * dt;
  u.cohesion = clamp(u.cohesion, 0.2, 1);

  let turn = 0;
  if (u.ai && u.mode !== 'routed' && e.mode !== 'routed') {
    const want = Math.atan2(e.anchor.y - u.anchor.y, e.anchor.x - u.anchor.x);
    turn = clamp(angleWrap(want - u.heading) * 2, -1, 1);
  } else if (!u.ai && u.mode !== 'routed') {
    turn = u.turn;
  }
  u.heading = angleWrap(u.heading + (turn * T.turnRate / (1 + u.files * 0.08)) * dt);
}

function frontWidth(world, u) {
  let n = 0;
  for (let f = 0; f < u.files; f++) if (occupant(world, u, f, 0)) n++;
  return n;
}

function stepPulses(world) {
  const [a, b] = world.units;
  if (a.inContact && b.inContact && world.contactT == null && !a.charging && !b.charging) {
    world.contactT = world.t;
    world.lullStartT = world.t;
    logEvent(world, 'contact', world.impactAt != null
      ? 'After the clash the lines settle a spear\'s length apart.'
      : 'The lines meet. Neither side wants to be the first into the gap.');
  }
  if (world.contactT == null) return;
  notePinned(world);
  if (!world.overlapNoted && a.inContact) {
    const wa = frontWidth(world, a);
    const wb = frontWidth(world, b);
    if (Math.abs(wa - wb) >= 2) {
      world.overlapNoted = true;
      const wide = wa > wb ? a : b;
      const narrow = wa > wb ? b : a;
      logEvent(world, 'overlap', `The ${wide.adjective} line is wider and overlaps the ${narrow.short} at the ends.`);
    }
  }
  let fighting = 0;
  let sx = 0;
  let sy = 0;
  for (const s of world.soldiers) {
    if (s.state === 'fighting') {
      fighting++;
      sx += s.pos.x;
      sy += s.pos.y;
    }
  }
  const frontage = Math.min(a.files, b.files);
  const hi = Math.max(4, Math.round(0.6 * frontage));
  const lo = Math.max(1, Math.round(0.15 * frontage));
  if (world.inPulse && fighting > lo) world.quietT = 0;
  if (world.lullPending && !world.inPulse && world.t - world.lullStartT > 8) {
    world.lullPending = false;
    const yielded = world.units.find((u) => u.lastHaltT != null && world.t - u.lastHaltT < 16);
    logEvent(world, 'lull', yielded
      ? `The ${yielded.short} have stepped back out of reach; the lines stand apart, catching their breath.`
      : 'The fighting has died down; the lines stand apart, catching their breath.');
  }
  if (!world.inPulse && fighting >= hi && !world.result) {
    const longLull = world.t - (world.lullStartT || 0) > 8;
    world.lullPending = false;
    world.inPulse = true;
    world.pulses++;
    world.pulseStartT = world.t;
    world.marks.push({ t: world.t, x: sx / fighting, y: sy / fighting, kind: 'surge', n: world.pulses });
    const first = world.surgeLog.find((x) => x.t >= (world.lullStartT || 0) - 0.5);
    // After a real lull, say who started the fighting again; quick flare-ups go unremarked.
    if (longLull || world.pulses === 1) {
      const story = surgeStory(world, first);
      logEvent(world, 'surge', story[0].toUpperCase() + story.slice(1), first ? { unit: world.soldiers[first.id].unit } : undefined);
    }
  } else if (world.inPulse && fighting <= lo) {
    // Only a pause that lasts counts as a lull, not a moment's breath in the middle of a surge.
    world.quietT = (world.quietT || 0) + TUNING.dt;
    if (world.quietT < 2) return;
    world.quietT = 0;
    world.inPulse = false;
    world.lullStartT = world.t - 2;
    // Only note the lulls that last; brief pauses are part of the give and take.
    world.lullPending = true;
  }
}

// How hard a unit's rear ranks are pressing forward, averaged over the men behind the front.
function pressureOf(world, u) {
  let sum = 0;
  let n = 0;
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (!s.slot || s.slot.r === 0 || !isFormed(s)) continue;
    sum += s.resolve * (1 - s.halt);
    n++;
  }
  return n ? sum / n : 0;
}

// The first time the men at the back of a unit refuse to give way to a tired front rank.
function notePinned(world) {
  for (const u of world.units) {
    if (u.pinnedLogged || !u.inContact) continue;
    let pinned = 0;
    let front = 0;
    for (let f = 0; f < u.files; f++) {
      const s = occupant(world, u, f, 0);
      if (!s) continue;
      front++;
      if (s.pinnedT > 3) pinned++;
    }
    if (front && pinned / front > 0.3) {
      u.pinnedLogged = true;
      logEvent(world, 'pinned', `The ${u.short} at the back won't give way: their exhausted front rank calls for a breather but is held in the fight.`, { unit: u.id });
    }
  }
}

function surgeStory(world, rec) {
  if (!rec && world.impactAt != null && world.pulses === 1) return 'the shock of the charge throws the front ranks into each other.';
  if (!rec) return 'men step into the gap and the fighting flares up.';
  const s = world.soldiers[rec.id];
  const t = rec.target >= 0 ? world.soldiers[rec.target] : null;
  const enemy = world.units[1 - s.unit].adjective;
  const who = `${s.name} of ${s.origin}`;
  const pressing = pressureOf(world, world.units[s.unit]) > 0.6;
  const follow = pressing ? 'and the ranks behind push the line on after him.' : 'and the men beside him follow.';
  switch (rec.reason) {
    case 'turned': return `${who} catches ${t ? t.name : `a ${enemy}`} stepping back and lunges after him, ${follow}`;
    case 'wavering': return `${who} goes for a wavering ${enemy}, ${follow}`;
    case 'wounded': return `${who} goes for a wounded ${enemy}, ${follow}`;
    case 'exhausted': return `${who} sees an exhausted ${enemy} and goes for him, ${follow}`;
    case 'gap': return `${who} sees a gap in the ${enemy} line and goes for it, ${follow}`;
    case 'called': return `${who} answers the call and steps into the gap, and the line goes with him.`;
    case 'counter': return `${who} throws back the attack and goes forward himself, ${follow}`;
    case 'pushed': return `the ${world.units[s.unit].short} at the back push forward and drive their front rank on, ${who} first among them.`;
    case 'pressed': return `pushed on by the men behind, ${who} finds himself within spear reach and has to fight.`;
    case 'fresh': return `a fresh man, ${who}, pushes through to the front and goes in.`;
    default: return `${who} works up his courage and steps into the gap, ${follow}`;
  }
}

// ---- Ending ----

const CAUSE_TEXT = {
  approach: 'the sight of the enemy coming on',
  impact: 'the shock of the charge',
  casualties: 'seeing friends fall beside them',
  wounds: 'their own wounds',
  exposure: 'enemies on their flank and too many attackers per man',
  fatigue: 'exhaustion',
  panic: 'men breaking and running beside them',
  leader: 'losing their leader',
  fighting: 'the strain of close fighting',
  ground: 'giving ground under pressure',
};

export function topCauses(u, n = 3) {
  const total = Object.values(u.causes).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(u.causes)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([k, v]) => ({ key: k, text: CAUSE_TEXT[k] || k, share: v / total }));
}

function finish(world, type, winner, loser) {
  const decidedAt = loser && loser.decisionT != null ? loser.decisionT : world.t;
  const sides = world.units.map((u) => {
    const men = u.members.map((id) => world.soldiers[id]);
    return {
      name: u.name,
      short: u.short,
      start: men.length,
      killedFight: men.filter((s) => s.state === 'dead' && s.deathPhase === 'fight').length,
      killedPursuit: men.filter((s) => s.state === 'dead' && s.deathPhase === 'pursuit').length,
      wounded: men.filter((s) => s.state !== 'dead' && s.wounds.length > 0).length,
      fled: men.filter((s) => s.record.fled > 0).length,
      causes: topCauses(u),
      deadFront: men.filter((s) => s.state === 'dead' && s.startRank === 0).length,
      deadRear: men.filter((s) => s.state === 'dead' && s.startRank === u.ranks - 1).length,
    };
  });
  const heroes = world.soldiers
    .filter((s) => s.record.kills > 0)
    .sort((a, b) => b.record.kills - a.record.kills)
    .slice(0, 3)
    .map((s) => ({ id: s.id, name: s.name, origin: s.origin, side: s.side, kills: s.record.kills, alive: s.state !== 'dead' }));
  const fallenVeterans = world.soldiers.filter((s) => s.veteran && s.state === 'dead').map((s) => ({ id: s.id, name: s.name, side: s.side }));
  let headline = 'Neither side would close again. The lines drew apart.';
  if (type === 'rout') headline = `The ${loser.short} broke and ran. The ${winner.short} hold the field.`;
  if (type === 'rout' && loser.routDistance != null) {
    headline = `The ${loser.short} broke before the lines met, with the enemy ${Math.max(0, Math.round(loser.routDistance))} m away.`;
  }
  if (type === 'withdrawal') headline = `The ${loser.short} withdrew in order. The ${winner.short} hold the field.`;
  world.result = {
    type,
    winner: winner ? winner.id : -1,
    loser: loser ? loser.id : -1,
    headline,
    contactAt: world.contactT,
    decidedAt,
    duration: world.contactT != null ? decidedAt - world.contactT : 0,
    endedAt: world.t,
    pulses: world.pulses,
    beforeContact: world.contactT == null,
    routDistance: loser ? loser.routDistance : null,
    charges: world.charges,
    sides,
    heroes,
    fallenVeterans,
  };
  logEvent(world, 'end', headline);
  // Once it's decided, anyone still stepping back halts where they are.
  for (const u of world.units) {
    if (u.mode === 'withdrawing') u.mode = 'formed';
    if (u.mode === 'formed') u.order = 'hold';
  }
}

// The moment a charge arrives. The harder a side hits relative to the other, the bigger the
// shock to the other side's nerve. A counter-charge cancels much of that one-sided shock,
// but both sides arrive disordered and the first exchange is more violent for everyone.
function resolveImpact(world, u, e) {
  const T = TUNING;
  const force = (x) => (x.charging ? x.cohesion * (0.5 + 0.5 * x.stamina) : 0);
  const fu = force(u);
  const fe = force(e);
  const braced = (x) => !x.charging && x.order === 'hold' && x.mode === 'formed';
  world.impactAt = world.t;
  if (u.charging && e.charging) logEvent(world, 'impact', 'Both lines crash together at a run.');
  else logEvent(world, 'impact', `The ${u.short} crash into the ${e.short}` + (braced(e) ? ', who meet them braced behind their shields.' : '.'));

  for (const [side, mine, theirs] of [[u, fu, fe], [e, fe, fu]]) {
    const brace = braced(side) ? 0.7 : 1;
    const shock = (T.shockBase * Math.max(0, theirs - 0.7 * mine) + 0.06 * theirs) * brace;
    for (const id of side.members) {
      const s = world.soldiers[id];
      if (!isFormed(s)) continue;
      const placeFactor = s.slot && s.slot.r === 0 ? 1.3 : 0.8;
      shiftNerve(world, s, -shock * placeFactor * (1.3 - s.courage), 'impact');
    }
    // Being hit disorders a line; so does arriving at a run yourself.
    side.cohesion = clamp(side.cohesion - 0.15 * theirs * brace - 0.25 * mine, 0.2, 1);
    // The front rank is driven back by the blow and the ranks behind have to give with it;
    // a side that arrived at a run is driven back less.
    side.impactT = world.t;
    const fw = fwdOf(side.heading);
    for (let f = 0; f < side.files; f++) {
      side.give[f] = clamp(side.give[f] + 0.9 * theirs * brace - 0.4 * mine, -0.8, 1.6);
      const s = occupant(world, side, f, 0);
      if (s) {
        s.vel.x -= fw.x * 1.8 * theirs * brace;
        s.vel.y -= fw.y * 1.8 * theirs * brace;
      }
    }
  }

  // Every front-rank man meets the enemy at once; men arriving at a run strike harder.
  for (const [side, mine, other] of [[u, fu, e], [e, fe, u]]) {
    const bonus = 1 + T.impactBonus * mine * (braced(other) ? 0.6 : 1);
    for (let f = 0; f < side.files; f++) {
      const s = occupant(world, side, f, 0);
      if (!s || s.state !== 'inRank') continue;
      s.state = 'fighting';
      s.stateT = 0;
      s.aggressor = true;
      s.fightT = 0;
      s.resolve = 0.6 + 0.4 * mine;
      s.target = chooseTarget(world, s, T.surgeSearch);
      if (s.target >= 0) resolveBlow(world, s, world.soldiers[s.target], false, bonus);
    }
  }
  for (const side of [u, e]) {
    side.charging = false;
    side.bracing = false;
    if (side.mode === 'formed') side.order = 'hold';
  }
}

function checkEnd(world) {
  const T = TUNING;
  if (world.result) return;
  const [a, b] = world.units;
  for (const u of world.units) {
    const e = world.units[1 - u.id];
    if (u.mode !== 'routed') continue;
    const since = world.t - u.routT;
    if ((since > 6 && e.mode !== 'pursuing') || since > T.pursuitTime + 10) {
      finish(world, 'rout', e, u);
      return;
    }
  }
  if (a.mode === 'withdrawing' && b.mode === 'withdrawing' && Math.abs(frontDistance(a, b)) > T.endDistance) {
    finish(world, 'standoff', null, null);
    return;
  }
  for (const u of world.units) {
    const e = world.units[1 - u.id];
    if (u.mode !== 'withdrawing' || e.mode === 'withdrawing') continue;
    if (frontDistance(e, u) > T.endDistance) {
      if (u.withdrawReason === 'standoff') finish(world, 'standoff', null, null);
      else finish(world, 'withdrawal', e, u);
      return;
    }
  }
  if (world.contactT != null && world.t - world.contactT > T.maxBattle) finish(world, 'standoff', null, null);
  else if (world.contactT == null && world.t > 240) finish(world, 'standoff', null, null);
}

// ---- One fixed simulation step ----

export function stepBattle(world) {
  if (world.phase !== 'battle') return;
  const dt = TUNING.dt;
  world.t += dt;
  for (const s of world.soldiers) {
    s.prev.x = s.pos.x;
    s.prev.y = s.pos.y;
  }
  perceive(world);
  computeAttackers(world);
  // Alternate the processing order every step so neither side always acts first.
  const flip = world.step++ % 2 === 1;
  const units = flip ? [...world.units].reverse() : world.units;
  const men = flip ? [...world.soldiers].reverse() : world.soldiers;
  for (const u of units) stepUnit(world, u, dt);
  for (const s of men) if (!isGone(s)) stepSoldier(world, s, dt);
  computeAttackers(world);
  runBlows(world, dt, men);
  for (const s of world.soldiers) if (s.state !== 'escaped') moveSoldier(world, s, dt);
  separate(world);
  stepPulses(world);
  checkEnd(world);
  if (world.marks.length > 200) world.marks.splice(0, world.marks.length - 200);
}

export function runToEnd(world, extra = 0) {
  if (world.phase === 'setup') startBattle(world);
  const limit = (TUNING.maxBattle + 300) / TUNING.dt;
  for (let i = 0; i < limit && !world.result; i++) stepBattle(world);
  for (let i = 0; i < extra / TUNING.dt; i++) stepBattle(world);
  return world.result;
}
