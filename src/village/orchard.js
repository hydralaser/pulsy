import { ORCHARD, FIELDS, COUNCIL, ECONOMY, CITY } from './rules.js';
import { clamp } from '../sim/core.js';
import { logNews, monthOf } from './clock.js';
import { aliveHouseholds, dailyGrain, seedNeeded } from './economy.js';
import { villageRng, lifeStage } from './people.js';
import { freeWild, planField } from './building.js';

// Vines and olives. A house that has food in hand for a year or two, in barley or in coin to buy
// it, may give some of its land to them for good: one of its own fields, ploughed up and planted,
// or new ground cleared for the purpose. A planting bears nothing for some years (vines three,
// olives five) and is in full bearing after more; each year it wants pruning and digging round,
// and its crop gathered and pressed, wine in the autumn, oil in the winter, which is when the
// barley leaves men idle.

// How far a planting has come into bearing.
export function bearing(v, f) {
  if (!f.kind) return 0;
  const o = ORCHARD[f.kind];
  const years = (v.day - (f.planted ?? v.day)) / 360;
  if (years < o.bears) return 0;
  return clamp(0.25 + 0.75 * (years - o.bears) / Math.max(1, o.full - o.bears), 0.25, 1);
}

// Each day, for the plantings: the crop ripens in its month, and what is not gathered in time is
// lost. For the barley: sheaves left unthreshed too long rot.
export function orchardDay(v) {
  const rng = villageRng(v);
  const m = monthOf(v);
  const year = Math.floor(v.day / 360);
  behindDay(v, m, year);
  if (v.day % 30 === 15 && ORCHARD.dealerMonths.includes(m)) dealer(v);
  for (const f of v.land.fields) {
    if (!f.kind) {
      if (f.sheaves > 0 && m > FIELDS.threshTo) {
        const lost = f.sheaves * FIELDS.rot;
        f.sheaves -= lost;
        if (!f.rotting) logNews(v, 'alarm', `The sheaves from ${f.name} are still unthreshed, and begin to spoil.`, { house: f.owner });
        f.rotting = true;
      } else f.rotting = false;
      continue;
    }
    const o = ORCHARD[f.kind];
    if (f.state === 'growing' && m === o.gather.month && f.ripeYear !== year) {
      f.ripeYear = year;
      const b = bearing(v, f);
      if (b <= 0) continue;
      // The tending that went into this crop: this year's, for the vintage; last year's, for olives
      // picked in the winter before this year's digging.
      const care = o.gather.month > o.tend[0].from ? careOf(f) : f.care ?? 1;
      f.on = !f.on;
      const alt = o.alternate ? (f.on ? 1 + o.alternate : 1 - o.alternate) : 1;
      f.crop = f.ha * o.yield * b * (ORCHARD.neglect + (1 - ORCHARD.neglect) * care) * alt * (0.7 + 0.3 * v.rain) * rng.range(0.85, 1.15);
      f.state = 'ripe';
      f.ripeDays = 0;
      f.gathered = 0;
      f.gatheredAmount = 0;
      logNews(v, 'field', `The ${f.kind === 'vines' ? 'grapes' : 'olives'} on ${f.name} are ripe: time for ${o.gather.text}.`, { house: f.owner });
    } else if (f.state === 'ripe') {
      f.ripeDays = (f.ripeDays || 0) + 1;
      if (f.ripeDays > 20) f.crop *= 0.98;
      if (f.ripeDays > ORCHARD.lost) {
        logNews(v, 'alarm', `The ${f.kind === 'vines' ? 'grapes' : 'olives'} on ${f.name} were never gathered and are lost.`, { house: f.owner });
        f.state = 'growing';
      }
    }
  }
}

