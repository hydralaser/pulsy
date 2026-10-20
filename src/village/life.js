import { VILLAGE, FIELDS, FLOCK, HOUSE, LIFE, WOOD, MONTHS, DAYS_IN_YEAR, ECONOMY, COUNCIL } from './rules.js';
import { aliveHouseholds, dailyGrain, dailyFuel, market, pay, totals } from './economy.js';
import { clamp } from '../sim/core.js';
import { villageRng, createPerson, ageYears, lifeStage, canFight, equip } from './people.js';
import { workRate, practise } from './work.js';
import { onDeath, familyDay, dowry, inheritKit } from './family.js';
import { tiesDay, addTie } from './council.js';
import { monthOf, yearOf, logNews } from './clock.js';

// Midnight: the day is reckoned up.
export function endOfDay(v) {
  familyDay(v);
  tiesDay(v);
  const rng = villageRng(v);
  const m = monthOf(v);
  const living = v.people.filter((p) => p.alive);

  // Milk and cheese, if the flock was out on good grazing in the season, to each household by the
  // sheep it owns; and the herders' pay, from the owners in the same shares.
  const hs = aliveHouseholds(v);
  const flockOwners = hs.filter((h) => h.sheep > 0);
  const sheep = flockOwners.reduce((a, h) => a + h.sheep, 0);
  if (v.flock.out && m >= FLOCK.milkFrom && m <= FLOCK.milkTo) {
    for (const h of flockOwners) h.stores.grain += h.sheep * FLOCK.milk;
    v.today.milk = sheep * FLOCK.milk;
  }
  for (const p of living) {
    if (p.task !== 'herd' || !p.workedHerd) continue;
    for (const h of flockOwners) pay(v, h.id, p.household, ECONOMY.herdWage * (h.sheep / sheep), 'herding');
  }
  // Hired hands' wages, and the hire of oxen and carts.
  for (const p of living) {
    if (p.hiredHours > 0 && p.hiredBy != null) pay(v, p.hiredBy, p.household, ECONOMY.wage * (p.hiredHours / 9), 'wages');
    p.hiredHours = 0;
    p.workedHerd = false;
  }
  for (const x of v.hired || []) pay(v, x.from, x.to, x.kg, x.why);
  v.hired = [];

  // Work at home: grinding, baking, water, then spinning and weaving with what time is left.
  // Whoever stayed home does it, man or woman.
  const short = new Set();
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
    // Spare hours go into spinning and weaving, as far as the household's wool goes.
    if (hours < HOUSE.hours) short.add(h.id);
    else {
      const cloth = Math.min(h.stores.wool, (hours - HOUSE.hours) * HOUSE.cloth);
      h.stores.wool -= cloth;
      h.stores.cloth += cloth;
    }
    // Clothes wear out.
    h.stores.cloth = Math.max(0, h.stores.cloth - ECONOMY.clothWear * h.members.filter((id) => v.people[id].alive).length);
  }

  // The evening's dealings at the gate: buying, selling, borrowing, paying back.
  market(v);

  // Each household eats from its own store; one without enough hands at home wastes some.
  const winter = MONTHS[m].season === 'winter';
  let anyHungry = false;
  let anyCold = false;
  for (const h of hs) {
    const members = h.members.map((id) => v.people[id]).filter((p) => p.alive);
    let need = dailyGrain(v, h) * (short.has(h.id) ? 1.15 : 1);
    // With the grain gone a household kills its sheep to eat.
    if (h.stores.grain < need && h.sheep > 0) {
      const n = Math.min(h.sheep, Math.ceil((need - h.stores.grain) / FLOCK.meat));
      h.sheep -= n;
      v.flock.head -= n;
      h.stores.grain += n * FLOCK.meat;
      if (!h.slaughtering) logNews(v, 'alarm', `The house of ${h.name}, out of grain, kills its sheep to eat.`, { house: h.id });
      h.slaughtering = true;
    } else h.slaughtering = false;
    const share = need > 0 ? Math.min(1, h.stores.grain / need) : 1;
    h.stores.grain = Math.max(0, h.stores.grain - need * share);
    for (const p of members) p.fed = clamp(p.fed * 0.93 + share * 0.07, 0, 1);
    if (share < 1) {
      anyHungry = true;
      if (!h.hungry) logNews(v, 'alarm', `The house of ${h.name} has no food left.`, { pause: true, house: h.id });
    }
    h.hungry = share < 1;
    // Firewood, for cooking, and in winter for warmth.
    const fuel = dailyFuel(v);
    const burnt = Math.min(fuel, h.stores.wood);
    h.stores.wood -= burnt;
    h.cold = winter && burnt < fuel * 0.6;
    if (h.cold) anyCold = true;
  }
  if (anyCold && !v.warnedCold) logNews(v, 'alarm', 'Some households have no firewood, and it is winter.', { pause: true });
  v.warnedCold = anyCold;
  v.hungry = anyHungry;

  // Sickness and death.
  for (const p of living) {
    const age = ageYears(v, p);
    let yearly = LIFE.deathByAge.find(([a]) => age < a)[1];
    const weak = age < 5 || age >= 60;
    if (p.fed < 0.7) yearly += (0.7 - p.fed) * (weak ? 6 : 2);
    const cold = v.households[p.household].cold;
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
      f.crop = f.ha * FIELDS.yield * (f.soil ?? 1) * v.rain * f.quality * (1 + FIELDS.weedGain * f.weeded) * rng.range(0.85, 1.15);
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
  // Each household's sheep share in it.
  const fl = v.flock;
  fl.head = hs.reduce((a, h) => a + h.sheep, 0);
  for (const h of hs) {
    if (!h.sheep) continue;
    h.sheepFrac = h.sheepFrac || 0;
    if (m === FLOCK.lambing) h.sheepFrac += h.sheep * 0.6 * FLOCK.lambs / 30 * rng.range(0.5, 1.5);
    let lost = h.sheep * FLOCK.oldAge;
    if (fl.out) lost += Math.max(0, fl.head - fl.herders * FLOCK.perHerder) * FLOCK.straying * (h.sheep / Math.max(1, fl.head));
    else lost += h.sheep * 0.002;
    h.sheepFrac -= lost;
    const whole = h.sheepFrac >= 0 ? Math.floor(h.sheepFrac) : Math.ceil(h.sheepFrac);
    h.sheep = Math.max(0, h.sheep + whole);
    h.sheepFrac -= whole;
  }
  fl.head = hs.reduce((a, h) => a + h.sheep, 0);
  // Shearing, in early summer.
  if (m === FLOCK.shearing && v.day % 30 === 0) {
    for (const h of hs) h.stores.wool += h.sheep * FLOCK.wool;
    logNews(v, 'season', `The sheep are sheared: ${Math.round(fl.head * FLOCK.wool)} kg of wool for the spinning.`);
  }

  // Felled trees grow back as coppice.
  for (const t of v.land.trees) {
    if (t.wood < t.max && t.felledOn != null) t.wood = Math.min(t.max, t.wood + t.max / (WOOD.regrow * DAYS_IN_YEAR));
  }

  const tot = totals(v);
  v.history.push({ day: v.day, grain: Math.round(tot.grain), wood: Math.round(tot.wood), common: Math.round(v.common.grain), people: living.length, flock: fl.head });

  // A household with nobody left: its land and what it had go to the village.
  for (const h of v.households) {
    if (h.extinct || h.members.some((id) => v.people[id].alive)) continue;
    h.extinct = true;
    for (const f of v.land.fields) if (f.owner === h.id) f.owner = -1;
    v.common.grain += h.stores.grain;
    h.stores.grain = 0;
    logNews(v, 'death', `The house of ${h.name} has died out. Its land goes to the village.`);
  }
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

export function die(v, p, cause) {
  p.alive = false;
  p.diedOn = v.day;
  p.cause = cause;
  p.state = 'dead';
  p.goal = null;
  onDeath(v, p);
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
    const d = dowry(v, old, v.households[man.household], wife);
    addTie(v, old.id, man.household, COUNCIL.marriage);
    old.members = old.members.filter((id) => id !== wife.id);
    wife.household = man.household;
    wife.homeAt = null;
    v.households[man.household].members.push(wife.id);
    const gifts = [d.grain >= 1 ? `${Math.round(d.grain)} kg of barley` : '', d.sheep ? `${d.sheep} sheep` : '', d.cloth >= 0.5 ? `${d.cloth.toFixed(1)} kg of cloth` : ''].filter(Boolean);
    logNews(v, 'marriage', `${man.name} marries ${wife.name}${gifts.length ? `, who brings a dowry of ${gifts.join(', ')}` : ''}.`);
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
      // His father's armour if it is laid by at home; otherwise what the house can afford.
      const inherited = inheritKit(v, p);
      if (!inherited) equip(v, rng, p);
      logNews(v, 'season', `${p.name} comes of age and takes up ${inherited ? 'the armour laid by in his house' : p.shield === 'aspis' ? 'a hoplite shield' : 'javelins'}.`);
    }
  }
}
