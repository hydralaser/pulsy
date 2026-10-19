import { CLOCK, DAYS_IN_YEAR, FIELDS } from './rules.js';
import { createLand } from './land.js';
import { villageRng, foundHouseholds } from './people.js';
import { morning, stepWork, assign } from './work.js';
import { endOfDay, newYear, comeOfAge } from './life.js';
import { dawnOf, logNews } from './clock.js';
import { VILLAGE_NAME } from './names.js';

export const VILLAGE_VERSION = 'oinoe-1';

export function createVillage(seed) {
  const v = {
    version: VILLAGE_VERSION,
    seed,
    rngState: seed >>> 0,
    name: VILLAGE_NAME,
    day: 0,
    hour: 0,
    people: [],
    households: [],
    parties: [],
    nextPartyId: 1,
    log: [],
    history: [],
    today: {},
    rain: 1,
    oxen: 4, // yokes
    stores: { grain: 0, wood: 0 },
    usedNames: new Set(),
  };
  const rng = villageRng(v);
  v.land = createLand(rng);
  foundHouseholds(v, rng);
  for (const p of v.people) {
    const h = v.land.houses[p.household];
    p.pos = { x: h.x + rng.range(-3, 3), y: h.y + rng.range(-3, 3) };
  }
  v.flock = { head: 140, ewes: 85, lost: 0, herders: 0, out: false, pos: { ...v.land.fold }, goal: null };
  // Enough grain from last year's harvest to see them to this one, and seed for the sowing;
  // a woodpile for the start of winter.
  const need = v.people.length * 0.72 * 260;
  const seedNeed = v.land.fields.filter((f) => f.rotation === 0).reduce((a, f) => a + f.ha * FIELDS.seed, 0);
  v.stores.grain = Math.round(need + seedNeed);
  v.stores.wood = 6000;

  // The village's own habits before you take a hand: most households' men to the fields, one household's men to the near wood, one to the flock; the women at home.
  v.households.forEach((h, i) => {
    if (i === 0) assign(v, h, 'm', { kind: 'grove', id: 0 });
    else if (i === 1) assign(v, h, 'm', { kind: 'pasture', id: 0 });
    else assign(v, h, 'm', { kind: 'farm', id: 0 });
  });

  newYear(v);
  logNews(v, 'season', `${v.people.length} people in ${v.households.length} households. The Boeotian border is a morning's walk over the hills.`);
  return v;
}

// Run the village forward by some hours.
export function stepVillage(v, hours) {
  let left = hours;
  while (left > 1e-9) {
    const dt = Math.min(CLOCK.step, left);
    const before = v.hour;
    v.hour += dt;
    left -= dt;
    const dawn = dawnOf(v);
    if (before < dawn && v.hour >= dawn) morning(v);
    stepWork(v, dt);
    if (v.hour >= 24) {
      endOfDay(v);
      v.hour -= 24;
      v.day++;
      v.today = {};
      if (v.day % DAYS_IN_YEAR === 0) newYear(v);
      comeOfAge(v);
    }
  }
}

// Saving: everything is plain data except the set of names in use, which is rebuilt.
export function saveVillage(v) {
  const { usedNames, ...rest } = v;
  return JSON.stringify(rest);
}

export function loadVillage(text) {
  const v = JSON.parse(text);
  if (v.version !== VILLAGE_VERSION) throw new Error(`This save is from ${v.version}, not ${VILLAGE_VERSION}.`);
  v.usedNames = new Set(v.people.map((p) => p.name));
  return v;
}
