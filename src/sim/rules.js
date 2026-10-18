// All tuning numbers and equipment live here, so balance changes never touch the logic.
// Distances are metres, times are seconds, rates are per second.

// Bump whenever the simulation changes how battles play out, so an old battle record is known
// not to replay exactly any more.
export const SIM_VERSION = 'pulsy-10';

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
  hangBack: 1.2, // how far a contingent much shakier than the rest of its line edges back from the enemy
  haltListen: 0.5, // how fast a man heeding that call loses his eagerness

  // Give and take along the line
  giveOnBlock: 0.15, // metres a man is driven back by a blow on his shield
  giveOnWound: 0.35,
  groundShift: 0.3, // how fast a line that keeps being pushed gives ground as a whole

  // Stamina
  staminaFight: 0.045,
  staminaSurge: 0.025,
  staminaRecover: 0.03,
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
  // Word from the next contingent along has to be passed man to man to the commander: longer
  // across a wide contingent, faster among veterans who know what to pass on.
  wordBase: 1.5, // seconds
  wordPerFile: 0.5, // seconds per file of his own contingent's frontage
  wordRelay: { veteran: 0.75, regular: 1, green: 1.5 },
  lineSlack: 3, // how far a contingent will get ahead of its neighbours before waiting for them
  flankFear: 0.08, // how much sooner a commander pulls back once he hears his flank is open
  quietEnd: 20, // seconds with no part of either line facing the enemy before the battle is over
  impactSettle: 12, // seconds after a charge strikes before a shaken commander can order his men back
  withdrawNerve: 0.45,
  standoffIdle: 15,
  standoffNerve: 0.55,
  pursuitTime: 10,
  followTime: 15,
  endDistance: 22,
  maxBattle: 420,

  fieldHalfW: 90,
  fieldHalfH: 60,
};

export const WEAPONS = {
  dory: { name: 'Dory', desc: 'thrusting spear', reach: 2.4, interval: 1.7, damage: 0.55, secondRank: true, thrust: true },
  xiphos: { name: 'Xiphos', desc: 'short sword', reach: 1.25, interval: 1.2, damage: 0.6, secondRank: false, thrust: false },
  kopis: { name: 'Kopis', desc: 'heavy chopping blade', reach: 1.35, interval: 1.45, damage: 0.75, secondRank: false, thrust: false },
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
