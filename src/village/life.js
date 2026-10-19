import { VILLAGE, FIELDS, FLOCK, HOUSE, LIFE, WOOD, MONTHS, DAYS_IN_YEAR } from './rules.js';
import { clamp } from '../sim/core.js';
import { villageRng, createPerson, ageYears, lifeStage, canFight, equip } from './people.js';
import { workRate, practise } from './work.js';
import { monthOf, yearOf, logNews } from './clock.js';

// Midnight: the day is reckoned up.
export function endOfDay(v) {
  const rng = villageRng(v);
  const m = monthOf(v);
  const living = v.people.filter((p) => p.alive);

  // Milk and cheese, if the flock was out on good grazing in the season.
  if (v.flock.out && m >= FLOCK.milkFrom && m <= FLOCK.milkTo) {
    const milk = v.flock.head * FLOCK.milk;
    v.stores.grain += milk;
    v.today.milk = milk;
  }

  // Work at home: grinding, baking, water, then spinning and weaving with what time is left.
  // Whoever stayed home does it, man or woman.
  let shortHouses = 0;
  for (const h of v.households) {
    let hours = 0;
    for (const id of h.members) {
      const p = v.people[id];
      if (!p.alive || p.task !== 'house') continue;
      hours += 9 * workRate(v, p, 'house');
      practise(p, 'house', 9);
    }
    h.houseHours = hours;
    if (!h.members.some((id) => v.people[id].alive)) continue;
    if (hours < HOUSE.hours) shortHouses++;
    else h.cloth += (hours - HOUSE.hours) * HOUSE.cloth;
  }

  // Food. Everyone eats from the village stores; a household without enough hands at home wastes
  // some of it.
  let need = 0;
  for (const p of living) need += VILLAGE.ration[rationOf(v, p)];
  need *= 1 + 0.15 * (shortHouses / Math.max(1, v.households.length));
  // With the grain gone they kill the sheep, keeping back the best ewes as long as they can.
  if (v.stores.grain < need && v.flock.head > 20) {
    const n = Math.min(v.flock.head - 20, Math.ceil((need - v.stores.grain) / FLOCK.meat));
    v.flock.head -= n;
    v.stores.grain += n * FLOCK.meat;
    if (!v.slaughtering) logNews(v, 'alarm', 'With no grain left, the village starts killing the flock to eat.');
    v.slaughtering = true;
  } else v.slaughtering = false;
  const share = need > 0 ? Math.min(1, v.stores.grain / need) : 1;
  v.stores.grain = Math.max(0, v.stores.grain - need * share);
  for (const p of living) p.fed = clamp(p.fed * 0.93 + share * 0.07, 0, 1);
  v.today.ate = need * share;
  if (share < 1 && !v.hungry) logNews(v, 'alarm', 'The grain has run out. The village goes hungry.', { pause: true });
  v.hungry = share < 1;
  const daysLeft = v.stores.grain / Math.max(1, need);
  if (daysLeft < 30 && !v.warnedLow && share >= 1) {
    logNews(v, 'alarm', `Grain for about ${Math.floor(daysLeft)} more days.`, { pause: true });
    v.warnedLow = true;
  }
  if (daysLeft > 60) v.warnedLow = false;

  // Firewood: for cooking, and in winter for warmth.
  const winter = MONTHS[m].season === 'winter';
  const fuel = v.households.filter((h) => h.members.some((id) => v.people[id].alive)).length * (winter ? VILLAGE.fuel.winter : VILLAGE.fuel.summer);
  const burnt = Math.min(fuel, v.stores.wood);
  v.stores.wood -= burnt;
  const cold = winter && burnt < fuel * 0.6;
  if (burnt < fuel && !v.noFuel) logNews(v, 'alarm', 'The firewood has run out.', { pause: true });
  v.noFuel = burnt < fuel;

  // Sickness and death.
  for (const p of living) {
    const age = ageYears(v, p);
    let yearly = LIFE.deathByAge.find(([a]) => age < a)[1];
    const weak = age < 5 || age >= 60;
    if (p.fed < 0.7) yearly += (0.7 - p.fed) * (weak ? 6 : 2);
    if (cold && weak) yearly *= 2;
    // Health comes back slowly, and goes with hunger.
    p.health = clamp(p.health + (p.fed > 0.8 ? 0.01 : -0.01 * (0.8 - p.fed) * 10), 0.2, 1);
    if (rng.chance(yearly / DAYS_IN_YEAR)) die(v, p, p.fed < 0.6 ? 'hunger' : cold && weak ? 'the cold' : age < 5 ? 'a childhood fever' : age > 55 ? 'old age' : 'a sickness');
  }

  // Births.
  for (const p of living) {
    if (!p.alive || p.sex !== 'f' || p.spouse < 0 || !v.people[p.spouse].alive) continue;
    const age = ageYears(v, p);
    if (age < 16 || age > 40) continue;
    const baby = v.people.some((c) => c.alive && c.mother === p.id && ageYears(v, c) < 1.5);
    if (baby || !rng.chance(LIFE.birthChance * p.fed / DAYS_IN_YEAR)) continue;
    birth(v, rng, p);
  }

  // Marriages, at the turn of Gamelion, the month of weddings.
  if (v.day % DAYS_IN_YEAR === 3 * 30) marriages(v, rng);

  // Fields through the year.
  for (const f of v.land.fields) {
    if (f.state === 'sown' && m >= FIELDS.ripe && f.sown >= 1) {
      f.state = 'ripe';
      f.crop = f.ha * FIELDS.yield * v.rain * f.quality * (1 + FIELDS.weedGain * f.weeded) * rng.range(0.85, 1.15);
      f.ripeDays = 0;
      f.reaped = 0;
      f.harvested = 0;
    } else if (f.state === 'ripe') {
      f.ripeDays++;
      if (f.ripeDays > 10) f.crop *= 1 - FIELDS.shatter;
      if (f.ripeDays > 45) {
        logNews(v, 'alarm', `The barley on ${f.name} was never reaped and is lost.`);
        f.state = 'stubble';
        f.sown = 0;
      }
    } else if (f.state === 'stubble' && f.sown > 0 && m > FIELDS.sowTo) {
      // The sowing season is over: what was sown of a half-sown field grows.
      f.state = 'sown';
      f.quality = FIELDS.lateSow * f.sown;
      f.sown = 1;
    }
  }
  if (v.land.fields.some((f) => f.state === 'ripe' && f.ripeDays === 0)) logNews(v, 'field', 'The barley is ripe. Get it in before it sheds its grain.', { pause: true });

  // The flock: lambs in winter, losses to wolves and straying when too few watch them, and to age.
  const fl = v.flock;
  if (m === FLOCK.lambing) fl.head += Math.round(fl.ewes * FLOCK.lambs / 30 * rng.range(0.5, 1.5));
  let lost = fl.head * FLOCK.oldAge;
  if (fl.out) lost += Math.max(0, fl.head - fl.herders * FLOCK.perHerder) * FLOCK.straying;
  else lost += fl.head * 0.002;
  fl.lost += lost;
  if (fl.lost >= 1) {
    const n = Math.floor(fl.lost);
    fl.head = Math.max(0, fl.head - n);
    fl.lost -= n;
  }
  if (m === FLOCK.lambing && v.day % 30 === 0) fl.ewes = Math.round(fl.head * 0.6);

  // Felled trees grow back as coppice.
  for (const t of v.land.trees) {
    if (t.wood < t.max && t.felledOn != null) t.wood = Math.min(t.max, t.wood + t.max / (WOOD.regrow * DAYS_IN_YEAR));
  }

  v.history.push({ day: v.day, grain: Math.round(v.stores.grain), wood: Math.round(v.stores.wood), people: living.length, flock: fl.head });
  if (v.history.length > 800) v.history.shift();
}

