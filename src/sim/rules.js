// All tuning numbers and equipment live here, so balance changes never touch the logic.
// Distances are metres, times are seconds, rates are per second.

// Bump whenever the simulation changes how battles play out, so an old battle record is known
// not to replay exactly any more.
export const SIM_VERSION = 'pulsy-24';

export const TUNING = {
  dt: 0.05, // fixed simulation step (20 Hz)

  // Formation geometry
  fileSpacing: 0.95,
  rankSpacing: 1.1,
  bodyRadius: 0.3,
  startDistance: 60,

  // Contact
  gap: 3.2, // distance between the front ranks during a lull
  contactRange: 9, // front ranks closer than this count as in contact
  surgeReach: 4.5, // furthest a man will step out of his slot
  surgeSearch: 5.5, // how far a surging man looks for someone to fight

  // Movement speeds
  formationPace: 1.1,
  giveGround: 0.45,
  withdrawPace: 0.8,
  walk: 1.4,
  surgePace: 1.7,
  run: 3.6,
  turnRate: 0.5,

  // Charges
  chargeDistance: 32, // how far out a unit may break into a run
  chargePace: 2.6,
  screenClear: 30, // phalanxes this close, and their light troops get out of the way
  skirmishTime: 75, // how long a phalanx waits behind its screen before it advances anyway
  curlRate: 0.05, // how fast the overlapping end of a line wraps round the enemy's end (the nearest files in about 20 s)
  curlDeterred: 4, // this many enemy peltasts out on a flank stop that end wrapping round at all
  curlStand: 3.2, // how far out from the enemy's end the curled files stand: a spear's length, as along the front
  flankFear: 0.01, // extra nerve lost per second by a man with a curled file at his unshielded side
  approachFear: 40, // an advancing enemy starts to frighten men inside this distance
  cohesionLossRun: 0.035, // order lost per second at a run
  cohesionRecover: 0.03, // order regained per second when standing still
  shockBase: 0.27, // nerve shock of being hit by a charge
  impactBonus: 0.9, // how much harder the first blows land for men who arrive at a run

  // Surges and lulls
  resolveRate: 0.035, // how fast an average man works himself up during a lull
  resolvePull: 0.8, // how fast he is carried along when the man beside him goes forward
  resolveCall: 0.4, // an officer calling "Forward!"
  resolveOpening: 1.2, // seeing an opening across the gap
  resolveSpend: 0.12, // resolve burnt per second of fighting
  resolveAlone: 0.4, // extra burnt when the men beside him have pulled back

  // The ranks behind the front
  eagerRate: 0.04, // how fast a man waiting behind the front works himself up to get into the fight
  pressForward: 1.5, // metres an eager man presses forward of his place
  pressPush: 0.5, // how strongly the men pressing from behind urge the front rank on
  haltRelay: 0.55, // share of the call to step back a raw man passes on to the man behind him
  haltListen: 0.5, // how fast a man heeding that call loses his eagerness

  // Give and take along the line
  giveOnBlock: 0.15, // metres a man is driven back by a blow on his shield
  giveOnWound: 0.35,
  groundShift: 0.3, // how fast a line that keeps being pushed gives ground as a whole

  // Stamina
  staminaFight: 0.045,
  staminaSurge: 0.025,
  staminaRecover: 0.008, // a spent man needs a minute and more to get his strength back
  staminaRun: 0.02,

  // Blows
  hitBase: 0.17,
  extraAttacker: 0.4, // each extra attacker makes a blow this much likelier to land

  // Nerve thresholds
  nerveWaver: 0.3,
  nerveSteady: 0.4,
  nerveFlee: 0.15,
  nerveRally: 0.45,

  // Unit decisions
  routFleeing: 0.35, // share of men running that turns a unit into a rout
  breakOnCharge: 0.2, // share wavering or running that makes a line turn before a charge hits
  impactSettle: 12, // seconds after a charge strikes before a shaken commander can order his men back
  withdrawNerve: 0.45,
  standoffIdle: 15,
  depthShelter: 0.6, // how much of the fear of the enemy's approach five or more men in front of a man take away
  standoffNerve: 0.55,
  pursuitTime: 10,
  followTime: 15,
  endDistance: 22,
  apartDistance: 45, // lines that will not close again step back this far apart to rest
  restRegain: 0.75, // drawn apart, a man can rest back to this share of the way from his lowest in the fight to what he went in with
  apartMax: 150, // drawn apart this long with neither going in again, and the battle is over
  driveLimit: 26, // a tired line driving off javelin men goes no nearer the enemy phalanx than this
  reengageStamina: 0.75, // drawn apart, a line goes in again only this rested
  reengageNerve: 0.55, // and with this much heart
  maxBattle: 900, // from first contact; lines that draw apart and go in again can fight on a long time

  fieldHalfW: 90,
  fieldHalfH: 60,
};

