import { makeRng } from './rng.js';
import { TUNING, SHIELDS, ARMOUR } from './rules.js';
import { isFormed, isGone, isRunning, dist, fwdOf, rightOf, angleWrap, clamp, shiftNerve, logEvent } from './core.js';
import { createSoldier } from './soldier.js';
import { SIDES } from './names.js';
import {
  createUnit, slotWorld, occupant, placeInSlot, vacateSlot, frontDistance, arrange,
  closeRanks, rearSlot, handleLeaderLoss, nameOf,
} from './unit.js';
import { reachOf, computeAttackers, threatsTo, chooseTarget, closestOf, runBlows, resolveBlow } from './combat.js';
import { updateNerve, heldInPlace } from './nerve.js';
import { findOpening, resolveRate, spendResolve, stepRearMan, passTheWord } from './resolve.js';
import { decideContingent, rout, recoil, startPursuit } from './ai.js';

export const DEFAULT_CONFIG = {
  seed: 403,
  sides: [
    {
      depth: 4,
      placement: 'xenophon',
      lead: -1, // the contingent the player leads; -1 leaves the whole side to the AI
      contingents: [
        { name: 'Erechtheis', count: 16, quality: 'veteran', kit: 'well' },
        { name: 'Aigeis', count: 16, quality: 'green', kit: 'poor' },
        { name: 'Pandionis', count: 16, quality: 'veteran', kit: 'well' },
      ],
    },
    {
      depth: 4,
      placement: 'random',
      lead: -1,
      contingents: [
        { name: 'Thebans', count: 24, quality: 'regular', kit: 'standard' },
        { name: 'Thespians', count: 24, quality: 'regular', kit: 'standard' },
      ],
    },
  ],
};

