import { clamp } from '../sim/core.js';
import { hopliteKit } from '../sim/rules.js';
import { VILLAGE, DAYS_IN_YEAR } from './rules.js';
import { MEN, WOMEN, SLAVE_MEN, SLAVE_WOMEN } from './names.js';

// The village's random numbers. Unlike the battle's, its state is a plain number, so a village
// can be saved and loaded and carry on exactly as it would have.
export function villageRng(v) {
  const next = () => {
    v.rngState = (v.rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(v.rngState ^ (v.rngState >>> 15), 1 | v.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    normal: (mean, sd) => {
      const u = 1 - next();
      const w = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
    },
  };
}

export function ageOf(v, p) {
  return Math.floor((v.day - p.born) / DAYS_IN_YEAR);
}

export function ageYears(v, p) {
  return (v.day - p.born) / DAYS_IN_YEAR;
}

// What stage of life someone is at, for what they eat and what they can do.
export function lifeStage(v, p) {
  const a = ageYears(v, p);
  if (a < 2) return 'infant';
  if (a < VILLAGE.workAge) return 'child';
  if (a < VILLAGE.adultAge) return 'youth';
  if (a >= VILLAGE.elderAge) return 'elder';
  return 'adult';
}

// A man of fighting age: from his late teens to sixty.
export function canFight(v, p) {
  const a = ageYears(v, p);
  return p.sex === 'm' && !p.slave && a >= 18 && a < 60 && p.alive;
}

function pickName(rng, list, used) {
  let name = rng.pick(list);
  for (let i = 0; i < 20 && used.has(name); i++) name = rng.pick(list);
  used.add(name);
  return name;
}

// One person. Men of citizen families also get what the battle needs: courage, skill with
// spear and shield, the standing of a man others look to, and the kit his household can afford.
export function createPerson(v, rng, { sex, age, household, slave = false, father = -1, mother = -1, name = null }) {
  const id = v.people.length;
  const used = v.usedNames;
  const p = {
    id,
    name: name || pickName(rng, sex === 'm' ? (slave ? SLAVE_MEN : MEN) : (slave ? SLAVE_WOMEN : WOMEN), used),
    sex,
    slave,
    born: v.day - Math.round(age * DAYS_IN_YEAR) - rng.int(DAYS_IN_YEAR),
    household,
    father,
    mother,
    spouse: -1,
    alive: true,
    diedOn: null,
    cause: null,
    // Body and condition.
    strength: clamp(rng.normal(sex === 'm' ? 0.75 : 0.6, 0.1), 0.3, 1),
    fed: 1, // how well fed, over the last weeks
    health: 1,
    // Skill at the village's work, which grows with practice.
    skills: {
      farm: clamp(rng.normal(age > 14 ? 0.45 : 0.15, 0.12), 0.05, 0.95),
      wood: clamp(rng.normal(sex === 'm' && age > 14 ? 0.4 : 0.1, 0.12), 0.05, 0.95),
      herd: clamp(rng.normal(0.35, 0.12), 0.05, 0.95),
      house: clamp(rng.normal(sex === 'f' && age > 12 ? 0.55 : 0.1, 0.12), 0.05, 0.95),
      build: clamp(rng.normal(age > 14 ? 0.3 : 0.1, 0.1), 0.05, 0.95),
    },
    wounds: [],
    marks: [],
    // Where he is and what he is doing today.
    task: null,
    pos: { x: 0, y: 0 },
    goal: null,
    state: 'home',
    workedToday: 0,
  };
  // Fighting men: the same traits the battle gives its soldiers.
  if (sex === 'm' && !slave) {
    const battles = age > 20 ? rng.int(Math.max(1, Math.floor((age - 18) / 3))) : 0;
    const veteran = battles >= 4 && rng.chance(0.5);
    p.courage = clamp(rng.normal(0.5, 0.14) + (veteran ? 0.2 : 0), 0.12, 0.98);
    p.skill = clamp(rng.normal(0.4, 0.14) + Math.min(0.2, battles * 0.03) + (veteran ? 0.15 : 0), 0.1, 0.98);
    p.reputation = clamp(rng.normal(0.1, 0.08) + (veteran ? 0.4 : 0) + (age > 40 ? 0.1 : 0), 0, 0.9);
    p.battles = battles;
    p.veteran = veteran;
  }
  v.people.push(p);
  return p;
}

// A man's war gear comes from what his household can afford: a full panoply for the better off,
// a shield and spear for the middling, javelins and a wicker shield for the poor.
export function equip(v, rng, p) {
  const h = v.households[p.household];
  if (h.wealth > 0.45) Object.assign(p, hopliteKit(rng, p.veteran, h.wealth > 0.8 ? 'well' : h.wealth > 0.6 ? 'standard' : 'poor'));
  else Object.assign(p, { weapon: 'akontia', shield: 'pelte', armour: 'none', helmet: 'none', greaves: 'none' });
}

// The founding households: a farmer and his wife, their children, often an old parent or an
// unmarried brother, and in some, a slave.
// The first household is yours: the leading man of the village, in the great house.
export function foundHouseholds(v, rng, playerName) {
  for (let i = 0; i < VILLAGE.households; i++) {
    const mine = i === 0;
    const h = { id: i, house: i, assign: { m: null, f: null }, members: [], wealth: mine ? 0.95 : clamp(rng.normal(0.55, 0.2), 0.1, 1), cloth: 0, player: mine };
    v.households.push(h);
    const add = (opts) => {
      const p = createPerson(v, rng, { household: i, ...opts });
      h.members.push(p.id);
      return p;
    };
    const headAge = mine ? 36 + rng.int(8) : 28 + rng.int(28);
    const head = add({ sex: 'm', age: headAge, name: mine ? playerName : null });
    h.head = head.id;
    h.armoury = [];
    if (mine) {
      head.player = true;
      head.reputation = Math.max(head.reputation, 0.6);
      v.usedNames.add(playerName);
    }
    h.name = head.name;
    const wife = add({ sex: 'f', age: clamp(headAge - 10 - rng.int(8), 16, 45) });
    head.spouse = wife.id;
    wife.spouse = head.id;
    const wifeAge = Math.floor((v.day - wife.born) / DAYS_IN_YEAR);
    let kids = 0;
    for (let a = wifeAge - 17; a >= 0 && kids < 6; a -= 2 + rng.int(3)) {
      // Not every child lives.
      if (rng.chance(a < 5 ? 0.85 : 0.7)) {
        const sex = rng.chance(0.5) ? 'm' : 'f';
        // A son married off is still at home; a daughter of marrying age has gone to her husband's house.
        if (sex === 'f' && a >= 17) continue;
        add({ sex, age: a, father: head.id, mother: wife.id });
        kids++;
      }
    }
    if (headAge < 42 && rng.chance(0.45)) {
      const old = add({ sex: rng.chance(0.6) ? 'f' : 'm', age: headAge + 24 + rng.int(10) });
      head.father = old.sex === 'm' ? old.id : -1;
      head.mother = old.sex === 'f' ? old.id : -1;
    }
    if (rng.chance(0.2)) add({ sex: 'm', age: 18 + rng.int(14), father: head.father, mother: head.mother });
    if (h.wealth > 0.6 && rng.chance(0.6)) add({ sex: rng.chance(0.6) ? 'm' : 'f', age: 18 + rng.int(25), slave: true });
  }
  for (const p of v.people) if (canFight(v, p)) equip(v, rng, p);
}

// Who is related to whom, in a word, for the inspector.
export function kinOf(v, p) {
  const out = [];
  const name = (id) => (id >= 0 ? v.people[id].name : null);
  if (p.spouse >= 0) out.push(`${p.sex === 'm' ? 'husband of' : 'wife of'} ${name(p.spouse)}`);
  if (p.father >= 0) out.push(`${p.sex === 'm' ? 'son' : 'daughter'} of ${name(p.father)}`);
  else if (p.mother >= 0) out.push(`${p.sex === 'm' ? 'son' : 'daughter'} of ${name(p.mother)}`);
  return out.join(', ');
}
