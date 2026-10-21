import { VILLAGE, FIELDS, ECONOMY, FLOCK, MONTHS, DAYS_IN_YEAR, CITY, SMITH } from './rules.js';

const FLOCK_WOOL = FLOCK.wool * 0.6; // what is left of last summer's shearing
import { clamp } from '../sim/core.js';
import { lifeStage } from './people.js';
import { monthOf, logNews } from './clock.js';

// Every household owns its own: its land, its sheep (herded together in the village flock), its
// grain, its woodpile, its cloth, and some own a yoke of oxen or a cart. What a household
// produces is its own. What it lacks it buys from its neighbours at the gate each evening, paying
// in grain, or it borrows. Work on another household's land is paid: a day wage in grain for
// ploughing, sowing and hoeing, and a share of the sheaves for reaping. The village keeps a common
// granary, filled by a levy on every harvest, to feed households that are going under.

export function aliveHouseholds(v) {
  return v.households.filter((h) => h.members.some((id) => v.people[id].alive));
}

export function rationOf(v, p) {
  const s = lifeStage(v, p);
  if (s === 'infant') return VILLAGE.ration.infant;
  if (s === 'child' || s === 'youth') return VILLAGE.ration.child;
  if (s === 'elder') return VILLAGE.ration.elder;
  return p.sex === 'm' ? VILLAGE.ration.man : VILLAGE.ration.woman;
}

// What a household eats in a day, and burns.
export function dailyGrain(v, h) {
  return h.members.reduce((a, id) => a + (v.people[id].alive ? rationOf(v, v.people[id]) : 0), 0);
}

export function dailyFuel(v) {
  return MONTHS[monthOf(v)].season === 'winter' ? VILLAGE.fuel.winter : VILLAGE.fuel.summer;
}

// Days until the next harvest is in, roughly: what a household must keep to eat until then.
export function daysToHarvest(v) {
  const dayOfYear = v.day % DAYS_IN_YEAR;
  const harvest = (FIELDS.ripe + 0.7) * 30;
  return dayOfYear < harvest ? harvest - dayOfYear : DAYS_IN_YEAR - dayOfYear + harvest;
}

// Seed a household needs for its own fields still to be sown this year.
export function seedNeeded(v, h) {
  const year = Math.floor(v.day / DAYS_IN_YEAR);
  return v.land.fields.filter((f) => f.owner === h.id && f.rotation === year % 2 && f.state === 'stubble').reduce((a, f) => a + (1 - f.sown) * f.ha * FIELDS.seed, 0);
}

// ---- setting up ----

// The land is dealt out in pairs of plots, one of each pair sown each year, more pairs to the
// better off. Sheep, oxen and carts likewise.
export function settleOwnership(v, rng) {
  const hs = v.households;
  const byDist = [...v.land.fields].sort((a, b) => a.dist - b.dist);
  const pairs = [];
  for (let i = 0; i + 1 < byDist.length; i += 2) pairs.push([byDist[i], byDist[i + 1]]);
  // Each household's claim on the land is its standing; everyone gets at least one pair.
  const weight = hs.map((h) => 0.4 + h.wealth);
  const total = weight.reduce((a, b) => a + b, 0);
  // Shares of the land by largest remainder, at least one pair each.
  const exact = weight.map((w) => (w / total) * pairs.length);
  const counts = exact.map((x) => Math.max(1, Math.floor(x)));
  const byRemainder = [...hs.keys()].sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])));
  for (let i = 0; counts.reduce((a, b) => a + b, 0) < pairs.length; i++) counts[byRemainder[i % hs.length]]++;
  while (counts.reduce((a, b) => a + b, 0) > pairs.length) {
    const j = counts.indexOf(Math.max(...counts));
    counts[j]--;
  }
  // Deal the pairs round so each household's land is scattered, near and far, as it was.
  const order = rng ? [...pairs].sort(() => rng.next() - 0.5) : pairs;
  let k = 0;
  hs.forEach((h, i) => {
    for (let n = 0; n < counts[i]; n++) {
      const [a, b] = order[k++];
      a.rotation = 0;
      b.rotation = 1;
      a.owner = h.id;
      b.owner = h.id;
    }
  });
  const flock = v.flock.head;
  const sheepWeight = hs.map((h) => 0.2 + h.wealth);
  const sw = sheepWeight.reduce((a, b) => a + b, 0);
  for (const [i, h] of hs.entries()) {
    h.sheep = Math.round((sheepWeight[i] / sw) * flock);
    h.stores = { grain: 0, wood: 0, wool: h.sheep * FLOCK_WOOL, cloth: 1 + h.wealth * 4, stone: 0 };
    delete h.cloth;
  }
  v.flock.head = hs.reduce((a, h) => a + h.sheep, 0);
  // The four richest households each own a yoke of oxen; the two richest a cart.
  const rich = [...hs].sort((a, b) => b.wealth - a.wealth);
  v.yokes = rich.slice(0, v.oxen).map((h) => ({ owner: h.id }));
  v.cartOwners = rich.slice(0, v.carts).map((h) => h.id);
  v.common = { grain: 0 };
  v.levy = ECONOMY.levy;
  v.relief = true;
  v.prices = { ...ECONOMY.price };
  v.debts = [];
}

