import { VILLAGE, FIELDS, FLOCK, HOUSE, LIFE, WOOD, MONTHS, DAYS_IN_YEAR, ECONOMY, COUNCIL, EXERTION, GROWING, AGEING, HUNGER, RATION, HIRING, FAMILY } from './rules.js';
import { aliveHouseholds, dailyGrain, dailyFuel, market, pay, totals, rationOf, daysToHarvest, grainReserve } from './economy.js';
import { clamp } from '../sim/core.js';
import { villageRng, createPerson, ageYears, lifeStage, canFight, equip } from './people.js';
import { workRate, practise } from './work.js';
import { onDeath, familyDay, dowry, inheritKit } from './family.js';
import { tiesDay, addTie, addGoodwill } from './council.js';
import { projectOf } from './building.js';
import { repayRelief } from './sack.js';
import { neighboursYear, takeGroom, takeBride } from './neighbours.js';
import { orchardDay, orchardYear, useStores } from './orchard.js';
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
  // Wages paid out of the common granary for one house's own field or house: the other houses mind
  // (those whose men earned them less so). Public works are what it is for.
  let misuse = 0;
  const earners = new Set();
  for (const p of living) {
    if (p.hiredHours > 0 && p.hiredBy != null) {
      const kg = ECONOMY.wage * (p.hiredHours / 9);
      pay(v, p.hiredBy, p.household, kg, 'wages');
      const x = p.hiredBy < 0 ? projectOf(v, p.hiredFor) : null;
      if (x && !x.public) {
        misuse += kg;
        earners.add(p.household);
      }
    }
    p.hiredHours = 0;
    p.workedHerd = false;
  }
  if (misuse > 0) for (const h of aliveHouseholds(v)) addGoodwill(v, h, -HIRING.misuse * misuse * (earners.has(h.id) ? 0.3 : 1));
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
    // Clothes wear out; wine and oil are drunk and eaten, as far as the house has them.
    const people = h.members.filter((id) => v.people[id].alive).length;
    h.stores.cloth = Math.max(0, h.stores.cloth - ECONOMY.clothWear * people);
    useStores(v, h, people, ECONOMY.use);
  }

  // The evening's dealings at the gate: buying, selling, borrowing, paying back.
  market(v);

  // Each household eats from its own store; one without enough hands at home wastes some.
  const winter = MONTHS[m].season === 'winter';
  let anyHungry = false;
  let anyCold = false;
  const lendable = villageSpare(v, hs);
  for (const h of hs) {
    const members = h.members.map((id) => v.people[id]).filter((p) => p.alive);
    let need = members.reduce((a, p) => a + rationOf(v, p) * appetite(v, p), 0) * (short.has(h.id) ? 1.15 : 1);
    // Short rations, if the grain will not last to the harvest.
    // A house starts rationing once it is clearly short, and stops only when it has enough.
    let ration = rationing(v, h, lendable);
    if (!h.rationing && ration > 0.96) ration = 1;
    if (ration < 1 && !h.rationing) logNews(v, 'alarm', `The house of ${h.name} goes on short rations to make its grain last to the harvest.`, { house: h.id });
    else if (ration >= 1 && h.rationing) logNews(v, 'season', `The house of ${h.name} eats its fill again.`, { house: h.id });
    h.rationing = ration < 1 ? ration : 0;
    need *= ration;
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
    for (const p of members) {
      p.fed = clamp(p.fed * 0.93 + share * ration * 0.07, 0, 1);
      p.exertion = 0;
      // How well a boy was fed growing up, which shapes the man (comeOfAge).
      if (ageYears(v, p) < 18) p.upbringing = (p.upbringing ?? p.fed) * 0.998 + p.fed * 0.002;
    }
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
    body(v, p, age);
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
    if (f.kind) continue;
    if (f.state === 'sown' && m >= FIELDS.ripe && f.sown >= 1) {
      f.state = 'ripe';
      // The better for the fallow ploughed the year before, and the hoeing.
      f.crop = f.ha * FIELDS.yield * (f.soil ?? 1) * v.rain * f.quality * (1 + FIELDS.weedGain * f.weeded) * (1 + FIELDS.fallowGain * (f.prep || 0)) * rng.range(0.85, 1.15);
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
  if (v.land.fields.some((f) => !f.kind && f.state === 'ripe' && f.ripeDays === 0)) logNews(v, 'field', 'The barley is ripe. Get it in before it sheds its grain.', { pause: true });
  orchardDay(v);

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
  orchardYear(v);
  for (const f of v.land.fields) {
    if (f.kind || f.state === 'planting') continue;
    f.ploughed = 0;
    f.sown = 0;
    f.weeded = 0;
    if (f.state !== 'ripe') f.state = 'stubble';
  }
  repayRelief(v);
  neighboursYear(v);
  // A new year's reckoning of what each house lays out on the smith and the city.
  for (const h of v.households) {
    h.spentLast = h.spent || null;
    h.spent = {};
  }
  // What the year's rents for new land came to: a share of each harvest, taken at the reaping.
  const paid = [];
  for (const f of v.land.fields) {
    if (!f.rentTaken) continue;
    paid.push(`${Math.round(f.rentTaken)} kg from the house of ${v.households[f.owner].name}`);
    f.rentTaken = 0;
  }
  if (paid.length) logNews(v, 'trade', `This year's rents for new land, a share of each harvest: ${paid.join(', ')}.`);
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
// Widows and widowers marry again, and when there are more women to marry than men of the usual age,
// younger men marry too, the eldest first.
function marriages(v, rng) {
  const free = (p) => p.spouse < 0 || !v.people[p.spouse] || !v.people[p.spouse].alive;
  const single = (p, lo, hi) => p.alive && !p.slave && free(p) && ageYears(v, p) >= lo && ageYears(v, p) <= hi;
  const women = v.people.filter((p) => p.sex === 'f' && single(p, VILLAGE.marryWoman, VILLAGE.marryWomanLast));
  let men = v.people.filter((p) => p.sex === 'm' && single(p, VILLAGE.marryMan, VILLAGE.marryManLast));
  if (women.length > men.length) {
    const young = v.people.filter((p) => p.sex === 'm' && single(p, VILLAGE.marryManEarly, VILLAGE.marryMan - 0.001)).sort((a, b) => a.born - b.born);
    men = men.concat(young.slice(0, women.length - men.length));
  }
  for (const man of men) {
    // Girls in their teens and twenties first, as was the custom; then the widows.
    const options = women.filter((w) => free(w) && w.household !== man.household);
    if (!options.length) break;
    const young = options.filter((w) => ageYears(v, w) < 30);
    const wife = rng.pick(young.length ? young : options);
    women.splice(women.indexOf(wife), 1);
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
  // Beyond the village: a girl not yet married with nobody here to marry may be married into a
  // neighbouring deme, and goes to live there, with her dowry; a man of thirty or so with nobody here
  // brings a bride from one, with hers.
  for (const w of women) {
    if (!w.alive || w.spouse >= 0 || ageYears(v, w) >= 30 || !rng.chance(VILLAGE.marryOut)) continue;
    marryOut(v, rng, w);
  }
  for (const man of men) {
    if (!free(man) || ageYears(v, man) < VILLAGE.marryMan || !rng.chance(VILLAGE.marryIn)) continue;
    marryIn(v, rng, man);
  }
}

function marryOut(v, rng, w) {
  const h = v.households[w.household];
  // Only if a deme near has a man for her.
  const deme = takeGroom(v, rng);
  if (!deme) return;
  // Her dowry goes with her.
  const s = h.stores;
  const grain = Math.min(FAMILY.dowryGrain, s.grain * 0.1);
  const sheep = h.sheep >= 6 ? Math.min(3, Math.floor(h.sheep * 0.15)) : 0;
  s.grain -= grain;
  s.cloth *= 0.75;
  h.sheep -= sheep;
  v.flock.head = Math.max(0, v.flock.head - sheep);
  v.flock.ewes = Math.min(v.flock.ewes, v.flock.head);
  w.alive = false;
  w.diedOn = v.day;
  w.cause = `married into ${deme}`;
  w.gone = deme;
  logNews(v, 'marriage', `${w.name} of the house of ${h.name} is married to a man of ${deme}, and goes to live there.`, { house: h.id });
}

function marryIn(v, rng, man) {
  const h = v.households[man.household];
  // Only if a deme near has a girl for him.
  const deme = takeBride(v, rng);
  if (!deme) return;
  const wife = createPerson(v, rng, { sex: 'f', age: 16 + rng.int(8), household: h.id });
  wife.from = deme;
  wife.pos = { ...man.pos };
  h.members.push(wife.id);
  man.spouse = wife.id;
  wife.spouse = man.id;
  // What she brings with her.
  const grain = Math.round(FAMILY.dowryGrain * rng.range(0.3, 1));
  const sheep = rng.int(3);
  h.stores.grain += grain;
  h.stores.cloth += rng.range(0.5, 3);
  h.sheep += sheep;
  v.flock.head += sheep;
  v.flock.ewes += sheep;
  logNews(v, 'marriage', `${man.name} marries ${wife.name} of ${deme}, who comes to live in his house with a dowry of ${grain} kg of barley${sheep ? ` and ${sheep} sheep` : ''}.`, { house: h.id });
}

// Grain the village could lend or give: what households hold beyond what they must keep, and the
// common granary if it feeds the hungry.
function villageSpare(v, hs) {
  const spare = hs.reduce((a, h) => a + Math.max(0, h.stores.grain - grainReserve(v, h) - 50), 0);
  return spare + (v.relief ? v.common.grain : 0);
}

// How much a household eats against what it needs: all of it while its grain, with what its sheep
// would make and what it could borrow, will last to the harvest; less the shorter it is. In a
// lean year that runs short for everyone, everyone tightens their belts.
function rationing(v, h, lendable) {
  const days = Math.min(daysToHarvest(v), 120);
  const want = dailyGrain(v, h) * days;
  if (want <= 0) return 1;
  const have = h.stores.grain + h.sheep * FLOCK.meat + lendable;
  if (have >= want) return 1;
  return clamp(1 - RATION.depth * (1 - have / want), RATION.least, 1);
}

// A body over the years and the seasons: wasting with hunger and filling out again when fed;
// past middle age, losing strength and wind.
function body(v, p, age) {
  const lose = (k, x) => {
    if (p[k] == null || x <= 0) return 0;
    const before = p[k];
    p[k] = Math.max(k === 'strength' ? 0.3 : 0.12, before - x);
    return before - p[k];
  };
  if (p.fed < HUNGER.below) {
    const x = HUNGER.waste * (HUNGER.below - p.fed);
    p.wasted = p.wasted || { strength: 0, endurance: 0 };
    p.wasted.strength += lose('strength', x);
    p.wasted.endurance += lose('endurance', x);
  } else if (p.wasted && p.fed > 0.95) {
    for (const k of ['strength', 'endurance']) {
      const back = Math.min(p.wasted[k], HUNGER.regain);
      if (p[k] != null) p[k] = Math.min(k === 'strength' ? 1 : 0.98, p[k] + back);
      p.wasted[k] -= back;
    }
    if (p.wasted.strength <= 0 && p.wasted.endurance <= 0) p.wasted = null;
  }
  p.trainable = AGEING.trainable[age >= AGEING.old ? 2 : age >= AGEING.from ? 1 : 0];
  if (age >= AGEING.from) {
    const pace = (age >= AGEING.old ? 2 : 1) / DAYS_IN_YEAR;
    lose('strength', AGEING.strength * pace);
    lose('endurance', AGEING.endurance * pace);
  }
}

// What someone old enough to work eats today, against the plain ration: more after a heavy day,
// less after an idle one. Men away at war march and fight, and eat the full ration.
function appetite(v, p) {
  if (p.away || lifeStage(v, p) === 'infant' || lifeStage(v, p) === 'child') return 1;
  const day = Math.min(1.2, (p.exertion || 0) / EXERTION.day);
  return 1 + EXERTION.food * (day - EXERTION.usual);
}

// A boy's body as a man: from his house's wealth and how well he was fed, give or take a good
// deal, and what his work as a youth built on top.
function grownBody(v, rng, p) {
  const h = v.households[p.household];
  const start = clamp(GROWING.wealth * h.wealth + (1 - GROWING.wealth) * (p.upbringing ?? p.fed), 0, 1);
  const roll = (g, lo, hi) => clamp(rng.normal(g.low + (g.high - g.low) * start, g.spread), lo, hi);
  const gain = p.youthGain || { strength: 0, endurance: 0 };
  p.strength = clamp(roll(GROWING.strength, 0.3, 1) + gain.strength, 0.3, 1);
  p.endurance = clamp(roll(GROWING.endurance, 0.12, 0.98) + gain.endurance, 0.12, 0.98);
  p.youthGain = null;
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
        p.endurance = clamp(rng.normal(0.5, 0.14), 0.12, 0.98);
        p.reputation = clamp(rng.normal(0.05, 0.05), 0, 0.5);
        p.battles = 0;
        p.veteran = false;
      }
      grownBody(v, rng, p);
      // His father's armour if it is laid by at home; otherwise what the house can afford.
      const inherited = inheritKit(v, p);
      if (!inherited) equip(v, rng, p);
      logNews(v, 'season', `${p.name} comes of age and takes up ${inherited ? 'the armour laid by in his house' : p.shield === 'aspis' ? 'a hoplite shield' : 'javelins'}.`);
    }
  }
}
