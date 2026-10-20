import { makeRng } from './rng.js';
import { TUNING, SHIELDS, ARMOUR, GREAVES, LIGHT, HORSE } from './rules.js';
import { stepWounds, aftermath, diedAfter } from './wounds.js';
import { isFormed, isGone, isFallen, isRunning, dist, fwdOf, rightOf, angleWrap, clamp, shiftNerve, logEvent, windOf, recoveryOf, burdenOf } from './core.js';
import { createSoldier, createPeltast, createRider } from './soldier.js';
import { createLights, stepLights, stepPeltast } from './light.js';
import { createWing, placeWing, stepWing, stepRider, moveRider, isRiding } from './horse.js';
import { SIDES } from './names.js';
import {
  createUnit, slotWorld, occupant, placeInSlot, vacateSlot, frontDistance, arrange,
  closeRanks, rearSlot, handleLeaderLoss, depthAt, facingOf, fileDepth,
} from './unit.js';
import { reachOf, computeAttackers, threatsTo, chooseTarget, closestOf, runBlows, resolveBlow } from './combat.js';
import { updateNerve, heldInPlace } from './nerve.js';
import { findOpening, resolveRate, spendResolve, stepRearMan, passTheWord } from './resolve.js';
import { decideUnit, rout, recoil, startPursuit } from './ai.js';

export const DEFAULT_CONFIG = {
  seed: 403,
  sides: [
    {
      depth: 4,
      placement: 'xenophon',
      ai: true,
      lights: { count: 24, quality: 'regular' },
      cavalry: [{ name: 'Hippeis', count: 10, quality: 'regular', wing: 'right' }],
      contingents: [
        { name: 'Erechtheis', count: 16, quality: 'veteran', kit: 'well' },
        { name: 'Aigeis', count: 16, quality: 'green', kit: 'poor' },
        { name: 'Pandionis', count: 16, quality: 'veteran', kit: 'well' },
      ],
    },
    {
      depth: 4,
      placement: 'random',
      ai: true,
      lights: { count: 24, quality: 'regular' },
      cavalry: [{ name: 'Theban horse', count: 10, quality: 'regular', wing: 'right' }],
      contingents: [
        { name: 'Thebans', count: 24, quality: 'regular', kit: 'standard' },
        { name: 'Thespians', count: 24, quality: 'regular', kit: 'standard' },
      ],
    },
  ],
};

// Which of a side's bodies the player commands: 'ai' (none), 'phalanx', 'lights', or one wing
// of horse ('horse-right' / 'horse-left'). Older configs only said whether the phalanx was the
// player's.
export function commandOf(side) {
  return side.command ?? (side.ai === false ? 'phalanx' : 'ai');
}