// Older configs gave a side a man count and a frontage; turn that into a single contingent.
// Older configs said only whether the player commanded the side; he now leads one contingent.
export function normaliseSide(side, i) {
  const lead = side.lead ?? (side.ai === false ? 0 : -1);
  if (side.contingents) return { ...side, lead: lead < side.contingents.length ? lead : -1 };
  const depth = Math.max(1, Math.ceil(side.count / clamp(side.files, 2, side.count)));
  return {
    depth,
    placement: side.placement,
    lead,
    contingents: [{ name: SIDES[i].contingents[0], count: side.count, quality: 'regular', kit: 'standard' }],
  };
}

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
    inputs: [], // everything the player did, with the step it happened on
    timeline: [], // a snapshot of both sides every few seconds
    pulses: 0,
    inPulse: false,
    pulseStartT: 0,
    overlapNoted: false,
    blows: 0,
    result: null,
  };
  const half = TUNING.startDistance / 2;
  cfg.sides = cfg.sides.map(normaliseSide);
  cfg.sides.forEach((side, i) => {
    // Contingents stand side by side at the same depth, each as wide as its numbers need.
    const ranks = clamp(Math.round(side.depth), 1, 16);
    let file = 0;
    const contingents = side.contingents.map((c) => {
      const width = Math.max(1, Math.ceil(c.count / ranks));
      const town = SIDES[i].contingentTowns && SIDES[i].contingentTowns[c.name];
      const out = { ...c, file0: file, file1: file + width, origins: town ? [town] : null };
      file += width;
      return out;
    });
    const anchor = i === 0 ? { x: -half, y: 0 } : { x: half, y: 0 };
    const u = createUnit(i, i, { files: file, ranks, lead: side.lead, contingents }, anchor, i === 0 ? 0 : Math.PI);
    const used = new Set();
    contingents.forEach((c, k) => {
      for (let n = 0; n < c.count; n++) {
        const s = createSoldier(rng, world.soldiers.length, i, i, used, { index: k, quality: c.quality, kit: c.kit, origins: c.origins });
        world.soldiers.push(s);
        u.members.push(s.id);
        u.contingents[k].members.push(s.id);
      }
      u.contingents[k].present = c.count;
    });
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
    // When a whole contingent goes, the men beside it have already felt the hole open
    // (routContingent); each man running past does not shake them all over again.
    if (why === 'rout' && o.contingent !== s.contingent) continue;
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
  handleLeaderLoss(world, u, s, 'fled');
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
  const c = u.contingents[s.contingent];
  const rng = world.rng;
  s.stateT += dt;
  const attackers = threatsTo(world, s);
  // A front-rank man who has had enough, while he is still at it, calls for the line to ease off.
  // Once he is resting in a lull he is having his break and stops calling.
  const engaged = s.state === 'fighting' || s.state === 'surging' || s.state === 'recoiling' || attackers.length > 0;
  s.wantsOut = !!(s.slot && s.slot.r === 0 && isFormed(s) && c.inContact && (
    s.state === 'recoiling' || s.state === 'wavering' || s.state === 'yielding'
    || (engaged && (s.stamina < 0.4 || s.health < 0.5 || (!s.aggressor && s.fightT > 4)))));
  s.pinnedT = s.wantsOut ? s.pinnedT + dt : 0;
  const rest = () => {
    if (c.charging) s.stamina = Math.max(0, s.stamina - T.staminaRun * fatigueMul(s) * dt);
    else s.stamina = Math.min(s.staminaCap, s.stamina + T.staminaRecover * dt);
  };

  switch (s.state) {
    case 'inRank': {
      rest();
      if (attackers.length && s.slot) {
        // A tired or resting man, or one whose unit is giving ground, steps back behind his
        // shield rather than trade blows, if there is room behind him. Otherwise he fights.
        const tired = c.yielding || s.stamina < 0.5 || s.breathT > 0;
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
      if (s.slot && c.inContact && s.stateT > 0.5 && enemyInReach(s)) {
        setState(s, 'fighting');
        s.aggressor = true;
        s.fightT = 0;
        s.noTargetT = 0;
        s.target = -1;
        s.resolve = Math.max(s.resolve, 0.4);
        s.surgeReason = 'pressed';
        break;
      }
      if (!s.slot || c.mode !== 'formed' || c.order === 'back' || c.charging) {
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
      if (c.mode !== 'formed' || c.order === 'back') {
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
      if (s.fleeT > 5 && u.mode !== 'routed' && u.contingents[s.contingent].mode !== 'routed' && s.nerveCap >= 0.35 && nearestHostile(world, s) > 25) {
        setState(s, 'rallying');
      }
      break;
    }

    case 'rallying': {
      rest();
      shiftNerve(world, s, 0.035 * dt);
      if (u.mode === 'routed' || u.contingents[s.contingent].mode === 'routed' || nearestHostile(world, s) < 12) {
        setState(s, 'fleeing');
        s.fleeT = 0;
        break;
      }
      if (s.nerve >= T.nerveRally && c.mode === 'formed') {
        const back = rearSlot(u, s.contingent);
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
    if (u.mode === 'routed' || u.contingents[s.contingent].mode === 'routed') {
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
// The nearest man of the enemy front rank.
function opposite(world, u, s) {
  const e = world.units[1 - u.id];
  let best = null, bd = 6;
  for (const id of e.grid[0]) {
    if (id < 0) continue;
    const o = world.soldiers[id];
    const d = dist(o.pos, s.pos);
    if (d < bd) { bd = d; best = o; }
  }
  return best || {};
}

function shapeHome(world, u, s, slot, fw) {
  const T = TUNING;
  const c = u.contingents[s.contingent];
  let h = slot;
  if (c.cohesion < 0.98) {
    const loose = (1 - c.cohesion) * 1.4;
    const a = Math.sin(s.id * 12.9898) * 0.5;
    const b = Math.cos(s.id * 78.233) * 0.35;
    h = { x: h.x + (fw.x * a - fw.y * b) * loose, y: h.y + (fw.y * a + fw.x * b) * loose };
  }
  const depth = (p) => (p.x - u.anchor.x) * fw.x + (p.y - u.anchor.y) * fw.y;
  const base = depth(h);
  let want = base;
  const rs = T.rankSpacing;
  // A contingent shakier than the rest of the line edges back behind its shields, front and
  // rear alike, and that stretch of the line sags back from the enemy.
  s.hang = (s.state === 'inRank' || s.state === 'wavering') && c.inContact && c.mode === 'formed' ? T.hangBack * clamp((u.nerve - c.nerve) / 0.15, 0, 1) : 0;
  want -= s.hang;
  if (s.slot.r === 0) {
    // ...and the enemy opposite follows them in, so the line bends rather than drifting apart.
    const follow = c.inContact && isFormed(s) ? opposite(world, u, s).hang || 0 : 0;
    want += follow;
    want -= u.give[s.slot.f];
    if (s.state === 'yielding') want -= 1.2;
    // Leaning in as he works himself up to go forward.
    if (s.state === 'inRank' && c.inContact) want += Math.min(0.3, s.resolve * 0.3);
    // Between surges he would not choose to stand inside spear reach of the enemy line.
    want = Math.min(want, base + 0.35 + follow);
  } else {
    // Eager men press up behind the man in front; men who have heard the word ease back.
    // Only men who are really worked up push forward; the merely restless keep their places.
    if (c.inContact && isFormed(s)) want += T.pressForward * Math.max(0, s.resolve - 0.4) / 0.6 * (1 - s.halt);
    // Men who have heard the word step back themselves, making room for the men in front.
    if (c.inContact && isFormed(s)) want -= 0.8 * s.halt * (0.4 + 0.6 * (s.discipline || 0));
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
      return (world.units[s.unit].contingents[s.contingent].charging ? T.run : T.walk) * s.speedMul;
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
  const impactT = u.contingents[s.contingent].impactT;
  const jolted = impactT != null && world.t - impactT < 1.2;
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

// A side is a line of files; its contingents each stand on their own block of it, under their
// own leaders. The side itself only keeps the line's place and facing and adds up its men.
function stepUnit(world, u, dt) {
  const T = TUNING;
  const e = world.units[1 - u.id];
  let present = 0;
  let running = 0;
  let nerveSum = 0;
  let weightSum = 0;
  let staminaSum = 0;
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (isFormed(s)) {
      present++;
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
  u.sinceBlow += dt;
  u.momentum *= 1 - 0.05 * dt;

  for (const c of u.contingents) stepContingent(world, u, c, e, dt);
  u.inContact = u.contingents.some((c) => c.inContact);
  passTheWord(world, u, dt);

  // The side gives way as a whole when every contingent has broken, or when so few men are
  // left in its line that the rest give up.
  const live = u.contingents.filter((c) => c.mode !== 'routed');
  if (u.mode !== 'routed') {
    if (!live.length) rout(world, u, u.contingents.length > 1 ? 'running' : u.contingents[0].routNote || 'running');
    else if (world.contactT != null && !live.some((c) => c.mode === 'pursuing') && present <= Math.max(2, Math.round(0.12 * u.members.length))) rout(world, u, 'few');
  }
  // What the side as a whole is doing, for the record and the end of the battle.
  if (u.mode !== 'routed') {
    if (e.mode === 'routed' && live.some((c) => c.mode === 'pursuing')) u.mode = 'pursuing';
    else if (live.every((c) => c.mode === 'withdrawing' || c.mode === 'out')) u.mode = 'withdrawing';
    else u.mode = 'formed';
    if (u.mode === 'withdrawing' && u.decisionT == null) u.decisionT = world.t;
    if (u.mode === 'formed') u.decisionT = null;
  }
  const lead = live.find((c) => !c.ai) || live[0] || u.contingents[0];
  u.order = lead.order;
  u.charging = u.contingents.some((c) => c.charging);
  u.yielding = lead.yielding;
  const weight = live.reduce((a, c) => a + c.present, 0);
  u.cohesion = weight ? live.reduce((a, c) => a + c.cohesion * c.present, 0) / weight : lead.cohesion;

  u.upkeepT -= dt;
  if (u.upkeepT <= 0) {
    u.upkeepT = 0.25;
    if (u.mode !== 'routed') closeRanks(world, u);
  }

  // Keep the side's reference point in the middle of its line, so the line wheels about its
  // centre however far its contingents have got out of step.
  const fw = fwdOf(u.heading);
  const mean = live.length ? live.reduce((a, c) => a + c.shift, 0) / live.length : 0;
  u.anchor.x += fw.x * mean;
  u.anchor.y += fw.y * mean;
  for (const c of u.contingents) c.shift -= mean;
  u.speed = lead.speed;

  // The whole line slowly turns to face the enemy. Only a player leading the whole line can
  // wheel it himself.
  let turn = 0;
  if (u.mode !== 'routed' && e.mode !== 'routed') {
    if (u.ai || u.contingents.length > 1) {
      const want = Math.atan2(e.anchor.y - u.anchor.y, e.anchor.x - u.anchor.x);
      turn = clamp(angleWrap(want - u.heading) * 2, -1, 1);
    } else {
      turn = u.turn;
    }
  }
  u.heading = angleWrap(u.heading + (turn * T.turnRate / (1 + u.files * 0.08)) * dt);
}

// How far in front of each of c's files the enemy front stands, and which enemy contingent
// stands there. Files facing a hole, or beyond the end of the enemy line, face nobody.
function measureFacing(world, u, c, e) {
  const T = TUNING;
  const fw = fwdOf(u.heading);
  const ert = rightOf(e.heading);
  let best = Infinity;
  let facing = -1;
  for (let f = c.file0; f < c.file1; f++) {
    const p = slotWorld(u, f, 0);
    const lat = (p.x - e.anchor.x) * ert.x + (p.y - e.anchor.y) * ert.y;
    const fe = Math.round(lat / T.fileSpacing + (e.files - 1) / 2);
    if (fe < -1 || fe > e.files) continue;
    const g = clamp(fe, 0, e.files - 1);
    const ec = e.contingents[e.fileOwner[g]];
    if (ec.mode === 'routed' || ec.mode === 'out' || ec.mode === 'pursuing') continue;
    const q = slotWorld(e, g, 0);
    const d = (q.x - p.x) * fw.x + (q.y - p.y) * fw.y;
    if (d < best) {
      best = d;
      facing = ec.index;
    }
  }
  c.d = best;
  c.facing = facing;
}

// One contingent: its men, the enemy in front of it, its leader's decisions and its ground.
function stepContingent(world, u, c, e, dt) {
  const T = TUNING;
  let present = 0;
  let running = 0;
  let wavering = 0;
  let nerve = 0;
  let stamina = 0;
  for (const id of c.members) {
    const s = world.soldiers[id];
    if (isFormed(s)) {
      present++;
      nerve += s.nerve;
      stamina += s.stamina;
      if (s.state === 'wavering') wavering++;
    } else if (isRunning(s)) {
      running++;
    }
  }
  c.present = present;
  c.running = running;
  c.wavering = wavering;
  c.nerve = present ? nerve / present : 0;
  c.stamina = present ? stamina / present : 0;
  if (c.surgeCallT > 0) c.surgeCallT -= dt;
  if (c.haltCallT > 0) c.haltCallT -= dt;
  if (c.haltCooldown > 0) c.haltCooldown -= dt;
  if (c.surgeCooldown > 0) c.surgeCooldown -= dt;
  if (c.mode === 'pursuing') c.pursuitT += dt;

  measureFacing(world, u, c, e);
  const ec = c.facing >= 0 ? e.contingents[c.facing] : null;
  c.inContact = (c.mode === 'formed' || c.mode === 'withdrawing') && c.d < T.contactRange && c.d > -2;
  if (c.inContact) c.contacted = true;

  // Breaking: when enough of its men run, the rest go with them.
  const threatened = world.contactT != null || c.d < T.approachFear;
  if (c.mode !== 'routed' && c.mode !== 'pursuing' && threatened) {
    const share = running / Math.max(1, present + running);
    if (share > T.routFleeing && running >= 3) routContingent(world, u, c, 'running');
    else if (present <= Math.max(1, Math.round(0.12 * c.members.length))) routContingent(world, u, c, 'few');
    // A line that loses heart as a charge comes on turns before the impact.
    else if (ec && ec.charging && !c.charging && !c.contacted && (wavering + running) / Math.max(1, present + running) > T.breakOnCharge) routContingent(world, u, c, 'charge');
  }

  c.aiT -= dt;
  if (c.aiT <= 0) {
    c.aiT = 0.5;
    if (!world.result) decideContingent(world, u, c);
  }

  if (c.charging && (!ec || e.mode === 'routed')) {
    // The charge's momentum carries straight on into the pursuit, or runs out.
    c.charging = false;
    if (e.mode === 'routed' && !c.pursued) startPursuit(world, u, c);
  }
  if (c.charging && c.d <= T.gap + 0.6 && c.mode === 'formed') resolveImpact(world, u, c);

  let v = 0;
  if (c.charging && c.mode === 'formed') {
    v = T.chargePace * (0.6 + 0.4 * c.stamina);
  } else if (c.mode === 'formed' || c.mode === 'withdrawing') {
    if (c.order === 'advance') {
      if (e.mode === 'routed' || c.d < -2) v = T.formationPace;
      else if (c.d > T.gap + 0.05 && Number.isFinite(c.d)) v = T.formationPace * Math.min(1, 0.25 + (c.d - T.gap) / 2);
    } else if (c.order === 'back') {
      v = -T.giveGround;
    } else if (c.order === 'withdraw') {
      v = -T.withdrawPace;
    }
  }
  c.shift += v * dt;
  c.ground += v * dt;
  c.speed = v;

  // Give and take: each file's front man drifts back to the line between blows, and a front
  // being pushed back all along gives ground as a whole (the enemy takes it).
  if (c.mode === 'formed' || c.mode === 'withdrawing') {
    let sum = 0;
    let n = 0;
    for (let f = c.file0; f < c.file1; f++) {
      if (u.grid[0][f] < 0) continue;
      sum += u.give[f];
      n++;
    }
    const mean = n ? sum / n : 0;
    let shift = 0;
    if (c.inContact && Math.abs(mean) > 0.1) {
      shift = mean * T.groundShift * dt;
      if (shift < 0 && c.d < T.gap) shift = 0;
    }
    for (let f = c.file0; f < c.file1; f++) u.give[f] -= shift + u.give[f] * 0.03 * dt;
    c.shift -= shift;
    c.ground -= shift;
  }

  // A withdrawal is over once the contingent is well clear of the enemy: it has left the field.
  if (c.mode === 'withdrawing') {
    const fw = fwdOf(u.heading);
    const p = slotWorld(u, (c.file0 + c.file1 - 1) / 2, 0);
    const clear = Number.isFinite(c.d) ? c.d : (e.anchor.x - p.x) * fw.x + (e.anchor.y - p.y) * fw.y;
    if (clear > T.endDistance) {
      c.mode = 'out';
      c.order = 'hold';
      c.outT = world.t;
    }
  }

  // A crush: the ranks behind shoving on a front rank that wants out jumbles the formation.
  if (c.inContact && c.mode === 'formed') {
    let front = 0;
    let crushed = 0;
    for (let f = c.file0; f < c.file1; f++) {
      const s = occupant(world, u, f, 0);
      if (!s) continue;
      front++;
      if (s.pinnedT > 1) crushed++;
    }
    if (front) c.cohesion -= 0.02 * (crushed / front) * dt;
  }
  // Pushing on after an enemy who is giving ground, while men are fighting, loosens the ranks.
  if (c.inContact && c.speed > 0 && world.inPulse) c.cohesion -= 0.03 * dt;
  if (c.charging) c.cohesion -= T.cohesionLossRun * (1.2 - 0.4 * c.nerve) * dt;
  else if (c.speed === 0 && (c.mode === 'formed' || c.mode === 'out')) c.cohesion += (c.inContact ? 0.25 : 1) * T.cohesionRecover * dt;
  else if (c.speed < 0 && c.inContact) c.cohesion -= 0.01 * dt;
  c.cohesion = clamp(c.cohesion, 0.2, 1);
}

// A contingent can break on its own, leaving a hole in the line where it stood.
function routContingent(world, u, c, why) {
  c.mode = 'routed';
  c.routT = world.t;
  c.routNote = why;
  c.charging = false;
  c.order = 'hold';
  if (u.contingents.length < 2) return;
  if (!world.firstBreak) world.firstBreak = { unit: u.id, contingent: c.index, name: c.name, t: world.t };
  logEvent(world, 'rout', `The ${c.name} break and run, leaving a hole in the ${u.adjective} line!`, { unit: u.id });
  // The men beside the hole feel it most.
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (!isFormed(s) || s.contingent === c.index) continue;
    const f = s.slot ? s.slot.f : -99;
    const beside = f >= c.file0 - 2 && f < c.file1 + 2;
    shiftNerve(world, s, (beside ? -0.1 : -0.04) * (1 - 0.5 * (s.discipline || 0)), 'panic');
  }
}

// How wide the front rank is, end to end (a hole in the middle doesn't make it narrower).
function frontWidth(world, u) {
  let first = -1;
  let last = -1;
  for (let f = 0; f < u.files; f++) {
    if (!occupant(world, u, f, 0)) continue;
    if (first < 0) first = f;
    last = f;
  }
  return first < 0 ? 0 : last - first + 1;
}

function stepPulses(world) {
  const [a, b] = world.units;
  // The battle proper starts when any part of the two lines stands face to face, neither at a run.
  const met = a.contingents.some((c) => c.inContact && !c.charging && c.facing >= 0 && !b.contingents[c.facing].charging);
  if (met && b.inContact && world.contactT == null) {
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
      contingents: u.contingents.map((c) => {
        const cm = c.members.map((id) => world.soldiers[id]);
        return {
          name: c.name,
          quality: c.quality,
          kit: c.kit,
          start: cm.length,
          killedFight: cm.filter((s) => s.state === 'dead' && s.deathPhase === 'fight').length,
          killedPursuit: cm.filter((s) => s.state === 'dead' && s.deathPhase === 'pursuit').length,
          wounded: cm.filter((s) => s.state !== 'dead' && s.wounds.length > 0).length,
          fled: cm.filter((s) => s.record.fled > 0).length,
          brokeAt: c.routT,
        };
      }),
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
  if (type === 'withdrawal' && world.quiet) headline = `The ${loser.short} gave up the field. The ${winner.short} hold it.`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const lost = (u) => u.members.filter((id) => ['dead', 'fleeing', 'escaped', 'rallying'].includes(world.soldiers[id].state)).length;
  let why = '';
  if (type === 'withdrawal' && loser && world.firstBreak && world.firstBreak.unit === loser.id) {
    why = `The ${world.firstBreak.name} broke first, leaving a hole in the line. `;
  }
  if (world.quiet) {
    // The fighting stopped because no part of either line still faced the enemy.
    const goneOf = (u) => u.contingents.filter((c) => c.mode === 'routed' || c.mode === 'out').map((c) => `${c.name} (${c.mode === 'routed' ? 'broken' : 'withdrawn'})`);
    const standing = (u) => u.contingents.filter((c) => c.mode !== 'routed' && c.mode !== 'out').map((c) => c.name);
    why = 'The fighting stopped all along the line, with no part of either line still facing the enemy. ';
    if (loser) why += `The ${loser.short} had lost the ${goneOf(loser).join(' and ')}, and the ${standing(loser).join(' and ')} gave up the field to the ${winner.short}.`;
    else why += 'Neither side had lost clearly more of its line, and they drew apart.';
  } else if (type === 'withdrawal' && loser) {
    // The contingent whose withdrawal ended it, and what made its commander pull back.
    const c = loser.contingents[loser.lastWithdraw ?? 0];
    const n = c.withdrawNote;
    const whose = loser.contingents.length > 1 ? `The commander of the ${c.name}` : `The ${loser.adjective} commander`;
    const others = loser.contingents.filter((k) => k !== c && k.mode === 'out').map((k) => k.name);
    if (others.length) why += `The ${others.join(' and ')} had already pulled back. `;
    if (c.withdrawReason === 'ordered') why += `You ordered the ${nameOf(loser, c)} to withdraw.`;
    else if (n) {
      why += `${whose} pulled his men back when their nerve fell to ${pct(n.nerve)} (the enemy in front of them were at ${pct(n.enemyNerve)})`;
      if (n.running > 0) why += `, with ${n.running} of his men already running`;
      if (n.flank) why += `, after word came that the ${n.flank} beside him had gone`;
      why += lost(loser) < lost(winner) ? `, though the ${winner.short} had lost more men.` : '.';
      if (n.heldOn) why += ' He had already held on past the point he would normally have pulled out.';
    }
  } else if (type === 'rout' && loser) {
    const n = loser.routNote || {};
    const fb = world.firstBreak;
    if (fb && fb.unit === loser.id) why = `The ${fb.name} broke first, leaving a hole in the line. `;
    if (n.why === 'charge') why = `The ${loser.short} lost heart as the charge came on and turned before it struck.`;
    else if (n.why === 'few') why = `So few ${loser.short} were left in the line that the rest gave up.`;
    else why += `The ${loser.short} broke when ${n.running} of their men were running and the panic spread (their nerve was down to ${pct(n.nerve || 0)}, the ${winner.short}' at ${pct(n.enemyNerve || 0)}).`;
  } else if (type === 'standoff' && !world.quiet) {
    const [a, b] = world.units;
    why = `Neither side would start another surge: both were worn down (the ${a.short} at ${pct(a.nerve)} nerve, the ${b.short} at ${pct(b.nerve)}), and they drew apart.`;
  }
  // A contingent can break without taking the rest of its line with it.
  for (const u of world.units) {
    if (u === loser) continue;
    const broken = u.contingents.filter((c) => c.mode === 'routed').map((c) => c.name);
    if (broken.length) why += ` The ${broken.join(' and ')} had broken and left a hole in the ${u.adjective} line, but the rest held.`;
  }

  world.result = {
    type,
    why,
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
    for (const c of u.contingents) {
      if (c.mode === 'withdrawing') c.mode = 'formed';
      if (c.mode === 'formed') c.order = 'hold';
    }
  }
}

// The moment a charge arrives. The harder a side hits relative to the other, the bigger the
// shock to the other side's nerve. A counter-charge cancels much of that one-sided shock,
// but both sides arrive disordered and the first exchange is more violent for everyone.
// A charge strikes the enemy contingents standing in front of the contingent that made it.
function resolveImpact(world, u, c) {
  const e = world.units[1 - u.id];
  const T = TUNING;
  const struck = new Set();
  const ert = rightOf(e.heading);
  for (let f = c.file0; f < c.file1; f++) {
    const p = slotWorld(u, f, 0);
    const lat = (p.x - e.anchor.x) * ert.x + (p.y - e.anchor.y) * ert.y;
    const fe = Math.round(lat / T.fileSpacing + (e.files - 1) / 2);
    if (fe < -1 || fe > e.files) continue;
    const ec = e.contingents[e.fileOwner[clamp(fe, 0, e.files - 1)]];
    if (ec.mode === 'formed' || ec.mode === 'withdrawing') struck.add(ec);
  }
  if (!struck.size && c.facing >= 0) struck.add(e.contingents[c.facing]);
  for (const ec of struck) impact(world, u, c, e, ec);
  c.charging = false;
  c.bracing = false;
  if (c.mode === 'formed') c.order = 'hold';
}

function impact(world, u, c, e, ec) {
  const T = TUNING;
  const force = (x) => (x.charging ? x.cohesion * (0.5 + 0.5 * x.stamina) : 0);
  const fu = force(c);
  const fe = force(ec);
  const braced = (x) => !x.charging && x.order === 'hold' && x.mode === 'formed';
  world.impactAt = world.t;
  const single = u.contingents.length < 2 && e.contingents.length < 2;
  if (c.charging && ec.charging) logEvent(world, 'impact', single ? 'Both lines crash together at a run.' : `The ${nameOf(u, c)} and the ${nameOf(e, ec)} crash together at a run.`);
  else logEvent(world, 'impact', `The ${nameOf(u, c)} crash into the ${nameOf(e, ec)}` + (braced(ec) ? ', who meet them braced behind their shields.' : '.'));

  for (const [side, sc, mine, theirs] of [[u, c, fu, fe], [e, ec, fe, fu]]) {
    const brace = braced(sc) ? 0.7 : 1;
    const shock = (T.shockBase * Math.max(0, theirs - 0.7 * mine) + 0.06 * theirs) * brace;
    for (const id of sc.members) {
      const s = world.soldiers[id];
      if (!isFormed(s)) continue;
      const placeFactor = s.slot && s.slot.r === 0 ? 1.3 : 0.8;
      shiftNerve(world, s, -shock * placeFactor * (1.3 - s.courage), 'impact');
    }
    // Being hit disorders a line; so does arriving at a run yourself.
    sc.cohesion = clamp(sc.cohesion - 0.15 * theirs * brace - 0.25 * mine, 0.2, 1);
    // The front rank is driven back by the blow and the ranks behind have to give with it;
    // a side that arrived at a run is driven back less.
    sc.impactT = world.t;
    const fw = fwdOf(side.heading);
    for (let f = sc.file0; f < sc.file1; f++) {
      side.give[f] = clamp(side.give[f] + 0.9 * theirs * brace - 0.4 * mine, -0.8, 1.6);
      const s = occupant(world, side, f, 0);
      if (s) {
        s.vel.x -= fw.x * 1.8 * theirs * brace;
        s.vel.y -= fw.y * 1.8 * theirs * brace;
      }
    }
  }

  // Every front-rank man meets the enemy at once; men arriving at a run strike harder.
  for (const [side, sc, mine, other] of [[u, c, fu, ec], [e, ec, fe, c]]) {
    const bonus = 1 + T.impactBonus * mine * (braced(other) ? 0.6 : 1);
    for (let f = sc.file0; f < sc.file1; f++) {
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
  ec.charging = false;
  ec.bracing = false;
  if (ec.mode === 'formed') ec.order = 'hold';
}

// A side is beaten when none of its contingents is left facing the enemy: all have broken,
// or withdrawn off the field.
const gone = (u) => u.contingents.every((c) => c.mode === 'routed' || c.mode === 'out');

function checkEnd(world) {
  const T = TUNING;
  if (world.result) return;
  for (const u of world.units) {
    const e = world.units[1 - u.id];
    if (u.mode !== 'routed') continue;
    const since = world.t - u.routT;
    if ((since > 6 && e.mode !== 'pursuing') || since > T.pursuitTime + 10) {
      finish(world, 'rout', e, u);
      return;
    }
  }
  const [a, b] = world.units;
  if (gone(a) && gone(b)) {
    finish(world, 'standoff', null, null);
    return;
  }
  for (const u of world.units) {
    if (u.mode === 'routed' || !gone(u)) continue;
    const out = u.contingents.filter((c) => c.mode === 'out');
    if (out.every((c) => c.withdrawReason === 'standoff')) finish(world, 'standoff', null, null);
    else finish(world, 'withdrawal', world.units[1 - u.id], u);
    return;
  }
  // When no part of either line is left facing the enemy, the fighting is over: the side that
  // has lost more of its line, broken or withdrawn, gives up the field.
  if (world.contactT != null) {
    if (a.inContact || b.inContact) world.lastContactT = world.t;
    else if (world.t - (world.lastContactT ?? world.t) > T.quietEnd) {
      const lostShare = (u) => u.contingents.filter((c) => c.mode === 'routed' || c.mode === 'out').reduce((n, c) => n + c.members.length, 0) / u.members.length;
      const [la, lb] = [lostShare(a), lostShare(b)];
      world.quiet = true;
      if (Math.abs(la - lb) > 0.15) finish(world, 'withdrawal', la > lb ? b : a, la > lb ? a : b);
      else finish(world, 'standoff', null, null);
      return;
    }
  }
  if (world.contactT != null && world.t - world.contactT > T.maxBattle) finish(world, 'standoff', null, null);
  else if (world.contactT == null && world.t > 240) finish(world, 'standoff', null, null);
}

// ---- The battle's timeline, for the record ----

const r2 = (x) => Math.round(x * 100) / 100;

function snapshot(world) {
  world.timeline.push({
    t: Math.round(world.t * 10) / 10,
    pulse: world.inPulse,
    gap: r2(frontDistance(world.units[0], world.units[1])),
    units: world.units.map((u) => {
      const men = u.members.map((id) => world.soldiers[id]);
      const front = men.filter((s) => s.slot && s.slot.r === 0 && isFormed(s));
      const rear = men.filter((s) => s.slot && s.slot.r > 0 && isFormed(s));
      const avg = (list, f) => (list.length ? r2(list.reduce((a, s) => a + f(s), 0) / list.length) : 0);
      const causes = {};
      for (const [k, v] of Object.entries(u.causes)) causes[k] = r2(v / u.members.length);
      return {
        mode: u.mode,
        order: u.order,
        yielding: u.yielding,
        nerve: r2(u.nerve),
        stamina: r2(u.stamina),
        cohesion: r2(u.cohesion),
        inLine: u.present,
        dead: men.filter((s) => s.state === 'dead').length,
        wounded: men.filter((s) => s.state !== 'dead' && s.wounds.length).length,
        running: u.running,
        kills: men.reduce((a, s) => a + s.record.kills, 0),
        frontFighting: front.filter((s) => s.state === 'fighting' || s.state === 'surging').length,
        frontSpent: front.filter((s) => s.wantsOut).length,
        rearEager: avg(rear, (s) => s.resolve * (1 - s.halt)),
        rearHalt: avg(rear, (s) => s.halt),
        leader: u.leaderId >= 0 ? world.soldiers[u.leaderId].name : null,
        contingents: u.contingents.map((c) => ({
          name: c.name,
          mode: c.mode,
          order: c.order,
          ahead: r2(c.shift),
          nerve: r2(c.nerve),
          stamina: r2(c.stamina),
          inLine: c.present,
          running: c.running,
          dead: c.members.filter((id) => world.soldiers[id].state === 'dead').length,
          give: r2(avg(front.filter((s) => s.contingent === c.index), (s) => u.give[s.slot.f])),
        })),
        causes,
      };
    }),
  });
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
  if (world.step % 100 === 0 || (world.result && world.result.endedAt === world.t)) snapshot(world);
  if (world.marks.length > 200) world.marks.splice(0, world.marks.length - 200);
}

export function runToEnd(world, extra = 0) {
  if (world.phase === 'setup') startBattle(world);
  const limit = (TUNING.maxBattle + 300) / TUNING.dt;
  for (let i = 0; i < limit && !world.result; i++) stepBattle(world);
  for (let i = 0; i < extra / TUNING.dt; i++) stepBattle(world);
  return world.result;
}