// Work a house left undone, in hectares' worth: counted as each season's work comes to its end,
// and each day a crop stands ripe too long or sheaves spoil. It is what makes a house want more
// hands, and buy a slave if it can.
function behindDay(v, m, year) {
  const first = v.day % 30 === 0;
  const add = (f, ha) => {
    if (f.owner < 0 || ha <= 0) return;
    const h = v.households[f.owner];
    h.behind = (h.behind || 0) + ha;
  };
  for (const f of v.land.fields) {
    if (f.state === 'ripe' && f.ripeDays > 10) add(f, f.ha / 30);
    if (f.rotting) add(f, f.sheaves / FIELDS.yield / 30);
    if (!first) continue;
    if (f.kind) {
      for (const t of ORCHARD[f.kind].tend) if (m === t.to + 1) add(f, (1 - Math.min(1, f[t.task === 'prune' ? 'pruned' : 'dug'] || 0)) * f.ha * 0.5);
      continue;
    }
    if (f.state === 'planting') continue;
    const sowYear = f.rotation === year % 2;
    if (sowYear && m === FIELDS.sowTo + 1 && f.state !== 'sown') add(f, (1 - (f.sown || 0)) * f.ha);
    if (sowYear && m === 6 && f.state === 'sown') add(f, (1 - (f.weeded || 0)) * f.ha * 0.3);
    if (!sowYear) FIELDS.fallow.forEach(([, to], pass) => { if (m === to + 1 && (f.passes || 0) <= pass) add(f, f.ha * 0.3); });
  }
}

// The dealer from Athens buys up the wine and oil the houses have beyond a year's own use, for coin.
function dealer(v) {
  const bought = [];
  let coin = 0;
  const regard = 1 + CITY.standing * ((v.war ? v.war.standing : 0.5) - 0.5) * 2;
  for (const h of aliveHouseholds(v)) {
    const people = h.members.filter((id) => v.people[id].alive).length;
    for (const good of ['wine', 'oil']) {
      const spare = Math.floor((h.stores[good] || 0) - ECONOMY.use[good] * people * 360);
      if (spare < 20) continue;
      const dr = (spare * ECONOMY.price[good] * ORCHARD.dealer * regard) / CITY.drachma;
      h.stores[good] -= spare;
      h.stores.coin = (h.stores.coin || 0) + dr;
      coin += dr;
      bought.push(`${spare} ${good === 'wine' ? 'litres of wine' : 'kg of oil'} from the house of ${h.name}`);
    }
  }
  if (bought.length) logNews(v, 'trade', `A dealer from Athens comes through with his carts, buying ${bought.join(', ')}: ${Math.round(coin)} drachmae in all.`);
}

// The new year: a fallow field ploughed last year goes into the year it is sown the better for it;
// plantings start the year's tending afresh.
const careOf = (f) => ORCHARD[f.kind].tend.reduce((a, t) => a + Math.min(1, f[t.task === 'prune' ? 'pruned' : 'dug'] || 0), 0) / ORCHARD[f.kind].tend.length;

export function orchardYear(v) {
  const year = Math.floor(v.day / 360);
  for (const h of v.households) h.behind = (h.behind || 0) * 0.5;
  for (const f of v.land.fields) {
    if (f.kind) {
      f.care = careOf(f);
      f.pruned = 0;
      f.dug = 0;
      continue;
    }
    if (f.sheaves > 0) {
      logNews(v, 'alarm', `The last sheaves from ${f.name} were never threshed, and are lost.`, { house: f.owner });
      f.sheaves = 0;
    }
    f.prep = f.rotation === year % 2 ? Math.min(2, f.passes || 0) : 0;
    f.passes = 0;
    f.turned = 0;
  }
}

// Wine and oil a house goes through, when it has them.
export function useStores(v, h, people, use) {
  for (const k of ['wine', 'oil']) h.stores[k] = Math.max(0, (h.stores[k] || 0) - use[k] * people);
}

// ---- deciding to plant ----

// Food in hand, in years: barley and coin (at what the city sells barley for) beyond its seed.
export function yearsOfFood(v, h, coinKg) {
  const eat = dailyGrain(v, h) * 360;
  return (h.stores.grain + coinKg(h) - seedNeeded(v, h)) / Math.max(1, eat);
}

const grainLand = (v, h) => v.land.fields.filter((f) => f.owner === h.id && !f.kind && f.state !== 'planting');
const plantedLand = (v, h) => v.land.fields.filter((f) => f.owner === h.id && (f.kind || f.state === 'planting'));