// The first day of the year: the autumn rains tell what kind of year it will be.
export function newYear(v) {
  const rng = villageRng(v);
  v.rain = clamp(rng.normal(1, 0.2), 0.45, 1.35);
  const word = v.rain < 0.7 ? 'The autumn rains are poor. It will be a lean year.' : v.rain > 1.15 ? 'Good rains this autumn.' : 'The autumn rains come.';
  logNews(v, 'season', `Year ${yearOf(v)}. ${word} Time to plough and sow.`, { pause: v.day > 0 });
  for (const f of v.land.fields) {
    f.ploughed = 0;
    f.sown = 0;
    f.weeded = 0;
    if (f.state !== 'ripe') f.state = 'stubble';
  }
}

function rationOf(v, p) {
  const s = lifeStage(v, p);
  if (s === 'infant') return 'infant';
  if (s === 'child' || s === 'youth') return 'child';
  if (s === 'elder') return 'elder';
  return p.sex === 'm' ? 'man' : 'woman';
}

export function die(v, p, cause) {
  p.alive = false;
  p.diedOn = v.day;
  p.cause = cause;
  p.state = 'dead';
  p.goal = null;
  const age = Math.floor(ageYears(v, p));
  const who = age < 2 ? `The infant ${p.sex === 'm' ? 'son' : 'daughter'} of ${v.people[p.mother]?.name || 'a household'}` : `${p.name}, ${age}`;
  logNews(v, 'death', `${who} dies of ${cause}.`, { who: p.id });
}

