import { CLOCK, DAYS_IN_YEAR } from './rules.js';
import { createLand, ensureWild } from './land.js';
import { settleOwnership, startingStores } from './economy.js';
import { villageRng, foundHouseholds } from './people.js';
import { morning, stepWork } from './work.js';
import { endOfDay, newYear, comeOfAge } from './life.js';
import { initCouncil, decideDay, thinkAhead } from './council.js';
import { dawnOf, logNews } from './clock.js';
import { VILLAGE_NAME } from './names.js';
import { initWar, warDay } from './war.js';
import { initTools, cityDay } from './smith.js';
import { raidDay } from './public.js';

export const VILLAGE_VERSION = 'oinoe-4';

export function createVillage(seed, playerName = 'Philon') {
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
    carts: 2,
    projects: [],
    nextProjectId: 1,
    usedNames: new Set(),
  };
  const rng = villageRng(v);
  v.land = createLand(rng);
  foundHouseholds(v, rng, playerName);
  for (const p of v.people) {
    const h = v.land.houses[p.household];
    p.pos = { x: h.x + rng.range(-3, 3), y: h.y + rng.range(-3, 3) };
  }
  v.flock = { head: 140, ewes: 85, lost: 0, herders: 0, out: false, pos: { ...v.land.fold }, goal: null };
  // Who owns what, and what each household has laid by from last year.
  settleOwnership(v, rng);
  startingStores(v, rng);
  initTools(v, rng);
  v.smith = null; // the village has no smith until a house sets up a forge
  v.trips = [];

  // Each household runs its own life; at the start one has been cutting wood for the village and one
  // has been minding the flock, and both carry on until they choose otherwise.
  initCouncil(v, rng);
  v.households[1].plan = { kind: 'wood', half: 'm', grove: 0, until: 90, since: 0, forSale: true };
  v.households[2].plan = { kind: 'herd', half: 'm', since: 0 };
  decideDay(v);
  initWar(v);

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
    if (before < dawn && v.hour >= dawn) {
      // Households think over what they want, then go where their plans, or your orders, send them.
      thinkAhead(v);
      cityDay(v);
      decideDay(v);
      morning(v);
    }
    stepWork(v, dt);
    if (v.hour >= 24) {
      endOfDay(v);
      v.hour -= 24;
      v.day++;
      v.today = {};
      warDay(v);
      raidDay(v);
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
  ensureWild(v);
  // Saves from before households ran their own lives.
  if (!v.petitions) initCouncil(v, villageRng(v));
  initWar(v);
  return v;
}