// What each household has at the start: last year's grain, a little better for the better off,
// seed for this autumn, and a woodpile; and what the common granary holds.
export function startingStores(v, rng) {
  for (const h of v.households) {
    const eat = dailyGrain(v, h);
    h.stores.grain = Math.round(eat * daysToHarvest(v) * (0.9 + 0.5 * h.wealth) + seedNeeded(v, h));
    h.stores.wood = Math.round(dailyFuel(v) * (25 + 30 * h.wealth));
  }
  // The village is a going concern, not a new foundation: last year's levy is in the common granary.
  v.common.grain = Math.round(ECONOMY.startCommon * v.households.reduce((a, h) => a + h.stores.grain, 0));
}

// ---- paying and owing ----

// One household pays another in grain; what it cannot pay it owes.
export function pay(v, from, to, kg, why) {
  if (kg <= 0 || from === to) return;
  const payer = from >= 0 ? v.households[from] : null;
  const payee = to >= 0 ? v.households[to] : null;
  const have = payer ? payer.stores.grain : v.common.grain;
  const paid = Math.min(have, kg);
  if (payer) payer.stores.grain -= paid;
  else v.common.grain -= paid;
  if (payee) payee.stores.grain += paid;
  else v.common.grain += paid;
  if (kg - paid > 0.01 && payer) owe(v, from, to, kg - paid, why);
}

export function owe(v, from, to, kg, why) {
  let d = v.debts.find((x) => x.from === from && x.to === to);
  if (!d) {
    d = { from, to, kg: 0, since: v.day, why };
    v.debts.push(d);
  }
  d.kg += kg;
}

export function owedBy(v, h) {
  return v.debts.filter((d) => d.from === h.id).reduce((a, d) => a + d.kg, 0);
}

export function owedTo(v, h) {
  return v.debts.filter((d) => d.to === h.id).reduce((a, d) => a + d.kg, 0);
}

// What a household must keep back: grain to eat until the harvest and seed for its own fields.
export function grainReserve(v, h) {
  return dailyGrain(v, h) * Math.min(daysToHarvest(v), 120) + seedNeeded(v, h);
}

// ---- the evening market ----

// Each evening households short of firewood or cloth buy from those with more than they need,
// paying in grain at a price that rises when the thing is scarce and falls when it is plentiful.
// Households short of grain sell what they can spare, then borrow; debts carry interest and are
// paid back when the debtor has grain to spare.
export function market(v) {
  const hs = aliveHouseholds(v);
  const fuel = dailyFuel(v);
  // In autumn the wise lay in wood for the winter.
  const m = monthOf(v);
  const woodDays = m <= 2 ? 45 : 25;
  // The forge burns wood too: its smith buys what it will need, as the hearths do.
  const s = v.smith;
  if (s) {
    s.burn = (s.burn || 0) * 0.9 + (s.used || 0) * 0.1;
    s.used = 0;
  }
  const forge = (h) => (s && !s.ruined && s.house === h.id ? s.burn * SMITH.stock : 0);
  trade(v, hs, 'wood', (h) => fuel * woodDays + forge(h), (h) => (fuel * woodDays + forge(h)) * 1.6);
  const people = (h) => h.members.filter((id) => v.people[id].alive).length;
  const spinners = (h) => h.members.filter((id) => v.people[id].alive && v.people[id].sex === 'f' && lifeStage(v, v.people[id]) !== 'infant' && lifeStage(v, v.people[id]) !== 'child').length;
  trade(v, hs, 'cloth', (h) => ECONOMY.clothKeep * people(h), (h) => ECONOMY.clothKeep * people(h) * 1.5);
  trade(v, hs, 'wool', (h) => ECONOMY.woolKeep * spinners(h), (h) => ECONOMY.woolKeep * spinners(h) * 1.5);
  lend(v, hs);
  repay(v, hs);
  relieve(v, hs);
}