// What a house would plant, and where: vines (quick to bear) or olives (slow, but worth more over
// the years, so for a house that can wait), whichever the village has less of against what it
// fetches; on one of its own fields if it would still have land enough for barley, or else on
// new ground, which it must ask your leave to clear.
export function plantingWish(v, h, coinKg) {
  if (h.player) return null;
  const m = monthOf(v);
  if (m < ORCHARD.months[0] || m > ORCHARD.months[1]) return null;
  if (yearsOfFood(v, h, coinKg) < ORCHARD.comfort) return null;
  if ((v.projects || []).some((x) => x.sponsor === h.id && (x.kind === 'plant' || (x.kind === 'field' && x.crop)))) return null;
  const men = h.members.filter((id) => v.people[id].alive && v.people[id].sex === 'm' && lifeStage(v, v.people[id]) === 'adult').length;
  if (!men) return null;
  const all = v.land.fields.filter((f) => f.owner === h.id).reduce((a, f) => a + f.ha, 0);
  const planted = plantedLand(v, h).reduce((a, f) => a + f.ha, 0);
  if (all > 0 && planted / all >= ORCHARD.share) return null;
  // Which: what a hectare of each would fetch in Athens, where any surplus goes, and the less the
  // village has of it the better; olives, slow to bear, appeal more to a house that can wait.
  const ha = (k) => v.land.fields.filter((f) => f.kind === k || (v.projects || []).some((x) => x.kind === 'plant' && x.field === f.id && x.crop === k)).reduce((a, f) => a + f.ha, 0);
  const worth = (k) => ORCHARD[k].yield * ECONOMY.price[ORCHARD[k].good] / (ha(k) + 2);
  const crop = worth('olives') * (h.wealth > 0.6 ? 1.4 : 0.8) > worth('vines') ? 'olives' : 'vines';
  // Where: one of its fields lying fallow this year, if it would still have barley enough.
  const mouths = h.members.filter((id) => v.people[id].alive).length;
  const year = Math.floor(v.day / 360);
  const fallow = grainLand(v, h).filter((f) => f.rotation !== year % 2 && f.state === 'stubble' && !(f.sheaves > 0)).sort((a, b) => a.ha - b.ha || a.dist - b.dist)[0];
  const grainAfter = grainLand(v, h).reduce((a, f) => a + f.ha, 0) - (fallow ? fallow.ha : 0);
  if (fallow && grainLand(v, h).length >= 3 && grainAfter / Math.max(1, mouths) >= COUNCIL.landPerMouth * 0.7) return { crop, field: fallow.id };
  if (freeWild(v) >= 0 && men >= 2) return { crop, field: null };
  return null;
}

// A field given over to vines or olives: dug and planted, a long job, by the house's own people
// and any it hires. It bears nothing meanwhile.
export function planPlanting(v, sponsor, fieldId, crop) {
  const f = v.land.fields[fieldId];
  const h = v.households[sponsor];
  if (!f || f.owner !== sponsor || f.kind || f.state === 'planting') return null;
  const o = ORCHARD[crop];
  v.projects = v.projects || [];
  const x = { id: v.nextProjectId++, kind: 'plant', field: f.id, crop, sponsor, needs: { work: o.plant * f.ha }, done: { work: 0 }, started: v.day, name: `${f.name}, planted with ${o.name}` };
  v.projects.push(x);
  f.state = 'planting';
  f.ploughed = 0;
  f.sown = 0;
  logNews(v, 'family', `The house of ${h.name} gives ${f.name} (${f.ha.toFixed(1)} ha) over to ${o.name}, and sets to digging it for planting. ${crop === 'vines' ? 'Vines bear in their third year.' : 'Olives take five years to bear, and more to come into their own.'}`, { house: sponsor });
  return x;
}

// New ground, cleared to be planted: the clearing first, then the planting.
export function planClearing(v, sponsor, crop) {
  const x = planField(v, sponsor);
  if (x) {
    x.crop = crop;
    x.name = `${v.households[sponsor].name}'s new ${ORCHARD[crop].name}`;
  }
  return x;
}

// The planting done: the field is vines or olives from now on.
export function finishPlanting(v, x) {
  const f = v.land.fields[x.field];
  if (!f) return;
  f.kind = x.crop;
  f.planted = v.day;
  f.state = 'growing';
  f.pruned = 0;
  f.dug = 0;
  f.ripeYear = Math.floor(v.day / 360);
  logNews(v, 'family', `${f.name} is planted with ${ORCHARD[x.crop].name}.`, { house: x.sponsor, pause: true });
}

