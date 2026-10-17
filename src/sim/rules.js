// All tuning numbers and equipment live here, so balance changes never touch the logic.
// Distances are metres, times are seconds, rates are per second.

export const TUNING = {
  dt: 0.05, // fixed simulation step (20 Hz)

  // Formation geometry
  fileSpacing: 0.95,
  rankSpacing: 1.1,
  bodyRadius: 0.3,
  startDistance: 26,

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

  // Surges and lulls
  surgeBase: 0.03, // a lone man's urge to step forward
  surgePull: 0.55, // how strongly men follow neighbours who step forward
  surgeCall: 1.0, // the effect of an officer calling "Forward!"
  lullMin: 3,
  lullRand: 5,
  fightEndurance: 4, // seconds of fighting before the moment passes...
  fightEnduranceCourage: 8, // ...plus this much more for the bravest

  // Stamina
  staminaFight: 0.045,
  staminaSurge: 0.025,
  staminaRecover: 0.03,
  staminaRun: 0.02,

  // Blows
  hitBase: 0.26,
  extraAttacker: 0.4, // each extra attacker makes a blow this much likelier to land

  // Nerve thresholds
  nerveWaver: 0.3,
  nerveSteady: 0.4,
  nerveFlee: 0.15,
  nerveRally: 0.45,

  // Unit decisions
  routFleeing: 0.35, // share of men running that turns a unit into a rout
  withdrawNerve: 0.45,
  standoffIdle: 15,
  standoffNerve: 0.55,
  pursuitTime: 15,
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
export function hopliteKit(rng, veteran) {
  return {
    weapon: 'dory',
    shield: 'aspis',
    armour: pickWeighted(rng, veteran
      ? [['bronze', 0.5], ['linothorax', 0.45], ['none', 0.05]]
      : [['bronze', 0.2], ['linothorax', 0.55], ['none', 0.25]]),
    helmet: pickWeighted(rng, veteran
      ? [['corinthian', 0.6], ['pilos', 0.35], ['none', 0.05]]
      : [['corinthian', 0.3], ['pilos', 0.5], ['none', 0.2]]),
  };
}