function trade(v, hs, good, want, keep) {
  const price = v.prices[good];
  const buyers = [];
  const sellers = [];
  for (const h of hs) {
    const short = want(h) - h.stores[good];
    // A buyer spends grain he can spare, or buys on credit if he has none.
    if (short > 1) buyers.push({ h, q: short });
    const spare = h.stores[good] - keep(h);
    if (spare > 1) sellers.push({ h, q: spare });
  }
  const demand = buyers.reduce((a, b) => a + b.q, 0);
  const supply = sellers.reduce((a, b) => a + b.q, 0);
  // What the market wanted and had tonight: those who might supply it look at this.
  v.wanted = v.wanted || {};
  v.wanted[good] = { demand, supply, day: v.day };
  // The price moves toward where what is wanted and what is offered meet.
  if (demand + supply > 0) {
    const imbalance = (demand - supply) / (demand + supply);
    v.prices[good] = clamp(price * (1 + ECONOMY.priceMove * imbalance), ECONOMY.price[good] * 0.25, ECONOMY.price[good] * 4);
  }
  // Village prices were mostly customary: they drift back toward the usual price.
  v.prices[good] += (ECONOMY.price[good] - v.prices[good]) * ECONOMY.priceCustom;
  const q = Math.min(demand, supply) * ECONOMY.tradeShare;
  if (q <= 0) return;
  // Each buyer buys from the sellers in proportion to what they offer.
  for (const b of buyers) {
    const bought = b.q * (q / demand);
    for (const s of sellers) {
      const part = bought * (s.q / supply);
      s.h.stores[good] -= part;
      b.h.stores[good] += part;
      pay(v, b.h.id, s.h.id, part * v.prices[good], good);
    }
  }
}

// Households short of grain to eat borrow from those with grain to spare, the richest first.
function lend(v, hs) {
  for (const h of hs) {
    const eat = dailyGrain(v, h);
    const short = eat * ECONOMY.borrowAt - h.stores.grain;
    if (short <= 0) continue;
    const lenders = hs.filter((o) => o !== h && o.stores.grain > grainReserve(v, o) + 50).sort((a, b) => (b.stores.grain - grainReserve(v, b)) - (a.stores.grain - grainReserve(v, a)));
    let need = eat * ECONOMY.borrowFor;
    for (const l of lenders) {
      if (need <= 0) break;
      const kg = Math.min(need, l.stores.grain - grainReserve(v, l) - 50);
      if (kg <= 0) continue;
      l.stores.grain -= kg;
      h.stores.grain += kg;
      owe(v, h.id, l.id, kg, 'loan');
      need -= kg;
      // News of it once a season, not every time.
      if (kg > 30 && !(h.loanNewsOn > v.day - 90)) {
        h.loanNewsOn = v.day;
        logNews(v, 'trade', `The house of ${h.name} has to borrow barley from the house of ${l.name}.`, { house: h.id });
      }
    }
  }
}

// Interest runs on every debt, and debts are paid back from what the debtor can spare.
function repay(v, hs) {
  const daily = ECONOMY.interest / DAYS_IN_YEAR;
  for (const d of v.debts) {
    if (d.why === 'loan') d.kg *= 1 + daily;
    const h = v.households[d.from];
    const spare = h.stores.grain - grainReserve(v, h);
    if (spare <= 1) continue;
    const kg = Math.min(d.kg, spare * 0.5);
    h.stores.grain -= kg;
    if (d.to >= 0) v.households[d.to].stores.grain += kg;
    else v.common.grain += kg;
    d.kg -= kg;
  }
  v.debts = v.debts.filter((d) => d.kg > 0.5 && v.households[d.from].members.some((id) => v.people[id].alive));
}

// The common granary feeds households with nothing left and nobody to lend to them.
function relieve(v, hs) {
  if (!v.relief) return;
  for (const h of hs) {
    const eat = dailyGrain(v, h);
    if (h.stores.grain >= eat * 3 || v.common.grain <= 0) continue;
    const kg = Math.min(v.common.grain, eat * 10);
    v.common.grain -= kg;
    h.stores.grain += kg;
    if (!h.relieved) logNews(v, 'trade', `The house of ${h.name} is fed from the common granary.`, { house: h.id });
    h.relieved = true;
  }
  for (const h of hs) if (h.stores.grain > dailyGrain(v, h) * 20) h.relieved = false;
}

// ---- helpers for the totals ----

// What a household is worth, in barley: its land, sheep, oxen and cart, its stores, and what it is
// owed less what it owes.
export function worth(v, h) {
  const land = v.land.fields.filter((f) => f.owner === h.id).reduce((a, f) => a + f.ha, 0);
  const s = h.stores;
  return land * ECONOMY.value.land + h.sheep * ECONOMY.value.sheep
    + v.yokes.filter((y) => y.owner === h.id).length * ECONOMY.value.yoke + (v.cartOwners.includes(h.id) ? ECONOMY.value.cart : 0)
    + s.grain + s.wood * v.prices.wood + s.wool * v.prices.wool + s.cloth * v.prices.cloth + (s.stone || 0) * 0.05 + (s.coin || 0) * CITY.drachma
    + owedTo(v, h) - owedBy(v, h);
}

export function totals(v) {
  const t = { grain: 0, wood: 0, wool: 0, cloth: 0, stone: 0 };
  for (const h of v.households) for (const k of Object.keys(t)) t[k] += h.stores[k];
  return t;
}

// Who owns a yoke this household can use: its own first, then one hired from another household.
export function hireYoke(v, h) {
  const own = v.yokes.find((y) => y.owner === h && !y.busy);
  const any = own || v.yokes.find((y) => !y.busy);
  if (any) any.busy = true;
  return any || null;
}