function birth(v, rng, mother) {
  const father = v.people[mother.spouse];
  const sex = rng.chance(0.51) ? 'm' : 'f';
  // A first son was named for his father's father.
  const grandfather = father.father >= 0 ? v.people[father.father] : null;
  const firstSon = sex === 'm' && !v.people.some((c) => c.father === father.id && c.sex === 'm');
  const name = firstSon && grandfather ? grandfather.name : null;
  const child = createPerson(v, rng, { sex, age: 0, household: father.household, father: father.id, mother: mother.id, name });
  child.born = v.day;
  child.pos = { ...mother.pos };
  v.households[father.household].members.push(child.id);
  logNews(v, 'birth', `${mother.name}, wife of ${father.name}, gives birth to a ${sex === 'm' ? 'son' : 'daughter'}, ${child.name}.`, { who: child.id });
}

// Men of thirty or so marry girls in their late teens from other households. The bride moves into
// her husband's household.
function marriages(v, rng) {
  const single = (p, lo, hi) => p.alive && !p.slave && p.spouse < 0 && ageYears(v, p) >= lo && ageYears(v, p) <= hi;
  const men = v.people.filter((p) => p.sex === 'm' && single(p, VILLAGE.marryMan, 45));
  const women = v.people.filter((p) => p.sex === 'f' && single(p, VILLAGE.marryWoman, 30));
  for (const man of men) {
    const options = women.filter((w) => w.spouse < 0 && w.household !== man.household);
    if (!options.length) break;
    const wife = rng.pick(options);
    man.spouse = wife.id;
    wife.spouse = man.id;
    const old = v.households[wife.household];
    old.members = old.members.filter((id) => id !== wife.id);
    wife.household = man.household;
    v.households[man.household].members.push(wife.id);
    logNews(v, 'marriage', `${man.name} marries ${wife.name}.`);
  }
}

// On a man's eighteenth birthday he takes his place among the fighting men, with whatever his
// household can give him.
export function comeOfAge(v) {
  const rng = villageRng(v);
  for (const p of v.people) {
    if (p.alive && canFight(v, p) && !p.weapon) {
      if (p.courage == null) {
        p.courage = clamp(rng.normal(0.5, 0.14), 0.12, 0.98);
        p.skill = clamp(rng.normal(0.35, 0.12), 0.1, 0.98);
        p.reputation = clamp(rng.normal(0.05, 0.05), 0, 0.5);
        p.battles = 0;
        p.veteran = false;
      }
      equip(v, rng, p);
      logNews(v, 'season', `${p.name} comes of age and takes up ${p.shield === 'aspis' ? 'a hoplite shield' : 'javelins'}.`);
    }
  }
}
