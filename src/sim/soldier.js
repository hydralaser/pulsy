import { clamp } from './core.js';
import { hopliteKit } from './rules.js';
import { SIDES } from './names.js';

export function createSoldier(rng, id, side, unitIdx, usedNames) {
  const roster = SIDES[side];
  const veteran = rng.chance(0.12);
  const courage = clamp(rng.normal(0.5, 0.14) + (veteran ? 0.22 : 0), 0.12, 0.98);
  const skill = clamp(rng.normal(0.45, 0.14) + (veteran ? 0.25 : 0), 0.1, 0.98);
  const reputation = veteran ? rng.range(0.5, 0.9) : clamp(rng.normal(0.12, 0.08), 0, 0.4);
  const nerveCap = 0.55 + 0.45 * courage;

  let name = rng.pick(roster.names);
  for (let tries = 0; usedNames.has(name) && tries < 20; tries++) name = rng.pick(roster.names);
  usedNames.add(name);

  return {
    id,
    side,
    unit: unitIdx,
    name,
    origin: rng.pick(roster.origins),
    age: veteran ? 34 + rng.int(18) : 19 + rng.int(18),
    battles: veteran ? 4 + rng.int(9) : rng.int(3),
    veteran,
    courage,
    skill,
    reputation,
    ...hopliteKit(rng, veteran),

    // Condition
    health: 1,
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
    cooldown: rng.range(0, 3),
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
    vel: { x: 0, y: 0 },
    facing: 0,

    // History
    wounds: [],
    record: { kills: 0, woundsGiven: 0, woundsTaken: 0, blocks: 0, fled: 0 },
    diedAt: null,
    deathPhase: null,
    killedBy: -1,
    lastAttackT: -99,
    lastHitT: -99,
  };
}

// One number for "how good is this man", used by the placement presets.
export function quality(s) {
  return s.courage * 0.45 + s.skill * 0.35 + s.reputation * 0.2;
}
