import { makeRng } from './rng.js';
import { TUNING, SHIELDS, ARMOUR } from './rules.js';
import { isFormed, isGone, isRunning, dist, fwdOf, angleWrap, clamp, shiftNerve, logEvent } from './core.js';
import { createSoldier } from './soldier.js';
import {
  createUnit, slotWorld, occupant, placeInSlot, vacateSlot, frontDistance, arrange,
  closeRanks, rearSlot, handleLeaderLoss,
} from './unit.js';
import { reachOf, computeAttackers, threatsTo, chooseTarget, closestOf, runBlows } from './combat.js';
import { updateNerve, heldInPlace } from './nerve.js';
import { decideUnit, rout, recoil } from './ai.js';

export const DEFAULT_CONFIG = {
  seed: 424,
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

function nearestFormedEnemyDist(s) {
  let best = Infinity;
  for (const { o, d } of s.enemies) if (isFormed(o) && d < best) best = d;
  return best;
}

function frontNeighboursEngaged(world, u, s) {
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

function fatigueMul(s) {
  return (SHIELDS[s.shield].fatigue + ARMOUR[s.armour].fatigue) / 2;
}

function stepSoldier(world, s, dt) {
  const T = TUNING;
  const u = world.units[s.unit];
  const rng = world.rng;
  s.stateT += dt;
  if (s.cooldown > 0) s.cooldown -= dt;
  const attackers = threatsTo(world, s);
  const rest = () => {
    s.stamina = Math.min(s.staminaCap, s.stamina + T.staminaRecover * dt);
  };

  switch (s.state) {
    case 'inRank': {
      rest();
      if (attackers.length && s.slot) {
        setState(s, 'fighting');
        s.aggressor = false;
        s.fightT = 0;
        s.idleT = 0;
        s.target = closestOf(world, s, attackers);
        break;
      }
      if (!s.slot || s.slot.r !== 0 || u.mode !== 'formed' || s.cooldown > 0 || u.order === 'back') break;
      if (nearestFormedEnemyDist(s) > T.gap + reachOf(s) + 2.5) break;
      const will = s.nerve * (0.5 + s.courage) * Math.pow(s.stamina, 1.5);
      let pull = 0;
      for (const df of [-2, -1, 1, 2]) {
        const nb = occupant(world, u, s.slot.f + df, 0);
        if (nb && (nb.state === 'surging' || nb.state === 'fighting')) pull += (0.5 + nb.reputation) / Math.abs(df);
      }
      const rate = (T.surgeBase + T.surgePull * pull * 0.5 + (u.surgeCallT > 0 ? T.surgeCall : 0)) * will;
      if (rng.chance(rate * dt)) {
        setState(s, 'surging');
        s.aggressor = true;
        s.target = -1;
        s.noTargetT = 0;
        s.fightT = 0;
      }
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
        const endurance = T.fightEndurance + T.fightEnduranceCourage * s.courage;
        const alone = s.slot ? 1 - frontNeighboursEngaged(world, u, s) : 0;
        const pRecoil = (s.fightT > endurance ? 0.6 : 0.04) + (s.fightT > 2 ? 0.5 * alone : 0);
        if (rng.chance(pRecoil * dt)) recoil(s);
      } else {
        // A defender holds his place and fights whoever is attacking him.
        if (attackers.length) {
          if (!attackers.includes(s.target)) s.target = closestOf(world, s, attackers);
          s.idleT = 0;
        } else {
          s.idleT += dt;
          if (s.idleT > 1) {
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
      if (dist(s.pos, slotWorld(u, s.slot.f, s.slot.r)) < 0.3) {
        if (s.state === 'recoiling') s.cooldown = T.lullMin + rng.range(0, T.lullRand);
        setState(s, 'inRank');
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
      const t = s.target >= 0 ? world.soldiers[s.target] : null;
      if (!t || !isRunning(t)) {
        s.target = -1;
        const e = world.units[1 - s.unit];
        let bestD = 30;
        for (const id of e.members) {
          const o = world.soldiers[id];
          if (!isRunning(o)) continue;
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
      if (s.routDelay < 0) s.routDelay = rng.range(0, 2.5);
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

function desiredPoint(world, s) {
  const u = world.units[s.unit];
  const fw = fwdOf(u.heading);
  const home = s.slot ? slotWorld(u, s.slot.f, s.slot.r) : null;
  switch (s.state) {
    case 'inRank':
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

function maxSpeed(s) {
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
      return T.walk * s.speedMul;
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
    const sp = maxSpeed(s);
    dv = { x: (dx / len) * sp, y: (dy / len) * sp };
  } else if (s.state !== 'dead' && s.state !== 'escaped') {
    const p = desiredPoint(world, s);
    if (p) {
      const dx = p.x - s.pos.x;
      const dy = p.y - s.pos.y;
      const d = Math.hypot(dx, dy);
      const sp = Math.min(maxSpeed(s), d / 0.35);
      if (d > 1e-4) dv = { x: (dx / d) * sp, y: (dy / d) * sp };
    }
  }
  const k = Math.min(1, 8 * dt);
  s.vel.x += (dv.x - s.vel.x) * k;
  s.vel.y += (dv.y - s.vel.y) * k;
  if (s.state === 'dead') {
    s.vel.x *= 0.8;
    s.vel.y *= 0.8;
  }
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;

  // Facing: toward his opponent, his direction of flight, or the unit's front.
  let want = u.heading;
  if (s.target >= 0 && (s.state === 'fighting' || s.state === 'surging' || s.state === 'pursuing' || s.state === 'wavering')) {
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

  const d = frontDistance(u, e);
  u.inContact = u.mode !== 'routed' && e.mode !== 'routed' && d < T.contactRange && d > -2;
  u.sinceBlow += dt;
  if (u.surgeCallT > 0) u.surgeCallT -= dt;
  if (u.surgeCooldown > 0) u.surgeCooldown -= dt;
  if (u.mode === 'pursuing') u.pursuitT += dt;

  if ((u.mode === 'formed' || u.mode === 'withdrawing') && world.contactT != null) {
    const share = running / Math.max(1, present + running);
    if ((share > T.routFleeing && running >= 3) || present <= Math.max(2, Math.round(0.12 * u.members.length))) rout(world, u);
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

  let v = 0;
  if (u.mode !== 'routed' && u.mode !== 'pursuing') {
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
  if (a.inContact && b.inContact && world.contactT == null) {
    world.contactT = world.t;
    logEvent(world, 'contact', 'The lines meet. Neither side wants to be the first into the gap.');
  }
  if (world.contactT == null) return;
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
  if (!world.inPulse && fighting >= hi && !world.result) {
    world.inPulse = true;
    world.pulses++;
    world.pulseStartT = world.t;
    world.marks.push({ t: world.t, x: sx / fighting, y: sy / fighting, kind: 'surge', n: world.pulses });
    logEvent(world, 'surge', `Surge ${world.pulses}: men step into the gap and the fighting flares up.`);
  } else if (world.inPulse && fighting <= lo) {
    world.inPulse = false;
    logEvent(world, 'lull', `The lines pull apart after ${Math.round(world.t - world.pulseStartT)} s. A lull.`);
  }
}

// ---- Ending ----

const CAUSE_TEXT = {
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
