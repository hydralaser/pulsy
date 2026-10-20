import { clamp } from './core.js';
import { hopliteKit, riderKit, QUALITIES, LIGHT, HORSE } from './rules.js';
import { SIDES } from './names.js';

// A man of a given contingent: its quality shapes his courage, skill and standing, its kit
// what he can afford to wear.
export function createSoldier(rng, id, side, unitIdx, usedNames, contingent) {
  const roster = SIDES[side];
  const q = QUALITIES[contingent.quality] || QUALITIES.regular;
  const veteran = rng.chance(q.veterans);
  const courage = clamp(rng.normal(0.5, 0.14) + q.courage + (veteran ? 0.22 : 0), 0.12, 0.98);
  const skill = clamp(rng.normal(0.45, 0.14) + q.skill + (veteran ? 0.25 : 0), 0.1, 0.98);
  const reputation = veteran ? rng.range(0.5, 0.9) : clamp(rng.normal(0.12, 0.08) + q.reputation, 0, 0.4);
  const nerveCap = 0.55 + 0.45 * courage;

  let name = rng.pick(roster.names);
  for (let tries = 0; usedNames.has(name) && tries < 20; tries++) name = rng.pick(roster.names);
  usedNames.add(name);

  return {
    id,
    side,
    kind: 'hoplite',
    unit: unitIdx,
    contingent: contingent.index,
    name,
    origin: contingent.origins ? rng.pick(contingent.origins) : rng.pick(roster.origins),
    age: veteran ? 34 + rng.int(18) : 19 + rng.int(18),
    battles: veteran ? 4 + rng.int(9) : rng.int(3),
    veteran,
    courage,
    skill,
    reputation,
    ...hopliteKit(rng, veteran, contingent.kit),

    // Condition
    health: 1, // how fit he still is: 1 unhurt, 0 when he goes down (see wounds.js)
    blood: 1,
    bleeding: false,
    eyes: 2,
    eyeLost: null,
    unhorsed: false,
    epithet: null,
    stamina: 1,
    staminaCap: 1,
    nerve: nerveCap,
    nerveCap,
    skillMul: 1,
    speedMul: 1,
    shieldMul: 1,

    // State machine
    state: 'inRank',
    stateT: 0,
    slot: null,
    target: -1,
    aggressor: false,
    resolve: rng.range(0, 0.3),
    surgeReason: null,
    breathT: 0,
    halt: 0, // how strongly the word to step back has reached him
    wantsOut: false, // a front-rank man who has had enough and is calling for the line to ease off
    pinnedT: 0,
    attackT: rng.range(0, 1.5),
    supportT: rng.range(0, 2),
    fightT: 0,
    idleT: 0,
    noTargetT: 0,
    fleeT: 0,
    fleeCheckT: 0,
    routDelay: -1,

    // Body
    pos: { x: 0, y: 0 },
    prev: { x: 0, y: 0 },
    lag: { x: 0, y: 0 }, // where the men behind see him: his position a moment ago
    vel: { x: 0, y: 0 },
    facing: 0,

    // History
    wounds: [],
    record: { kills: 0, downed: 0, woundsGiven: 0, woundsTaken: 0, blocks: 0, fled: 0, surges: 0, fightT: 0 },
    diedAt: null,
    deathPhase: null,
    fellAt: null,
    fellPhase: null,
    fellBy: -1,
    fate: null, // after the battle, what became of a wounded man
    killedBy: -1,
    lastAttackT: -99,
    lastHitT: -99,
  };
}

// A light-armed man: no armour, a wicker pelte and a bundle of javelins. He fights in loose
// order, at a distance, and gets out of the way of hoplites.
export function createPeltast(rng, id, side, usedNames, quality = 'regular') {
  const s = createSoldier(rng, id, side, side, usedNames, { index: -1, quality, kit: 'poor', origins: null });
  s.kind = 'light';
  s.weapon = 'akontia';
  s.shield = 'pelte';
  s.armour = 'none';
  s.helmet = 'none';
  s.greaves = 'none';
  s.age = (s.veteran ? 28 : 17) + rng.int(14);
  s.javelins = LIGHT.javelins;
  s.throwT = rng.range(0, 3);
  s.refillT = 0;
  s.state = 'skirmishing';
  s.goal = null;
  return s;
}

// A horseman of a cavalry contingent, riding with the squadron on one wing.
export function createRider(rng, id, side, usedNames, contingent, wing) {
  const s = createSoldier(rng, id, side, side, usedNames, { index: contingent.index, quality: contingent.quality, kit: 'standard', origins: null });
  Object.assign(s, riderKit(rng));
  s.kind = 'horse';
  s.wing = wing;
  s.radius = HORSE.radius;
  s.javelins = HORSE.javelins;
  s.throwT = rng.range(0, 2);
  s.state = 'riding';
  s.goal = null;
  s.place = 0; // his place in the squadron's block
  s.meleeT = 0;
  s.wheelT = 0;
  return s;
}

// One number for "how good is this man", used by the placement presets.
export function quality(s) {
  return s.courage * 0.45 + s.skill * 0.35 + s.reputation * 0.2;
}