export const WEAPONS = {
  dory: { name: 'Dory', desc: 'thrusting spear', reach: 2.4, interval: 1.7, damage: 0.55, secondRank: true, thrust: true },
  xiphos: { name: 'Xiphos', desc: 'short sword', reach: 1.25, interval: 1.2, damage: 0.6, secondRank: false, thrust: false },
  kopis: { name: 'Kopis', desc: 'heavy chopping blade', reach: 1.35, interval: 1.45, damage: 0.75, secondRank: false, thrust: false },
  akontia: { name: 'Javelins', desc: 'a bundle of light throwing spears', reach: 1.6, interval: 1.4, damage: 0.35, secondRank: false, thrust: true },
  palta: { name: 'Palta', desc: 'two cornel-wood spears, one to throw and one to thrust', reach: 2.2, interval: 1.4, damage: 0.4, secondRank: false, thrust: true },
};

// Horsemen. Not knights: they will not ride into a hedge of spears, but they are many times
// faster than any man on foot, and fall on what is in the open, or caught from behind.
export const HORSE = {
  walk: 2,
  trot: 4,
  canter: 7,
  gallop: 10,
  radius: 0.9, // a horse takes up three men's room
  spaceX: 2, // between riders across the squadron
  spaceY: 3.4, // and from one rank of it to the next
  javelins: 1, // one palton to throw; the other is kept to fight with
  throwMin: 7,
  throwMax: 18,
  gallopCost: 0.012, // stamina per second at the gallop
  canterCost: 0.004,
  recover: 0.006, // per second at a walk or standing
  impact: 1.8, // how much likelier the first blow is from a rider who arrives at the gallop
  shock: 0.08, // the nerve shock of being ridden into, worse from where the shield is not
  fear: 0.02, // per second, for a hoplite with horsemen at his side or back
  bigTarget: 1.3,
  horseWound: 0.3, // how much of a wound to his horse tells on the rider himself // a horse is easier to hit than a man
  hitAndRun: 3, // seconds a rider stays at grips with hoplites before he wheels away
  pass: 2.5, // and with another horseman: cavalry fights are passes, not a standing fight
  moving: 0.6, // how much harder a rider on the move is to hit
  chargeFear: 0.05, // per second, for a rider with enemy horsemen coming at him faster than he is moving
  shaken: 0.45, // a rider with less nerve than this hangs back rather than go in again
  losses: 0.08, // nerve per second for a rider whose squadron has lost all its men; less for fewer
  breakNerve: 0.5, // a squadron whose riders are this shaken on average gives way as a body
  jostle: 0.7, // horsemen at grips with horsemen: blows glance off a moving man on a moving horse
  wheelOut: 4, // seconds he rides away before coming round again
  bogged: 0.07, // nerve per second for a rider stuck among the enemy, his horse barely moving
  raidTime: 14, // seconds a squadron stays on the enemy's flank or rear before pulling out
  regroup: 8, // seconds to re-form afterwards
  raidDeterred: 0.6, // enemy light troops with javelins at an end of the line, per rider, that keep a squadron from riding round it
  safeRaid: 80, // enemy horse further off than this cannot come up before a raid is done
  shelter: 7, // light troops this close to their own hoplites are too well covered to ride at
  lightFear: 30, // horsemen this close and a light man runs for the cover of his hoplites
  pursuitTime: 25,
  rallyTime: 75, // s a broken squadron has to rally before it rides off the field
  restStamina: 0.35, // a squadron this blown pulls back to rest
  readyStamina: 0.7, // and goes out again this rested
};

// Light troops in loose order, who fight at a distance with javelins.
export const LIGHT = {
  javelins: 6, // carried into the fight
  reserve: 2, // kept back in the skirmish for when the lines meet
  range: 24, // the longest throw worth making
  bestRange: 14, // where a man likes to stand to throw
  minRange: 5,
  interval: 5, // seconds between throws for a fresh man
  damage: 0.38,
  keepAway: 10, // a hoplite this close and he backs off
  safeAgain: 16, // and he keeps going until the hoplite is this far away
  screenAhead: 16, // how far in front of their own phalanx the screen starts: just out of the enemy screen's reach
  refill: 4, // seconds to pick up a spent javelin, out of throwing range
  strungFear: 4, // how much more javelins frighten men wrapped round the end of an enemy line
  bundle: 5, // seconds to take up one man's load of javelins from the spares behind the line
  carryFor: 3, // a man going back for javelins brings loads for this many friends too
  carrierShare: 0.15, // the share of the light troops who do no throwing, only carry javelins up
  carryLoads: 3, // loads a carrier brings up at a time
  rallyTime: 90, // s a broken band has to rally before it gives up and leaves the field
  walk: 1.7,
  jog: 3,
  run: 4.3,
};