// Older configs gave a side a man count and a frontage; turn that into a single contingent.
export function normaliseSide(side, i) {
  if (side.contingents) return side;
  const depth = Math.max(1, Math.ceil(side.count / clamp(side.files, 2, side.count)));
  return {
    depth,
    placement: side.placement,
    ai: side.ai,
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
    lights: [], // each side's light troops, in loose order in front of its phalanx
    horse: [], // cavalry squadrons, one body for each wing a side has horsemen on
    events: [],
    marks: [],
    attackers: {},
    contactT: null, // when the lines last met; cleared when they draw apart
    firstContactT: null, // when they first met
    apartT: null, // when they last drew apart after a fight
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
    // Each contingent forms at its own depth, the side's unless it chose another; the line's
    // front rank is straight, so a deeper contingent is narrower and reaches further back.
    let file = 0;
    const contingents = side.contingents.map((c) => {
      const depth = clamp(Math.round(c.depth ?? side.depth), 1, 16);
      const width = Math.max(1, Math.ceil(c.count / depth));
      const town = SIDES[i].contingentTowns && SIDES[i].contingentTowns[c.name];
      const out = { ...c, depth, file0: file, file1: file + width, origins: town ? [town] : null };
      file += width;
      return out;
    });
    const ranks = Math.max(...contingents.map((c) => c.depth));
    const anchor = i === 0 ? { x: -half, y: 0 } : { x: half, y: 0 };
    const u = createUnit(i, i, { files: file, ranks, ai: commandOf(side) !== 'phalanx', contingents }, anchor, i === 0 ? 0 : Math.PI);
    const used = new Set();
    contingents.forEach((c, k) => {
      for (let n = 0; n < c.count; n++) {
        const s = createSoldier(rng, world.soldiers.length, i, i, used, { index: k, quality: c.quality, kit: c.kit, origins: c.origins });
        // A contingent that brings its own men: who they are, from the village.
        if (c.men && c.men[n]) fromVillage(s, c.men[n]);
        world.soldiers.push(s);
        u.members.push(s.id);
        u.contingents[k].members.push(s.id);
      }
      u.contingents[k].present = c.count;
      // A contingent with a leader of its own: he is a man in its ranks, the one whose name
      // carries most, or the player himself among his own men.
      const ck = u.contingents[k];
      if (ck.leader || ck.you) {
        const men = ck.members.map((id) => world.soldiers[id]);
        const lead = (ck.you && men.find((s) => s.player)) || [...men].sort((a, b) => b.reputation - a.reputation)[0];
        if (lead) {
          if (ck.leader) {
            lead.name = ck.leader.name;
            lead.reputation = Math.max(lead.reputation, 0.5);
          } else ck.leader = { name: lead.name, bold: lead.courage, timid: 1 - lead.courage };
          ck.leaderId = lead.id;
          ck.leaders.push(lead.name);
          // His natural successor, if he is in the ranks: from the village, the man himself; for
          // the others, a man of standing renamed as the son.
          let heir = null;
          if (ck.heirVillageId != null) heir = men.find((s) => s.villageId === ck.heirVillageId && s !== lead) || null;
          else if (ck.heir) {
            heir = [...men].filter((s) => s !== lead).sort((a, b) => b.reputation - a.reputation)[0] || null;
            if (heir) heir.name = ck.heir.name;
          }
          if (heir) ck.heirId = heir.id;
        }
      }
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
  // Light troops, from their own stream so adding them never changes who the hoplites are.
  // They start in a loose screen well out in front of their phalanx.
  cfg.sides.forEach((side, i) => {
    const count = side.lights ? side.lights.count || 0 : 0;
    const g = createLights(i, count);
    g.ai = commandOf(side) !== 'lights';
    world.lights.push(g);
    const lrng = makeRng(cfg.seed * 53 + i + 11);
    const u = world.units[i];
    const fw = fwdOf(u.heading);
    const rt = rightOf(u.heading);
    const used = new Set(u.members.map((id) => world.soldiers[id].name));
    for (let n = 0; n < count; n++) {
      const s = createPeltast(lrng, world.soldiers.length, i, used, side.lights.quality || 'regular');
      if (side.lights.men && side.lights.men[n]) fromVillage(s, side.lights.men[n]);
      const across = (n / Math.max(1, count - 1) - 0.5) * (u.files * TUNING.fileSpacing + 8);
      const ahead = LIGHT.screenAhead + lrng.range(-2.5, 2.5);
      s.pos = { x: u.anchor.x + fw.x * ahead + rt.x * across, y: u.anchor.y + fw.y * ahead + rt.y * across };
      s.prev = { ...s.pos };
      s.lag = { ...s.pos };
      s.facing = u.heading;
      world.soldiers.push(s);
      g.members.push(s.id);
    }
  });
  // Cavalry, from their own stream too: one squadron for each wing a side has horse on,
  // formed up beyond the end of its phalanx.
  cfg.sides.forEach((side, i) => {
    const byWing = { right: [], left: [] };
    (side.cavalry || []).forEach((c, k) => {
      if (c.count > 0) byWing[c.wing === 'left' ? 'left' : 'right'].push({ ...c, index: k });
    });
    const hrng = makeRng(cfg.seed * 71 + i + 13);
    const used = new Set(world.soldiers.filter((s) => s.side === i).map((s) => s.name));
    for (const wing of ['right', 'left']) {
      if (!byWing[wing].length) continue;
      const b = createWing(world.horse.length, i, wing, byWing[wing], byWing.left.length > 0 && byWing.right.length > 0);
      b.ai = commandOf(side) !== `horse-${wing}`;
      byWing[wing].forEach((c, k) => {
        for (let n = 0; n < c.count; n++) {
          const s = createRider(hrng, world.soldiers.length, i, used, c, b.id);
          world.soldiers.push(s);
          b.members.push(s.id);
          b.contingents[k].members.push(s.id);
        }
      });
      world.horse.push(b);
      placeWing(world, b);
    }
  });
  // Each side's spirit on the day: omens at the sacrifice, hunger, a long march.
  // It shifts every man's nerve a little and is rolled separately from the men themselves.
  const spiritRng = makeRng(cfg.seed * 17 + 3);
  for (const u of world.units) {
    u.spirit = clamp(spiritRng.normal(0, 0.05), -0.12, 0.12);
    const riders = world.horse.filter((b) => b.side === u.id).flatMap((b) => b.members);
    for (const id of [...u.members, ...riders]) {
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
  // Horsemen about, and he cannot stop running: they would ride him down.
  for (const b of world.horse) {
    if (b.side === s.side) continue;
    for (const id of b.members) {
      const o = world.soldiers[id];
      if (isRiding(o)) best = Math.min(best, dist(o.pos, s.pos) * 0.5);
    }
  }
  return best;
}

// The leader of a contingent tells his men to hold steady, to go at the enemy, to hang back and
// let others do the fighting, or to run. An order from the commander of the line holds the
// contingent leaders to it for a while.
export const STANCES = ['steady', 'provoke', 'linger', 'run'];
export function setStance(world, u, k, stance, hold) {
  const c = u.contingents[k];
  if (!c || !STANCES.includes(stance)) return false;
  if (hold) c.heldUntil = world.t + 30;
  if (c.stance === stance) return false;
  c.stance = stance;
  c.stanceAt = world.t;
  const who = c.leader ? `${c.leader.name} of ${c.name}` : `The ${c.name}' leader`;
  if (stance === 'run') {
    c.ranAt = c.ranAt ?? world.t;
    logEvent(world, 'flee', `The ${c.name} are told to run, and turn and go.`, { unit: u.id });
  } else if (stance === 'provoke') logEvent(world, 'stance', `${who} shouts his men on: at them, at them!`, { unit: u.id });
  else if (stance === 'linger') logEvent(world, 'stance', `The ${c.name} hang back, leaving the fighting to others.`, { unit: u.id });
  else logEvent(world, 'stance', `The ${c.name} are told to hold steady.`, { unit: u.id });
  return true;
}

// When a contingent's leader falls, or is carried off in a rout, the next man of standing in its
// ranks takes over, with his own temper: a brave man leads boldly, a timid one cautiously.
function succeed(world, u, c) {
  const old = world.soldiers[c.leaderId];
  // His son, or heir, if he is standing in the line; otherwise the man of most standing.
  const heir = c.heirId >= 0 && c.heirId !== c.leaderId ? world.soldiers[c.heirId] : null;
  const next = heir && isFormed(heir) ? heir : c.members.map((id) => world.soldiers[id]).filter((s) => s !== old && isFormed(s)).sort((a, b) => b.reputation - a.reputation)[0];
  const how = old.state === 'dead' ? 'is killed' : old.state === 'down' ? 'is down' : isRunning(old) ? 'has run' : 'is gone';
  if (!next) {
    c.leaderId = -1;
    return;
  }
  c.leaderId = next.id;
  const byBirth = next === heir;
  // An heir leads by the temper he has; anyone else by his courage.
  c.leader = byBirth && c.heir && c.heir.bold != null ? { name: next.name, bold: c.heir.bold, timid: c.heir.timid } : { name: next.name, bold: clamp(next.courage, 0, 1), timid: clamp(1 - next.courage, 0, 1) };
  c.leaders.push(next.name);
  c.heldUntil = 0;
  const men = /ans$/.test(c.name) ? `the ${c.name}` : `the men of ${c.name}`;
  logEvent(world, 'leader', `${old.name}, leading ${men}, ${how}. ${byBirth ? (c.heir && c.heir.of ? `${c.heir.of}${/s$/.test(c.heir.of) ? "'" : "'s"} son ${next.name}` : `His son, ${next.name},`) : next.name} takes over.`, { unit: u.id, who: next.id });
}

// A contingent's own leader, by his temper, decides what to tell his men as the fight goes: a
// bold man shouts them on while they have the heart for it, a timid one holds them back once it
// gets hard, and takes them away when it gets worse.
function leaderThinks(world, u, c) {
  const L = c.leader;
  if (!L || c.you || c.heldUntil > world.t || u.mode !== 'formed' || !c.present) return;
  if (world.t - c.stanceAt < 4 && c.stance !== 'steady') return;
  const e = world.units[1 - u.id];
  const close = world.contactT != null || frontDistance(u, e) < TUNING.approachFear;
  if (!close) return;
  const bold = L.bold ?? 0.5;
  const timid = L.timid ?? 0.5;
  let want = 'steady';
  if (c.nerve < 0.12 + 0.18 * timid && u.nerve < 0.4 && timid > 0.55) want = 'run';
  else if (c.nerve < 0.3 + 0.45 * timid || (timid > 0.7 && c.stamina < 0.6)) want = 'linger';
  else if (bold > 0.5 && c.nerve > 0.75 - 0.35 * bold && c.stamina > 0.45) want = 'provoke';
  // Once he has run he does not come back.
  if (c.stance === 'run') return;
  if (want !== c.stance) setStance(world, u, c.index, want);
}

// A man who comes to the battle from a village: his own name, nature and kit, not made up.
function fromVillage(s, m) {
  for (const k of ['name', 'epithet', 'origin', 'age', 'courage', 'skill', 'strength', 'endurance', 'reputation', 'veteran', 'battles', 'weapon', 'shield', 'armour', 'helmet', 'greaves']) if (m[k] != null) s[k] = m[k];
  s.nerveCap = 0.55 + 0.45 * s.courage;
  s.nerve = s.nerveCap;
  s.villageId = m.villageId;
  if (m.player) s.player = true;
}

// ---- Soldier state machine ----

function setState(s, state) {
  s.state = state;
  s.stateT = 0;
}

// When his line breaks, a man whose nerve is still whole may stay to fight and cover the others'
// flight: rare, and the bravest thing on the field. Not when his own leader has told them to run.
function standsFast(world, u, s, stance) {
  const T = TUNING;
  if (stance === 'run' || s.kind !== 'hoplite' || !s.slot) return false;
  if (s.nerve < T.rearguardNerve || s.health < 0.5 || s.stamina < 0.3) return false;
  if (!world.rng.chance(T.rearguardChance)) return false;
  s.rearguard = true;
  s.rearguardT = world.rng.range(T.rearguardHold[0], T.rearguardHold[1]);
  s.nerve = s.nerveCap;
  s.record.rearguard = true;
  s.reputation = Math.min(1, s.reputation + T.rearguardFame);
  u.stats.rearguard = (u.stats.rearguard || 0) + 1;
  logEvent(world, 'rearguard', `${s.name} of ${s.origin} stands his ground to cover the ${u.short} as they run.`, { unit: u.id, who: s.id });
  return true;
}

function flee(world, s, why) {
  const u = world.units[s.unit];
  vacateSlot(u, s);
  setState(s, 'fleeing');
  s.fleeT = 0;
  s.target = -1;
  s.aggressor = false;
  s.rearguard = false;
  if (why === 'covered') {
    // The rearguard's work done: he gets away now, and it is no flight.
    logEvent(world, 'rearguard', `${s.name}, his comrades away, turns and follows them.`, { unit: u.id, who: s.id });
    handleLeaderLoss(world, u, s, 'fled');
    return;
  }
  s.record.fled++;
  if (s.fledAt == null) s.fledAt = world.t;
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
  handleLeaderLoss(world, u, s, 'fled');
}

// How far a man could step back before he walks into the man behind him.
function roomBehind(world, u, s) {
  if (!s.slot) return 9;
  const behind = occupant(world, u, s.slot.f, s.slot.r + 1);
  if (!behind || !isFormed(behind)) return 9;
  const fw = fwdOf(facingOf(u, s));
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
  s.record.surges++;
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

// How fast he tires: the weight of his kit, as his strength bears it, and his wind.
function fatigueMul(s) {
  const kit = (SHIELDS[s.shield].fatigue + ARMOUR[s.armour].fatigue) / 2 * GREAVES[s.greaves || 'none'].fatigue;
  return (1 + (kit - 1) * burdenOf(s)) * windOf(s);
}

function stepSoldier(world, s, dt) {
  const T = TUNING;
  const u = world.units[s.unit];
  const rng = world.rng;
  s.stateT += dt;
  // What the man leading this contingent is telling them: to hold steady, to go at the enemy, or
  // to run.
  const stance = u.contingents[s.contingent] ? u.contingents[s.contingent].stance : null;
  if (stance === 'run' && isFormed(s) && u.mode !== 'routed') {
    flee(world, s, 'ordered');
    return;
  }
  if (stance === 'provoke' && isFormed(s)) {
    shiftNerve(world, s, T.provokeNerve * dt);
    s.resolve = Math.min(1, s.resolve + T.provokeResolve * dt);
    s.stamina = Math.max(0, s.stamina - T.provokeWind * windOf(s) * dt);
  }
  const linger = stance === 'linger' && isFormed(s);
  if (s.bout && world.contactT != null) {
    s.bout.lowN = Math.min(s.bout.lowN, s.nerve);
    s.bout.lowS = Math.min(s.bout.lowS, s.stamina);
  }
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
    else s.stamina = Math.min(s.staminaCap, s.stamina + T.staminaRecover * recoveryOf(s) * dt);
  };

  switch (s.state) {
    case 'inRank': {
      rest();
      if (attackers.length && s.slot) {
        // A tired or resting man, or one whose unit is giving ground, steps back behind his
        // shield rather than trade blows, if there is room behind him. Otherwise he fights.
        const tired = u.yielding || linger || s.stamina < 0.5 || s.breathT > 0;
        setState(s, tired && roomBehind(world, u, s) > 0.3 ? 'yielding' : 'fighting');
        s.aggressor = false;
        s.fightT = 0;
        s.idleT = 0;
        s.target = closestOf(world, s, attackers);
        break;
      }
      if (s.slot && s.slot.r > 0) {
        stepRearMan(world, s, dt);
        // Hanging back, he does not push up behind the man in front.
        if (linger) s.resolve = Math.max(0, s.resolve - 0.2 * dt);
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
      if (linger) {
        s.resolve = Math.max(0, s.resolve - 0.1 * dt);
        break;
      }
      buildResolve(world, s, dt, 1);
      break;
    }

    case 'surging':
    case 'fighting': {
      s.stamina = Math.max(0, s.stamina - (s.state === 'fighting' ? T.staminaFight : T.staminaSurge) * fatigueMul(s) * dt);
      s.fightT += dt;
      s.record.fightT += dt;
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
      s.stamina = Math.max(0, s.stamina - T.staminaSurge * windOf(s) * dt);
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
      s.stamina = Math.max(0, s.stamina - T.staminaRun * windOf(s) * dt);
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
        const back = rearSlot(u, s.contingent);
        if (back) {
          placeInSlot(u, s, back.f, back.r);
          setState(s, 'returning');
        }
      }
      break;
    }

    case 'pursuing': {
      s.stamina = Math.max(0, s.stamina - T.staminaRun * windOf(s) * dt);
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
    if (u.mode === 'routed' && !s.rearguard) {
      // A line that breaks before contact turns from the rear: the front ranks are boxed in until the
      // men behind have cleared. Once the lines are locked together everyone turns at once.
      const boxedIn = world.contactT == null && s.slot ? (depthAt(u, s.slot.f) - 1 - s.slot.r) * 0.6 : 0;
      if (s.routDelay < 0) s.routDelay = rng.range(0, 1.2) + boxedIn;
      s.routDelay -= dt;
      if (s.routDelay <= 0) {
        if (standsFast(world, u, s, stance)) return;
        flee(world, s, 'rout');
      }
      return;
    }
    // A man of the rearguard holds as long as he can, then gets away himself, with no shame in it.
    if (s.rearguard) {
      s.rearguardT -= dt;
      if (s.rearguardT <= 0) {
        flee(world, s, 'covered');
        return;
      }
    }
    updateNerve(world, s, dt);
    // A man who has chosen to stand with the rearguard does not break; he holds till he falls.
    if (s.rearguard) s.nerve = Math.max(s.nerve, T.nerveFlee);
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
    if (ahead && !isFallen(ahead)) {
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
  const fw = fwdOf(facingOf(u, s));
  const home = s.slot ? shapeHome(world, u, s, slotWorld(u, s.slot.f, s.slot.r), fw) : null;
  const c = u.contingents[s.contingent];
  switch (s.state) {
    case 'inRank':
    case 'yielding':
      // A man hanging back keeps a little behind his place.
      if (home && c && c.stance === 'linger') return { x: home.x - fw.x * TUNING.lingerBack, y: home.y - fw.y * TUNING.lingerBack };
      return home;
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

// A light man moves on his own, toward wherever his part in the skirmish takes him.
function moveLight(world, s, dt) {
  let dv = { x: 0, y: 0 };
  if (s.goal && !isFallen(s)) {
    const dx = s.goal.x - s.pos.x;
    const dy = s.goal.y - s.pos.y;
    const d = Math.hypot(dx, dy);
    // He runs when he has to, jogs to a place some way off, and walks into position.
    const top = (s.running ? LIGHT.run * (0.5 + 0.5 * s.stamina) : d > 8 ? LIGHT.jog : LIGHT.walk) * s.speedMul;
    const sp = Math.min(top, d / 0.5);
    if (d > 0.05) dv = { x: (dx / d) * sp, y: (dy / d) * sp };
  }
  const k = Math.min(1, 6 * dt);
  s.vel.x += (dv.x - s.vel.x) * k;
  s.vel.y += (dv.y - s.vel.y) * k;
  if (isFallen(s)) {
    s.vel.x *= 0.8;
    s.vel.y *= 0.8;
  }
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  s.lag.x = s.pos.x;
  s.lag.y = s.pos.y;
  // He faces the man he last threw at for a moment, otherwise the way he is going.
  let want = s.facing;
  const t = s.target >= 0 ? world.soldiers[s.target] : null;
  if (t && s.throwT > LIGHT.interval * 0.6) want = Math.atan2(t.pos.y - s.pos.y, t.pos.x - s.pos.x);
  else if (Math.hypot(s.vel.x, s.vel.y) > 0.3) want = Math.atan2(s.vel.y, s.vel.x);
  if (!isFallen(s)) s.facing += angleWrap(want - s.facing) * Math.min(1, 6 * dt);
}

function moveSoldier(world, s, dt) {
  if (s.kind === 'light') {
    moveLight(world, s, dt);
    return;
  }
  if (s.kind === 'horse') {
    moveRider(world, s, dt);
    return;
  }
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
  } else if (!isFallen(s) && s.state !== 'escaped') {
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
  if (isFallen(s)) {
    s.vel.x *= 0.8;
    s.vel.y *= 0.8;
  }
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  const lagK = Math.min(1, dt / 0.3);
  s.lag.x += (s.pos.x - s.lag.x) * lagK;
  s.lag.y += (s.pos.y - s.lag.y) * lagK;

  // Facing: toward his opponent, his direction of flight, or the unit's front.
  let want = facingOf(u, s);
  if (s.target >= 0 && (s.state === 'fighting' || s.state === 'surging' || s.state === 'pursuing' || s.state === 'wavering' || s.state === 'yielding')) {
    const t = world.soldiers[s.target];
    want = Math.atan2(t.pos.y - s.pos.y, t.pos.x - s.pos.x);
  } else if (s.state === 'fleeing' && Math.hypot(s.vel.x, s.vel.y) > 0.3) {
    want = Math.atan2(s.vel.y, s.vel.x);
  }
  if (!isFallen(s)) s.facing += angleWrap(want - s.facing) * Math.min(1, 6 * dt);
}

function separate(world) {
  const bodies = world.soldiers.filter((s) => !isGone(s));
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const minD = (a.radius ?? TUNING.bodyRadius) + (b.radius ?? TUNING.bodyRadius);
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
      const w = s.slot && (s.slot.r === 0 || s.slot.r === depthAt(u, s.slot.f) - 1) ? 1.2 : 1;
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
  for (const c of u.contingents) tallyContingent(world, c);
  // How much of the line is hanging back, which every man in it can see; and the contingent
  // leaders' thoughts on what to tell their men.
  let hanging = 0;
  for (const c of u.contingents) {
    if (c.present) c.stanceT[c.stance] = (c.stanceT[c.stance] || 0) + dt;
    if (c.stance === 'linger') hanging += c.present;
  }
  u.lingerShare = present ? hanging / present : 0;
  if (u.mode !== 'routed') for (const c of u.contingents) if (c.leaderId >= 0 && !isFormed(world.soldiers[c.leaderId])) succeed(world, u, c);
  if (world.step % Math.round(T.leaderEvery / dt) === 0) for (const c of u.contingents) leaderThinks(world, u, c);
  if ((u.mode === 'formed' || u.mode === 'withdrawing') && threatened) {
    // The phalanx breaks as one body: once enough of its men are running, the rest go too.
    const share = running / Math.max(1, present + running);
    if (share > T.routFleeing && running >= 3) rout(world, u, 'running');
    else if (present <= Math.max(2, Math.round(0.12 * u.members.length))) rout(world, u, 'few');
    // A line that loses heart as a charge comes on turns before the impact.
    else if (e.charging && !u.charging && world.contactT == null && (wavering + running) / Math.max(1, present + running) > T.breakOnCharge) rout(world, u, 'charge');
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
      if (u.grid[0][f] < 0 || u.curl[f] > 0.5) continue;
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

  curlEnds(world, u, e, dt);

  let turn = 0;
  if (u.ai && u.mode !== 'routed' && e.mode !== 'routed') {
    const want = Math.atan2(e.anchor.y - u.anchor.y, e.anchor.x - u.anchor.x);
    turn = clamp(angleWrap(want - u.heading) * 2, -1, 1);
  } else if (!u.ai && u.mode !== 'routed') {
    turn = u.turn;
  }
  u.heading = angleWrap(u.heading + (turn * T.turnRate / (1 + u.files * 0.08)) * dt);
}

// How each contingent is bearing up, for the side panel and the record.
function tallyContingent(world, c) {
  let present = 0;
  let running = 0;
  let nerve = 0;
  let stamina = 0;
  for (const id of c.members) {
    const s = world.soldiers[id];
    if (isFormed(s)) {
      present++;
      nerve += s.nerve;
      stamina += s.stamina;
    } else if (isRunning(s)) {
      running++;
    }
  }
  c.present = present;
  c.running = running;
  // When a contingent breaks: most of its men running.
  if (c.brokeAt == null && running >= 2 && running >= present) {
    c.brokeAt = world.t;
    world.breaks = world.breaks || [];
    world.breaks.push({ unit: c.unit, contingent: c.index, t: world.t });
  }
  c.nerve = present ? nerve / present : 0;
  c.stamina = present ? stamina / present : 0;
}

// The overhanging end of a line wraps round the enemy's end like a rope round a post: in an
// arc a spear's length off his front corner, down his flank, round his rear corner and along
// his back. Where along it a file stands (its front man, the way he faces, and the way his
// file trails out behind him), in the line's own frame: x across, y forward.
function hookPoint(end, front, flankLen, side, along) {
  const R = TUNING.curlStand;
  const arc = (R * Math.PI) / 2;
  let x;
  let y;
  let cx;
  let cy;
  if (along <= arc) {
    const a = along / R;
    cx = end;
    cy = front;
    x = end + side * R * Math.sin(a);
    y = front - R * Math.cos(a);
  } else if (along <= arc + flankLen) {
    x = end + side * R;
    y = front + (along - arc);
    cx = end;
    cy = y;
  } else if (along <= 2 * arc + flankLen) {
    const a = (along - arc - flankLen) / R;
    cx = end;
    cy = front + flankLen;
    x = end + side * R * Math.cos(a);
    y = cy + R * Math.sin(a);
  } else {
    x = end - side * (along - 2 * arc - flankLen);
    y = front + flankLen + R;
    cx = x;
    cy = front + flankLen;
  }
  // He faces in toward the enemy; his file trails away outward.
  const l = Math.hypot(cx - x, cy - y) || 1;
  return { x, y, fx: (cx - x) / l, fy: (cy - y) / l };
}

// A line that overlaps the enemy does not leave its end files standing idle: once the lines
// are locked together, the men with nobody in front of them wheel forward and inward round
// the end of the enemy line, until they stand down his flank facing in. It is the line itself
// bending, file by file, not a body of men leaving it.
function curlEnds(world, u, e, dt) {
  const T = TUNING;
  const sp = T.fileSpacing;
  const fw = fwdOf(u.heading);
  const rt = rightOf(u.heading);
  // Where the enemy's front ends, across our line, how far ahead it stands there, and how
  // deep his end files are.
  let lo = Infinity;
  let hi = -Infinity;
  let loDepth = 0;
  let hiDepth = 0;
  let loF = -1;
  let hiF = -1;
  for (let f = 0; f < e.files; f++) {
    if (fileDepth(e, f) === 0 || e.curl[f] > 0.5) continue;
    const p = slotWorld(e, f, 0);
    const lat = (p.x - u.anchor.x) * rt.x + (p.y - u.anchor.y) * rt.y;
    const ahead = (p.x - u.anchor.x) * fw.x + (p.y - u.anchor.y) * fw.y;
    if (lat < lo) { lo = lat; loDepth = ahead; loF = f; }
    if (lat > hi) { hi = lat; hiDepth = ahead; hiF = f; }
  }
  const fighting = u.mode === 'formed' && e.mode !== 'routed' && world.contactT != null && u.inContact && u.order !== 'back';
  // Men will not wrap round into a place where the enemy's light troops would have their
  // backs: each end looks at the peltasts out on its own flank, and the more of them there
  // are, the less far it goes round.
  const reach = { 1: 1, '-1': 1 };
  for (const side of [1, -1]) {
    const edge = side > 0 ? hi : lo;
    if (!Number.isFinite(edge)) continue;
    const corner = { x: u.anchor.x + rt.x * edge + fw.x * (side > 0 ? hiDepth : loDepth), y: u.anchor.y + rt.y * edge + fw.y * (side > 0 ? hiDepth : loDepth) };
    let watching = 0;
    for (const id of world.lights[1 - u.id].members) {
      const o = world.soldiers[id];
      if (o.state !== 'skirmishing' && o.state !== 'retiring' && o.state !== 'resting') continue;
      const rel = { x: o.pos.x - corner.x, y: o.pos.y - corner.y };
      // Only the ones out on this end's side of the battle.
      if (side * (rel.x * rt.x + rel.y * rt.y) < -2) continue;
      if (Math.hypot(rel.x, rel.y) < LIGHT.range + 8) watching++;
    }
    reach[side] = clamp(1 - watching / T.curlDeterred, 0, 1);
    // Say so once, if this end overhangs and is held back.
    const overhangs = side > 0 ? ((u.files - 1) / 2) * sp > hi + 0.6 * sp : -((u.files - 1) / 2) * sp < lo - 0.6 * sp;
    if (fighting && overhangs && reach[side] < 0.5 && !(u.deterNoted || (u.deterNoted = {}))[side]) {
      u.deterNoted[side] = true;
      logEvent(world, 'overlap', `The ${side > 0 ? 'right' : 'left'} end of the ${u.adjective} line overlaps the ${e.short}, but with the ${world.lights[1 - u.id].name} out on that flank its men will not go round.`, { unit: u.id });
    }
  }
  for (let f = 0; f < u.files; f++) {
    const x = (f - (u.files - 1) / 2) * sp;
    const side = x > hi + 0.6 * sp ? 1 : x < lo - 0.6 * sp ? -1 : 0;
    const k = side > 0 ? Math.round((x - hi) / sp) : side < 0 ? Math.round((lo - x) / sp) : 0;
    if (fighting && side && k >= 1 && fileDepth(u, f) > 0 && u.curl[f] < reach[side] + 0.001) {
      const end = side > 0 ? hi : lo;
      const front = side > 0 ? hiDepth : loDepth;
      const flankLen = Math.max(0.5, (fileDepth(e, side > 0 ? hiF : loF) - 1) * T.rankSpacing);
      u.curlTo[f] = { ...hookPoint(end, front, flankLen, side, (k - 0.5) * sp), side };
      // The men nearest his corner bend round first; those further out follow on.
      u.curl[f] = Math.min(reach[side], u.curl[f] + T.curlRate * dt / (1 + 0.15 * (k - 1)));
      if (u.curl[f] > 0.5 && !(u.curlNoted || (u.curlNoted = {}))[side]) {
        u.curlNoted[side] = true;
        logEvent(world, 'overlap', `The ${side > 0 ? 'right' : 'left'} end of the ${u.adjective} line curls round onto the ${e.short}' flank.`, { unit: u.id });
      }
    } else {
      u.curl[f] = Math.max(0, u.curl[f] - T.curlRate * dt);
      if (u.curl[f] === 0) u.curlTo[f] = null;
    }
  }
  // Our own end, if the enemy's line is curling round it: the outermost file turns to face.
  let first = -1;
  let last = -1;
  for (let f = 0; f < u.files; f++) {
    if (fileDepth(u, f) === 0) continue;
    if (first < 0) first = f;
    last = f;
  }
  for (let f = 0; f < u.files; f++) {
    const side = f === last ? 1 : f === first ? -1 : 0;
    let threatened = false;
    if (side && u.mode === 'formed') {
      const endLat = (f - (u.files - 1) / 2) * sp;
      for (let g = 0; g < e.files && !threatened; g++) {
        if (e.curl[g] < 0.3) continue;
        const p = slotWorld(e, g, 0);
        const lat = (p.x - u.anchor.x) * rt.x + (p.y - u.anchor.y) * rt.y;
        if (side * (lat - endLat) > 0 && Math.abs(lat - endLat) < 6) threatened = true;
      }
    }
    if (threatened) {
      u.refuseSide[f] = side;
      u.refuse[f] = Math.min(1, u.refuse[f] + T.curlRate * 1.5 * dt);
    } else {
      u.refuse[f] = Math.max(0, u.refuse[f] - T.curlRate * dt);
    }
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
  if (a.inContact && b.inContact && world.contactT == null && !a.charging && !b.charging) {
    world.contactT = world.t;
    if (world.firstContactT == null) world.firstContactT = world.t;
    // What each man goes into this fight with, and (below) the lowest he is brought to in it:
    // a rest afterwards gives back most of what the fight took, but not all.
    for (const s of world.soldiers) {
      if (s.kind === 'light' || isGone(s)) continue;
      s.bout = { capN: s.nerveCap, capS: s.staminaCap, lowN: s.nerve, lowS: s.stamina };
    }
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
  hanging: 'the line hanging back, leaving the fighting to others',
  missiles: 'javelins coming in',
  cavalry: 'horsemen at their flanks and backs',
  bogged: 'being caught standing among the enemy',
  charge: 'enemy horsemen riding at them',
};

export function topCauses(u, n = 3) {
  const total = Object.values(u.causes).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(u.causes)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([k, v]) => ({ key: k, text: CAUSE_TEXT[k] || k, share: v / total }));
}

function finish(world, type, winner, loser) {
  aftermath(world, winner ? winner.id : null);
  // Killed in the fight or the pursuit, or dead of wounds on the field or after it.
  const fight = (s) => s.state === 'dead' && s.deathPhase === 'fight';
  const pursuit = (s) => s.state === 'dead' && s.deathPhase === 'pursuit';
  const ofWounds = (s) => (s.state === 'dead' && s.deathPhase === 'wounds') || (s.state !== 'dead' && diedAfter(s));
  const gone = (s) => s.state === 'dead' || diedAfter(s);
  const wounded = (s) => !gone(s) && s.wounds.some((w) => w.grade > 0 || w.horse);
  const decidedAt = loser && loser.decisionT != null ? loser.decisionT : world.t;
  const sides = world.units.map((u) => {
    const men = u.members.map((id) => world.soldiers[id]);
    return {
      name: u.name,
      short: u.short,
      start: men.length,
      killedFight: men.filter(fight).length,
      killedPursuit: men.filter(pursuit).length,
      diedOfWounds: men.filter(ofWounds).length,
      wounded: men.filter(wounded).length,
      fled: men.filter((s) => s.record.fled > 0).length,
      causes: topCauses(u),
      contingents: u.contingents.map((c) => {
        const cm = c.members.map((id) => world.soldiers[id]);
        return {
          name: c.name,
          quality: c.quality,
          kit: c.kit,
          start: cm.length,
          brokeAt: c.brokeAt ?? null,
          ranAt: c.ranAt ?? null,
          stanceT: c.stanceT,
          leader: c.leader,
          leaders: c.leaders,
          heir: c.heirId >= 0 ? { name: world.soldiers[c.heirId].name, dead: world.soldiers[c.heirId].state === 'dead' || diedAfter(world.soldiers[c.heirId]), led: c.leaders.includes(world.soldiers[c.heirId].name) } : null,
          leaderLost: c.leaders.length > 1 ? (() => {
            const first = world.soldiers.find((s) => s.name === c.leaders[0] && c.members.includes(s.id));
            return first ? { name: first.name, dead: first.state === 'dead' || diedAfter(first), fate: first.state === 'dead' ? 'killed' : diedAfter(first) ? 'died of his wounds' : first.state === 'down' ? 'wounded' : 'ran' } : null;
          })() : null,
          kills: cm.reduce((a, s) => a + s.record.kills + s.record.downed, 0),
          village: c.village || null,
          killedFight: cm.filter(fight).length,
          killedPursuit: cm.filter(pursuit).length,
          diedOfWounds: cm.filter(ofWounds).length,
          wounded: cm.filter(wounded).length,
          fled: cm.filter((s) => s.record.fled > 0).length,
        };
      }),
      lights: (() => {
        const lm = world.lights[u.id].members.map((id) => world.soldiers[id]);
        return {
          start: lm.length,
          killed: lm.filter(gone).length,
          wounded: lm.filter(wounded).length,
          fled: lm.filter((s) => s.record.fled > 0).length,
          kills: lm.reduce((a, s) => a + s.record.kills, 0),
        };
      })(),
      cavalry: (() => {
        const cm = world.horse.filter((b) => b.side === u.id).flatMap((b) => b.members).map((id) => world.soldiers[id]);
        return {
          start: cm.length,
          killed: cm.filter(gone).length,
          wounded: cm.filter(wounded).length,
          fled: cm.filter((s) => s.record.fled > 0).length,
          kills: cm.reduce((a, s) => a + s.record.kills, 0),
        };
      })(),
      deadFront: men.filter((s) => gone(s) && s.startRank === 0).length,
      deadRear: men.filter((s) => gone(s) && s.startRank === u.contingents[s.contingent].depth - 1).length,
    };
  });
  const heroes = world.soldiers
    .filter((s) => s.record.kills + s.record.downed > 0)
    .sort((a, b) => (b.record.kills + b.record.downed) - (a.record.kills + a.record.downed) || b.record.kills - a.record.kills)
    .slice(0, 3)
    .map((s) => ({ id: s.id, name: s.name, origin: s.origin, side: s.side, kills: s.record.kills, downed: s.record.downed, alive: !gone(s) }));
  const fallenVeterans = world.soldiers.filter((s) => s.veteran && gone(s)).map((s) => ({ id: s.id, name: s.name, side: s.side }));
  // Men people know who will carry the battle on them for the rest of their lives.
  const marked = world.soldiers
    .filter((s) => !gone(s) && s.wounds.some((w) => w.mark) && (s.veteran || s.epithet || world.units.some((u) => u.leaderId === s.id || u.secondId === s.id)))
    .map((s) => ({ id: s.id, name: s.name, epithet: s.epithet, side: s.side, marks: [...new Set(s.wounds.map((w) => w.mark).filter(Boolean))] }));
  // Men who came from a village, and what became of each of them, for the village to take home.
  const villagers = world.soldiers.filter((s) => s.villageId != null).map((s) => ({
    villageId: s.villageId,
    kind: s.kind,
    dead: gone(s),
    fate: s.state === 'dead' ? (s.deathPhase === 'pursuit' ? 'killed running' : s.deathPhase === 'wounds' ? 'died of his wounds on the field' : 'killed fighting') : s.fate || (s.state === 'escaped' ? 'got away' : 'came through'),
    wounds: s.wounds.filter((w) => w.grade > 0).map((w) => ({ grade: w.grade, text: w.text, mark: w.mark || null })),
    kills: s.record.kills,
    downed: s.record.downed,
    woundsGiven: s.record.woundsGiven,
    surges: s.record.surges || 0,
    fought: Math.round(s.record.fightT || 0),
    contingent: s.kind === 'hoplite' ? s.contingent : null,
    fled: s.record.fled > 0,
    rearguard: !!s.record.rearguard,
    player: !!s.player,
  }));
  let headline = 'Neither side would close again. The lines drew apart.';
  if (type === 'rout') headline = `The ${loser.short} broke and ran. The ${winner.short} hold the field.`;
  if (type === 'rout' && loser.routDistance != null) {
    headline = world.firstContactT != null
      ? `The ${loser.short} broke as the enemy came on again, ${Math.max(0, Math.round(loser.routDistance))} m away.`
      : `The ${loser.short} broke before the lines met, with the enemy ${Math.max(0, Math.round(loser.routDistance))} m away.`;
  }
  if (type === 'withdrawal') headline = `The ${loser.short} withdrew in order. The ${winner.short} hold the field.`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const lost = (u) => u.members.filter((id) => ['dead', 'down', 'fleeing', 'escaped', 'rallying'].includes(world.soldiers[id].state)).length;
  let why = '';
  if (type === 'withdrawal' && loser) {
    const n = loser.withdrawNote;
    if (loser.withdrawReason === 'ordered') why = `You ordered the ${loser.short} to withdraw.`;
    else if (loser.withdrawReason === 'javelins') why = `Drawn apart after the fighting, the ${loser.short} had no light troops left to keep the enemy's javelins off, and would not stand there to be picked off.`;
    else if (n) {
      why += `The ${loser.adjective} commander pulled his men back when their nerve fell to ${pct(n.nerve)} (the ${winner.short} were at ${pct(n.enemyNerve)})`;
      if (n.running > 0) why += `, with ${n.running} of his men already running`;
      why += lost(loser) < lost(winner) ? `, though the ${winner.short} had lost more men.` : '.';
      if (n.heldOn) why += ' He had already held on past the point he would normally have pulled out.';
    }
  } else if (type === 'rout' && loser) {
    const n = loser.routNote || {};
    if (n.why === 'charge') why = `The ${loser.short} lost heart as the charge came on and turned before it struck.`;
    else if (n.why === 'few') why = `So few ${loser.short} were left in the line that the rest gave up.`;
    else why += `The ${loser.short} broke when ${n.running} of their men were running and the panic spread (their nerve was down to ${pct(n.nerve || 0)}, the ${winner.short}' at ${pct(n.enemyNerve || 0)}).`;
  } else if (type === 'standoff') {
    const [a, b] = world.units;
    why = `Neither side would start another surge: both were worn down (the ${a.short} at ${pct(a.nerve)} nerve, the ${b.short} at ${pct(b.nerve)}), and they drew apart.`;
  }
  // Where the line gave way first: the contingent whose men had started running before the
  // whole line went or was pulled back.
  if (loser && loser.contingents.length > 1) {
    const before = loser.decisionT ?? world.t;
    const ran = (c) => c.members.filter((id) => world.soldiers[id].fledAt != null && world.soldiers[id].fledAt < before).length;
    const worst = [...loser.contingents].sort((a, b) => ran(b) / b.members.length - ran(a) / a.members.length)[0];
    if (ran(worst) >= 2) why += ` It began among the ${worst.name}: ${ran(worst)} of their ${worst.members.length} men had run before the rest gave way.`;
  }
  // A winning line can have its weak stretch too.
  if (winner && winner.contingents.length > 1) {
    const ran = (c) => c.members.filter((id) => world.soldiers[id].fledAt != null && world.soldiers[id].fledAt < decidedAt).length;
    const shaky = winner.contingents.filter((c) => ran(c) >= 3).map((c) => `${ran(c)} of the ${c.name}`);
    if (shaky.length) why += ` On the ${winner.adjective} side ${shaky.join(' and ')} had run, but the line held.`;
  }

  world.result = {
    type,
    why,
    winner: winner ? winner.id : -1,
    loser: loser ? loser.id : -1,
    headline,
    contactAt: world.firstContactT,
    decidedAt,
    duration: world.firstContactT != null ? decidedAt - world.firstContactT : 0,
    endedAt: world.t,
    pulses: world.pulses,
    beforeContact: world.firstContactT == null,
    routDistance: loser ? loser.routDistance : null,
    charges: world.charges,
    sides,
    heroes,
    fallenVeterans,
    marked,
    breaks: world.breaks || [],
    villagers,
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
    // Horsemen riding down the beaten enemy go on longer than men on foot.
    const riding = world.horse.some((b) => b.side === e.id && b.mode === 'pursue') && since < HORSE.pursuitTime + 5;
    if (((since > 6 && e.mode !== 'pursuing') || since > T.pursuitTime + 10) && !riding) {
      finish(world, 'rout', e, u);
      return;
    }
  }
  // Two lines that will not close again draw apart and rest; the battle is not over.
  if (a.mode === 'withdrawing' && b.mode === 'withdrawing' && Math.abs(frontDistance(a, b)) > T.apartDistance) {
    drawApart(world);
    return;
  }
  for (const u of world.units) {
    const e = world.units[1 - u.id];
    if (u.mode !== 'withdrawing' || e.mode === 'withdrawing') continue;
    if (u.withdrawReason === 'standoff' && frontDistance(e, u) > T.apartDistance) {
      drawApart(world);
      return;
    }
    if (u.withdrawReason !== 'standoff' && frontDistance(e, u) > T.endDistance) {
      finish(world, 'withdrawal', e, u);
      return;
    }
  }
  if (world.firstContactT != null && world.t - world.firstContactT > T.maxBattle) finish(world, 'standoff', null, null);
  else if (world.firstContactT == null && world.t > 240) finish(world, 'standoff', null, null);
  // Drawn apart, and neither side will go in again: they leave the field to each other.
  else if (world.contactT == null && world.apartT != null && world.t - world.apartT > T.apartMax) finish(world, 'standoff', null, null);
}

// Neither line will close again: they stand apart, out of reach, and get their breath back.
// The light troops go out between them, and when one side has its strength back it may go in
// again.
function drawApart(world) {
  world.contactT = null;
  world.impactAt = null;
  world.inPulse = false;
  world.lullPending = false;
  world.quietT = 0;
  world.apartT = world.t;
  // Out of reach, a man can get back most of what the fight took from him, but not all: the
  // lower it brought him, the less he has to come back to.
  const R = TUNING.restRegain;
  for (const s of world.soldiers) {
    if (!s.bout || isGone(s)) continue;
    const b = s.bout;
    s.nerveCap = clamp(b.lowN + R * (b.capN - b.lowN), 0.15, b.capN);
    s.staminaCap = Math.min(s.staminaCap, b.lowS + R * (b.capS - b.lowS));
    s.bout = null;
  }
  for (const u of world.units) {
    if (u.mode === 'withdrawing') u.mode = 'formed';
    u.withdrawReason = null;
    u.decisionT = null;
    u.order = 'hold';
    u.reacted = false;
    u.bracing = false;
    u.charging = false;
    u.yielding = false;
    u.fireChoice = null;
    u.followT = 0;
    u.heldOnLogged = false;
  }
  logEvent(world, 'apart', 'The lines draw apart and stand off out of reach. The hoplites lean on their shields and get their breath back.');
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
        down: men.filter((s) => s.state === 'down').length,
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
          nerve: r2(c.nerve),
          stamina: r2(c.stamina),
          inLine: c.present,
          running: c.running,
          dead: c.members.filter((id) => world.soldiers[id].state === 'dead').length,
          give: r2(avg(front.filter((s) => s.contingent === c.index), (s) => u.give[s.slot.f])),
        })),
        lights: (() => {
          const g = world.lights[u.id];
          return { mode: g.mode, present: g.present, running: g.running, javelins: r2(g.javelins) };
        })(),
        cavalry: world.horse.filter((b) => b.side === u.id).map((b) => ({ wing: b.wing, mode: b.mode, present: b.present, running: b.running, stamina: r2(b.stamina) })),
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
  for (const g of world.lights) stepLights(world, g, dt);
  for (const b of world.horse) stepWing(world, b, dt);
  for (const s of men) {
    if (isGone(s)) continue;
    if (s.kind === 'light') stepPeltast(world, s, dt);
    else if (s.kind === 'horse') stepRider(world, s, dt);
    else stepSoldier(world, s, dt);
  }
  computeAttackers(world);
  runBlows(world, dt, men);
  stepWounds(world, dt);
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