export const SHIELDS = {
  aspis: { name: 'Aspis', desc: 'large round shield', block: 0.55, fatigue: 1.2, radius: 0.45 },
  pelte: { name: 'Pelte', desc: 'light wicker shield', block: 0.35, fatigue: 1.05, radius: 0.3 },
  none: { name: 'None', desc: '', block: 0, fatigue: 1, radius: 0 },
};

export const ARMOUR = {
  none: { name: 'None', desc: '', torso: 0, fatigue: 1 },
  linothorax: { name: 'Linothorax', desc: 'layered linen cuirass', torso: 0.35, fatigue: 1.08 },
  bronze: { name: 'Bronze cuirass', desc: 'bell or muscle cuirass', torso: 0.55, fatigue: 1.2 },
};

export const HELMETS = {
  none: { name: 'None', desc: '', head: 0 },
  pilos: { name: 'Pilos', desc: 'conical bronze cap', head: 0.35 },
  corinthian: { name: 'Corinthian', desc: 'enclosed bronze helmet', head: 0.6 },
};

// Wound locations: [name, chance, which protection applies]
export const WOUND_LOCATIONS = [
  ['head', 0.14, 'helmet'],
  ['torso', 0.34, 'armour'],
  ['spear arm', 0.14, null],
  ['shield arm', 0.1, null],
  ['leg', 0.28, null],
];

export function pickWeighted(rng, pairs) {
  const total = pairs.reduce((a, p) => a + p[1], 0);
  let r = rng.next() * total;
  for (const p of pairs) {
    r -= p[1];
    if (r <= 0) return p[0];
  }
  return pairs[pairs.length - 1][0];
}

// A rider's kit: the cavalry were the richer men, with a cuirass and an open helmet, no shield.
export function riderKit(rng) {
  return {
    weapon: 'palta',
    shield: 'none',
    armour: pickWeighted(rng, [['bronze', 0.35], ['linothorax', 0.45], ['none', 0.2]]),
    helmet: pickWeighted(rng, [['pilos', 0.7], ['corinthian', 0.05], ['none', 0.25]]),
  };
}

// Where a blow or a javelin lands on a man on horseback: often the horse.
export const RIDER_WOUND_LOCATIONS = [
  ['head', 0.1, 'helmet'],
  ['torso', 0.25, 'armour'],
  ['spear arm', 0.1, null],
  ['leg', 0.15, null],
  ['horse', 0.4, null],
];

// A hoplite's kit, a little better for veterans who have had years to buy it.
// What kind of men a contingent is made of.
export const QUALITIES = {
  veteran: { name: 'Veteran', veterans: 0.4, courage: 0.1, skill: 0.12, reputation: 0.1 },
  regular: { name: 'Regular', veterans: 0.12, courage: 0, skill: 0, reputation: 0 },
  green: { name: 'Green', veterans: 0.02, courage: -0.12, skill: -0.15, reputation: -0.05 },
};

// How well a contingent is equipped. Veterans have usually had years to buy better kit.
export const KITS = {
  well: {
    name: 'Well equipped',
    short: 'well equipped',
    armour: [['bronze', 0.6], ['linothorax', 0.4]],
    helmet: [['corinthian', 0.7], ['pilos', 0.3]],
    shield: [['aspis', 1]],
  },
  standard: {
    name: 'Standard kit',
    short: 'standard kit',
    armour: [['bronze', 0.2], ['linothorax', 0.55], ['none', 0.25]],
    helmet: [['corinthian', 0.3], ['pilos', 0.5], ['none', 0.2]],
    shield: [['aspis', 1]],
  },
  poor: {
    name: 'Poorly equipped',
    short: 'poorly equipped',
    armour: [['linothorax', 0.35], ['none', 0.65]],
    helmet: [['pilos', 0.45], ['none', 0.55]],
    shield: [['aspis', 0.6], ['pelte', 0.4]],
  },
};

export function hopliteKit(rng, veteran, kit = 'standard') {
  const k = KITS[kit] || KITS.standard;
  const better = (pairs, best) => (veteran ? pairs.map(([n, w]) => [n, n === best ? w * 2 : w]) : pairs);
  return {
    weapon: 'dory',
    shield: pickWeighted(rng, k.shield),
    armour: pickWeighted(rng, better(k.armour, 'bronze')),
    helmet: pickWeighted(rng, better(k.helmet, 'corinthian')),
  };
}
