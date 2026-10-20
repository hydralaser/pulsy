import { TOOLS, SMITH, CITY, KIT, MONTHS } from './rules.js';
import { clamp } from '../sim/core.js';
import { logNews, monthOf } from './clock.js';
import { aliveHouseholds, grainReserve, pay, dailyFuel, dailyGrain, worth, daysToHarvest, seedNeeded } from './economy.js';
import { villageRng, canFight, lifeStage, ageYears } from './people.js';

// Iron tools, the smith at his forge, and the trip to the city. Without a smith every mending is a
// five-day walk to Athens and back; with one, only the iron and bronze he works with are.

// ---- tools ----

export function toolsOf(h) {
  h.tools = h.tools || { plough: 0.8, sickle: 0.8, axe: 0.8 };
  return h.tools;
}

export function initTools(v, rng) {
  for (const h of v.households) h.tools = { plough: rng.range(0.45, 1), sickle: rng.range(0.45, 1), axe: rng.range(0.45, 1) };
}

export const toolFor = (task) => TOOLS.uses[task] || null;

// How well a man works at a task with his household's tool for it: as well as new while it is
// sharp, slower as it wears, not at all once it is broken.
export function toolFactor(v, p, task) {
  const k = toolFor(task);
  if (!k) return 1;
  const c = toolsOf(v.households[p.household])[k];
  if (c <= 0) return 0;
  if (c >= TOOLS.sharp) return 1;
  return TOOLS.dull + (1 - TOOLS.dull) * (c / TOOLS.sharp);
}

export function toolBroken(v, p, task) {
  const k = toolFor(task);
  return !!k && toolsOf(v.households[p.household])[k] <= 0;
}

// An hour's use wears it.
export function wearTool(v, p, task, dt) {
  const k = toolFor(task);
  if (!k) return;
  const h = v.households[p.household];
  const t = toolsOf(h);
  if (t[k] <= 0) return;
  t[k] = Math.max(0, t[k] - dt / TOOLS.life[k]);
  if (t[k] <= 0) logNews(v, 'alarm', `The ${TOOLS.names[k]} of the house of ${h.name} ${k === 'plough' ? 'are' : 'is'} broken. ${v.smith && v.smith.man >= 0 ? 'The smith can make another.' : 'Another must be bought in the city.'}`, { house: h.id });
}

export function toolWord(c) {
  return c <= 0 ? 'broken' : c < 0.3 ? 'nearly worn out' : c < TOOLS.sharp ? 'worn' : c < 0.85 ? 'good' : 'new';
}

// ---- war kit ----

export function kitOf(p) {
  p.kit = p.kit || { weapon: 1, shield: 1, armour: 1, helmet: 1, greaves: 1 };
  return p.kit;
}

// The pieces a man actually has.
export function kitPieces(p) {
  return KIT.pieces.filter((k) => p[k] && p[k] !== 'none');
}

export function kitWord(c) {
  return c <= 0 ? 'broken' : c < 0.4 ? 'badly damaged' : c < KIT.repairAt ? 'damaged' : 'sound';
}

// After a battle: what he fought with is the worse for it.
export function wearKit(v, rng, p, m) {
  const k = kitOf(p);
  const hard = 0.5 + Math.min(1, (m.fought || 0) / 90);
  const wounds = (m.wounds || []).length;
  for (const piece of kitPieces(p)) {
    let loss = rng.range(0.03, 0.2) * hard;
    if (piece === 'armour' || piece === 'helmet') loss += 0.1 * wounds;
    if (piece === 'shield') loss += rng.range(0, 0.15) * hard;
    if (piece === 'weapon' && rng.chance(0.1 * hard)) loss = 1; // the spear broke
    k[piece] = Math.max(0, k[piece] - loss);
  }
}

// ---- the smith ----

export const hasSmith = (v) => !!(v.smith && !v.smith.ruined && v.smith.man >= 0 && v.people[v.smith.man] && v.people[v.smith.man].alive);

// What he is asked to do: broken tools first, then the most worn, then armour.
export function smithJobs(v) {
  const jobs = [];
  for (const h of aliveHouseholds(v)) {
    const t = toolsOf(h);
    for (const k of Object.keys(TOOLS.names)) {
      if (t[k] <= 0) jobs.push({ kind: 'make', house: h.id, tool: k, rank: 0 });
      else if (t[k] < TOOLS.mendAt) jobs.push({ kind: 'mend', house: h.id, tool: k, rank: 1 + t[k] });
    }
    for (const id of h.members) {
      const p = v.people[id];
      if (!p.alive || p.away || !p.weapon) continue;
      for (const piece of kitPieces(p)) if (kitOf(p)[piece] < KIT.repairAt) jobs.push({ kind: 'repair', house: h.id, man: p.id, piece, rank: 3 + kitOf(p)[piece] });
    }
  }
  return jobs.sort((a, b) => a.rank - b.rank);
}

// Iron for tools and spearheads, bronze for armour.
function needs(job) {
  if (job.kind === 'make') return { iron: SMITH.make.iron };
  if (job.kind === 'mend') return { iron: SMITH.mend.iron };
  return job.piece === 'weapon' ? { iron: SMITH.mend.iron * 3 } : { bronze: SMITH.repair.bronze };
}

const spec = (job) => (job.kind === 'make' ? SMITH.make : job.kind === 'mend' ? SMITH.mend : SMITH.repair);

function canDo(v, job) {
  const s = v.smith;
  const n = needs(job);
  if ((n.iron || 0) > s.iron + 1e-9 || (n.bronze || 0) > s.bronze + 1e-9) return false;
  // A house pays for it, or owes it; only a broken tool is worth going into debt for.
  const h = v.households[job.house];
  return job.house === s.house || job.kind === 'make' || h.stores.grain >= spec(job).price;
}

// Whether there is work at the forge today, materials to do it with.
export function forgeWork(v) {
  return hasSmith(v) && smithJobs(v).some((j) => canDo(v, j));
}

// Charcoal: the smith burns it from his own house's wood, and buys wood when that is short.
function charcoal(v, need) {
  const s = v.smith;
  if (s.charcoal >= need) return true;
  const h = v.households[s.house];
  const wood = (need - s.charcoal) * SMITH.woodPerCharcoal;
  const own = Math.max(0, h.stores.wood - dailyFuel(v) * 20);
  let got = Math.min(own, wood);
  h.stores.wood -= got;
  if (got < wood) {
    // From whoever has most to spare, at the price at the gate.
    const seller = aliveHouseholds(v).filter((o) => o.id !== h.id).sort((a, b) => b.stores.wood - a.stores.wood)[0];
    if (seller) {
      const spare = Math.max(0, seller.stores.wood - dailyFuel(v) * 30);
      const kg = Math.min(spare, wood - got);
      if (kg > 0 && h.stores.grain >= kg * v.prices.wood) {
        seller.stores.wood -= kg;
        pay(v, h.id, seller.id, kg * v.prices.wood, 'wood');
        got += kg;
      }
    }
  }
  s.charcoal += got / SMITH.woodPerCharcoal;
  return s.charcoal >= need;
}

// An hour at the forge: the job in hand gets done, the faster the better he is at it.
export function forgeHour(v, p, dt) {
  const s = v.smith;
  if (!s.job || !smithJobs(v).some((j) => same(j, s.job))) {
    s.job = smithJobs(v).find((j) => canDo(v, j)) || null;
    if (s.job) s.job.done = 0;
  }
  if (!s.job) return false;
  if (!charcoal(v, SMITH.charcoal * dt)) {
    if (s.coldOn !== v.day) logNews(v, 'alarm', 'The forge is cold: the smith has no charcoal and no wood to burn for it.', { house: s.house });
    s.coldOn = v.day;
    return false;
  }
  s.charcoal -= SMITH.charcoal * dt;
  p.skills.smith = p.skills.smith ?? SMITH.start;
  s.job.done += dt * (0.5 + p.skills.smith);
  if (s.job.done >= spec(s.job).hours) {
    finishJob(v, s.job);
    s.job = null;
  }
  return true;
}

function same(a, b) {
  return a.kind === b.kind && a.house === b.house && a.tool === b.tool && a.man === b.man && a.piece === b.piece;
}

function finishJob(v, job) {
  const s = v.smith;
  const n = needs(job);
  s.iron -= n.iron || 0;
  s.bronze -= n.bronze || 0;
  const h = v.households[job.house];
  if (job.kind === 'repair') kitOf(v.people[job.man])[job.piece] = 1;
  else toolsOf(h)[job.tool] = 1;
  if (job.house !== s.house) {
    pay(v, job.house, s.house, spec(job).price, 'smithing');
    spend(v.households[job.house], 'smith', spec(job).price);
  }
  s.done = (s.done || 0) + 1;
  s.earned = (s.earned || 0) + (job.house !== s.house ? spec(job).price : 0);
}

// Each dawn: the smith goes to the forge if there is work, and whoever takes over the forge when
// he dies or grows too old to work it.
export function smithDay(v) {
  const s = v.smith;
  if (!s || s.ruined) return;
  const man = s.man >= 0 ? v.people[s.man] : null;
  if (!man || !man.alive || ageYears(v, man) >= 65 || man.household !== s.house) {
    const h = v.households[s.house];
    const next = h ? h.members.map((id) => v.people[id]).filter((p) => p.alive && p.sex === 'm' && !p.slave && ageYears(v, p) >= 15 && ageYears(v, p) < 60).sort((a, b) => (b.skills.smith || 0) - (a.skills.smith || 0) || a.born - b.born)[0] : null;
    if (next) {
      next.skills.smith = Math.max(next.skills.smith || 0, 0.15);
      logNews(v, 'family', `${next.name} takes over the forge${man ? ` from ${man.name}` : ''}.`, { house: s.house, pause: true });
      s.man = next.id;
    } else if (s.man >= 0) {
      logNews(v, 'alarm', 'The forge stands cold: there is no one left in the smith\'s house to work it.', { pause: true });
      s.man = -1;
    }
  }
  for (const p of v.people) if (p.atForge) {
    p.assign = null;
    p.atForge = false;
  }
  if (!forgeWork(v)) return;
  const smith = v.people[s.man];
  if (smith.away) return;
  smith.assign = { kind: 'forge', id: 0 };
  smith.atForge = true;
}

// ---- the trip to the city ----

const BETTER = {
  shield: ['none', 'aspis'],
  helmet: ['none', 'pilos', 'corinthian'],
  armour: ['none', 'linothorax', 'bronze'],
  greaves: ['none', 'bronze'],
};
const itemPrice = (it) => it.price;
const weightOf = (it) => {
  if (it.kind === 'tool') return CITY.weight.tool;
  if (it.kind === 'iron' || it.kind === 'bronze' || it.kind === 'grain' || it.kind === 'sell') return it.kg;
  if (it.kind === 'repair' || it.kind === 'sheep' || it.kind === 'yoke' || it.kind === 'cart') return 0; // carried there and back, or walks
  return CITY.weight[it.piece === 'armour' && it.item === 'bronze' ? 'bronze_armour' : it.piece === 'greaves' ? 'greaves' : it.item] || 3;
};

export function describe(it) {
  if (it.kind === 'tool') return `a new ${TOOLS.names[it.tool]}`;
  if (it.kind === 'iron') return `${it.kg} kg of iron`;
  if (it.kind === 'bronze') return `${it.kg} kg of bronze`;
  if (it.kind === 'repair') return `${it.name}'s ${it.piece === 'weapon' ? 'spear' : it.piece} made good`;
  if (it.kind === 'grain') return `${it.kg} kg of barley`;
  if (it.kind === 'sheep') return `${it.n} sheep`;
  if (it.kind === 'yoke') return 'a yoke of oxen';
  if (it.kind === 'cart') return 'a cart';
  if (it.kind === 'sell') return `${Math.round(it.kg)} kg of ${it.good}`;
  return `${KIT_NAMES[it.item] || it.item} for ${it.name}`;
}

export const KIT_NAMES = { aspis: 'a hoplite shield', dory: 'a spear', bronze: 'a bronze cuirass', linothorax: 'a linen cuirass', corinthian: 'a Corinthian helmet', pilos: 'a bronze cap', greaves: 'greaves' };

// The city's prices, by how it regards the village.
export function cityPrice(v, base) {
  const standing = v.war ? v.war.standing : 0.5;
  return Math.round(base * (1 + CITY.standing * (0.5 - standing) / 0.5));
}

// What a piece of kit costs ordered from the city.
export function kitPrice(v, piece, item) {
  return cityPrice(v, CITY.kit[piece === 'greaves' ? 'greaves' : item]);
}

// The next better piece a man could have.
export function upgradeOf(p, piece) {
  const ladder = BETTER[piece];
  if (!ladder) return null;
  const i = ladder.indexOf(p[piece] || 'none');
  return i >= 0 && i < ladder.length - 1 ? ladder[i + 1] : null;
}

// What a household would bring back from the city now, and whether it is worth the trip.
export function cityNeeds(v, h) {
  const items = [];
  let urgent = false;
  const smith = hasSmith(v);
  const t = toolsOf(h);
  if (!smith) {
    // The tool the coming month's work needs is seen to beforehand, if it is getting worn.
    const next = SEASON_TOOL[(monthOf(v) + 1) % 12];
    for (const k of Object.keys(TOOLS.names)) {
      if (t[k] > CITY.worn && !(k === next && t[k] < TOOLS.sharp)) continue;
      items.push({ kind: 'tool', tool: k, price: cityPrice(v, CITY.tool[k]), essential: true });
      urgent = true;
    }
  }
  // The smith's iron and bronze.
  if (v.smith && v.smith.house === h.id && smith) {
    if (v.smith.iron < SMITH.restock.iron) {
      items.push({ kind: 'iron', kg: SMITH.buy.iron, price: cityPrice(v, SMITH.buy.iron * CITY.iron), essential: true });
      urgent = true;
    }
    if (v.smith.bronze < SMITH.restock.bronze) items.push({ kind: 'bronze', kg: SMITH.buy.bronze, price: cityPrice(v, SMITH.buy.bronze * CITY.bronze) });
  }
  // Kit ordered: by you, for your house, or by the house itself.
  for (const o of h.orders || []) {
    const p = v.people[o.man];
    if (!p || !p.alive || p.household !== h.id) continue;
    items.push({ kind: 'kit', man: p.id, name: p.name, piece: o.piece, item: o.item, price: kitPrice(v, o.piece, o.item), order: o });
    urgent = true;
  }
  // Armour to be made good, if there is no smith to do it and they are going anyway.
  if (!smith) {
    for (const id of h.members) {
      const p = v.people[id];
      if (!p.alive || p.away || !p.weapon) continue;
      for (const piece of kitPieces(p)) if (kitOf(p)[piece] < CITY.repairAt) items.push({ kind: 'repair', man: p.id, name: p.name, piece, price: cityPrice(v, CITY.repair) });
    }
  }
  // Beasts and carts bought in the city: ordered by the house, or by you for yours.
  for (const o of h.stock || []) {
    items.push(o.kind === 'sheep' ? { kind: 'sheep', n: o.n, price: cityPrice(v, CITY.beasts.sheep * o.n) } : { kind: o.kind, price: cityPrice(v, CITY.beasts[o.kind]) });
    urgent = true;
  }
  // Short of food, with coin to buy it.
  if (h.stores.grain < dailyGrain(v, h) * 40 && coinKg(h) > 60 * CITY.grain) {
    items.push({ kind: 'grain', kg: 60, price: cityPrice(v, 60 * CITY.grain), essential: true });
    urgent = true;
  }
  return { items, urgent };
}

// A house that has done well buys better kit for its best fighting man, now and then.
function wantsBetter(v, rng, h) {
  if (h.player || h.wealth < 0.5 || rng.next() > 1 / 120) return;
  const spare = coinKg(h) + h.stores.grain - keepBack(v, h);
  const men = h.members.map((id) => v.people[id]).filter((p) => p.alive && canFight(v, p) && p.weapon).sort((a, b) => (b.reputation || 0) - (a.reputation || 0));
  for (const p of men) {
    for (const piece of ['shield', 'helmet', 'armour', 'greaves']) {
      const item = upgradeOf(p, piece);
      if (!item) continue;
      // A man with javelins and a wicker shield takes up the hoplite's aspis first.
      if (piece !== 'shield' && p.shield !== 'aspis') continue;
      const price = kitPrice(v, piece, item);
      if (spare < price * 3) continue;
      h.orders = h.orders || [];
      if (!h.orders.some((o) => o.man === p.id && o.piece === piece)) h.orders.push({ man: p.id, piece, item });
      return;
    }
  }
}

// A house that is doing well buys more sheep, a yoke of oxen, a cart, as it can afford them; and
// a house that has lost them buys them again.
function wantsStock(v, rng, h) {
  if (h.player || rng.next() > 1 / 60) return;
  h.stock = h.stock || [];
  const spare = coinKg(h) + h.stores.grain - keepBack(v, h);
  const has = (k) => h.stock.some((o) => o.kind === k);
  const price = (k) => cityPrice(v, CITY.beasts[k]);
  const target = Math.round(4 + 30 * h.wealth);
  if (!has('sheep') && h.sheep < target && spare > price('sheep') * 6) {
    const n = Math.min(15, target - h.sheep, Math.floor(spare / (price('sheep') * 2)));
    if (n >= 3) h.stock.push({ kind: 'sheep', n });
    return;
  }
  const rank = [...aliveHouseholds(v)].sort((a, b) => worth(v, b) - worth(v, a)).indexOf(h);
  if (!has('yoke') && rank < 4 && !v.yokes.some((y) => y.owner === h.id) && spare > price('yoke') * 2) {
    h.stock.push({ kind: 'yoke' });
    return;
  }
  if (!has('cart') && rank < 2 && !v.cartOwners.includes(h.id) && spare > price('cart') * 2) h.stock.push({ kind: 'cart' });
}

// What a house has to spare to sell in the city: cloth and wool beyond what it keeps, barley
// beyond what it needs to the next harvest. Its worth at home, by the kg.
export function sellable(v, h) {
  const s = h.stores;
  return [
    { good: 'cloth', kg: Math.max(0, s.cloth - CITY.keepCloth), each: v.prices.cloth },
    { good: 'wool', kg: Math.max(0, s.wool - CITY.keepWool), each: v.prices.wool },
    // Barley only beyond what feeds the house to the next harvest and two months over, and its seed.
    { good: 'barley', kg: Math.max(0, s.grain - keepBack(v, h) - 200), each: 1 },
  ].filter((g) => g.kg >= 1);
}

// Whether a house has enough to sell to be worth a trip of its own.
function wantsToSell(v, h) {
  if (h.player && !h.sellNow && v.sellAuto === false) return false;
  if (h.soldOn > v.day - 120 && !h.sellNow) return false;
  return h.sellNow || sellable(v, h).reduce((a, g) => a + g.kg * g.each, 0) > 600;
}

// Lost shields are replaced as a matter of course by a house that can afford it.
function replaceLost(v, h) {
  for (const id of h.members) {
    const p = v.people[id];
    if (!p.alive || !canFight(v, p) || !p.weapon || p.weapon !== 'dory' || p.shield !== 'none') continue;
    h.orders = h.orders || [];
    if (!h.orders.some((o) => o.man === p.id && o.piece === 'shield')) h.orders.push({ man: p.id, piece: 'shield', item: 'aspis' });
  }
}

const FIELD_MONTHS = new Set([0, 3, 7]); // ploughing and sowing, hoeing, harvest
const SEASON_TOOL = { 0: 'plough', 3: 'plough', 7: 'sickle' };

// Each dawn: those back from the city unload, and households that need to go set out. A house
// setting out carries for its neighbours too, for a fee, as far as its men or its cart can: those
// with nobody to send, or nothing so pressing, wait for a trip rather than make their own.
export function cityDay(v) {
  v.trips = v.trips || [];
  for (const t of [...v.trips]) if (v.day >= t.back) arrive(v, t);
  if (v.siege) return; // nobody leaves the walls
  const rng = villageRng(v);
  const wanting = [];
  for (const h of aliveHouseholds(v)) {
    if (v.trips.some((t) => t.house === h.id || t.items.some((it) => it.for === h.id))) continue;
    if (h.player && v.cityAuto === false && !h.cityNow) continue;
    wantsBetter(v, rng, h);
    wantsStock(v, rng, h);
    if (!h.player) replaceLost(v, h);
    const { items, urgent } = cityNeeds(v, h);
    if (!items.length && !FIELD_MONTHS.has(monthOf(v)) && wantsToSell(v, h)) {
      wanting.push({ h, items, urgent: true, broken: false, sell: true });
      h.cityWait = h.cityWait ?? v.day - CITY.wait;
      continue;
    }
    if (!items.length) {
      h.cityWait = null;
      continue;
    }
    if (h.cityWait == null) h.cityWait = v.day;
    const broken = items.some((it) => it.kind === 'tool' && toolsOf(h)[it.tool] <= 0);
    wanting.push({ h, items, urgent, broken });
  }
  // Who sets out: a house with a broken tool, or one that has waited long enough for someone else
  // to go; in the busy months only for a broken tool, unless you said so.
  const busy = FIELD_MONTHS.has(monthOf(v));
  wanting.sort((a, b) => (b.broken - a.broken) || (a.h.cityWait - b.h.cityWait));
  for (const w of wanting) {
    if (w.served) continue;
    const waited = v.day - w.h.cityWait;
    const go = w.h.cityNow || w.h.sellNow || w.broken || (w.urgent && !busy && waited >= CITY.wait);
    if (!go) continue;
    const t = depart(v, w.h, w.items);
    w.h.cityNow = false;
    w.h.sellNow = false;
    if (!t) continue;
    w.served = true;
    w.h.cityWait = null;
    // Neighbours' errands, the longest waiting first.
    for (const o of wanting) {
      if (o.served || o.h === w.h) continue;
      if (consign(v, t, o.h, o.items)) {
        o.served = true;
        o.h.cityWait = null;
      }
    }
    announce(v, t);
  }
}

// What a house keeps back before it spends on anything it could do without: food to the next
// harvest and two months over, and seed for its fields.
export function keepBack(v, h) {
  return dailyGrain(v, h) * (daysToHarvest(v) + 60) + seedNeeded(v, h);
}

// A house's coin, as barley's worth.
export const coinKg = (h) => (h.stores.coin || 0) * CITY.drachma;

// Paying the city: in coin first, then in barley.
function payCity(h, kg) {
  const fromCoin = Math.min(coinKg(h), kg);
  h.stores.coin = (h.stores.coin || 0) - fromCoin / CITY.drachma;
  h.stores.grain -= kg - fromCoin;
}

// What a house can pay for, with its coin and its stores: essentials first, then the rest while
// there is enough to spare.
function affordable(v, h, items, extra = () => 0) {
  let purse = Math.max(0, coinKg(h) + h.stores.grain - keepBack(v, h));
  const essentials = Math.max(0, coinKg(h) + h.stores.grain - 30);
  const buy = [];
  let spent = 0;
  for (const it of [...items].sort((a, b) => (b.essential ? 1 : 0) - (a.essential ? 1 : 0))) {
    const cost = itemPrice(it) + extra(it);
    if (it.essential ? essentials - spent >= cost : purse >= cost) {
      buy.push(it);
      spent += cost;
      if (!it.essential) purse -= cost;
    }
  }
  return buy;
}

function depart(v, h, items) {
  const buy = affordable(v, h, items);
  const selling = !FIELD_MONTHS.has(monthOf(v)) && wantsToSell(v, h);
  if (!buy.length && !selling) return null;
  // Who goes: enough men to carry it home, or the cart and a man to drive it; a house going to
  // sell takes the cart if it has one, or two men to carry.
  const weight = buy.reduce((a, it) => a + weightOf(it), 0);
  const free = h.members.map((id) => v.people[id]).filter((p) => p.alive && !p.away && p.sex === 'm' && lifeStage(v, p) === 'adult' && !(v.smith && v.smith.man === p.id))
    .sort((a, b) => ageYears(v, a) - ageYears(v, b));
  const smithGoes = !free.length && v.smith && v.smith.house === h.id ? [v.people[v.smith.man]].filter((p) => p && p.alive && !p.away) : [];
  const men = free.length ? free : smithGoes;
  if (!men.length) return null;
  const cart = v.cartOwners.includes(h.id) && (weight > CITY.carry * 2 || selling);
  const n = cart ? 1 : clamp(Math.ceil(Math.max(weight, selling ? CITY.carry * 2 : 0) / CITY.carry), 1, men.length);
  const going = men.slice(0, n);
  const cap = cart ? CITY.cart : n * CITY.carry;
  const cost = buy.reduce((a, it) => a + itemPrice(it), 0);
  payCity(h, cost);
  spend(h, 'city', cost);
  // What it takes to sell with whatever room is left: the dearest goods first.
  let room = cap - weight;
  if (selling) {
    for (const g of sellable(v, h).sort((a, b) => b.each - a.each)) {
      const kg = Math.min(g.kg, room);
      if (kg < 1) continue;
      h.stores[g.good === 'barley' ? 'grain' : g.good] -= kg;
      room -= kg;
      // The city pays the better the more it thinks of the village.
      buy.push({ kind: 'sell', good: g.good, kg, coin: (kg * g.each * CITY.sells * (200 - cityPrice(v, 100)) / 100) / CITY.drachma, price: 0 });
    }
    h.soldOn = v.day;
  }
  for (const p of going) {
    p.away = { city: true };
    p.assign = null;
  }
  const t = { house: h.id, men: going.map((p) => p.id), cart, cap, load: cap - room, left: v.day, back: v.day + CITY.days, items: buy, cost, for: [] };
  v.trips.push(t);
  v.cityTrips = (v.cityTrips || []).filter((d) => d > v.day - 360).concat(v.day);
  h.spent.trips = (h.spent.trips || 0) + 1;
  h.spent.manDays = (h.spent.manDays || 0) + n * CITY.days;
  return t;
}

// The carrier's fee for another house's errand: a share of what it buys, and so much a kg carried.
export function carryFee(v, it) {
  return Math.max(2, Math.round(CITY.feeShare * itemPrice(it) + CITY.feeKg * weightOf(it)));
}

// Another house's errands on a trip, as far as there is room and it can pay.
function consign(v, t, h, items) {
  const buy = affordable(v, h, items, (it) => carryFee(v, it)).filter((it) => {
    if (t.load + weightOf(it) > t.cap) return false;
    t.load += weightOf(it);
    return true;
  });
  if (!buy.length) return false;
  let goods = 0;
  let fee = 0;
  for (const it of buy) {
    it.for = h.id;
    goods += itemPrice(it);
    fee += carryFee(v, it);
    t.items.push(it);
  }
  payCity(h, goods);
  pay(v, h.id, t.house, fee, 'carrying');
  spend(h, 'city', goods + fee);
  t.for.push({ house: h.id, fee });
  return true;
}

function announce(v, t) {
  const h = v.households[t.house];
  const own = t.items.filter((it) => it.for == null && it.kind !== 'sell');
  const sells = t.items.filter((it) => it.kind === 'sell');
  const others = t.for.map((f) => v.households[f.house].name);
  const aims = [sells.length ? `to sell ${sells.map(describe).join(', ')}` : '', own.length ? `to buy ${own.map(describe).join(', ')}` : ''].filter(Boolean).join(' and ');
  logNews(v, 'trade', `${t.men.map((id) => v.people[id].name).join(' and ')} of the house of ${h.name} set${t.men.length > 1 ? '' : 's'} out for Athens${t.cart ? ' with the cart' : ''}, ${aims}${others.length ? `, and carrying for the house${others.length > 1 ? 's' : ''} of ${others.join(' and ')} for ${t.for.reduce((a, f) => a + f.fee, 0)} kg` : ''}: ${CITY.days} days on the road.`, { house: h.id });
}

// What a house laid out this year on the smith and the city, for its card.
export function spend(h, k, kg) {
  h.spent = h.spent || {};
  h.spent[k] = (h.spent[k] || 0) + kg;
}

function arrive(v, t) {
  v.trips = v.trips.filter((o) => o !== t);
  const carrier = v.households[t.house];
  for (const id of t.men) if (v.people[id].away && v.people[id].away.city) v.people[id].away = null;
  for (const it of t.items) {
    const h = it.for != null ? v.households[it.for] : carrier;
    if (it.kind === 'tool') toolsOf(h)[it.tool] = 1;
    else if (it.kind === 'iron' && v.smith) v.smith.iron += it.kg;
    else if (it.kind === 'bronze' && v.smith) v.smith.bronze += it.kg;
    else if (it.kind === 'repair') kitOf(v.people[it.man])[it.piece] = 1;
    else if (it.kind === 'grain') h.stores.grain += it.kg;
    else if (it.kind === 'sell') h.stores.coin = (h.stores.coin || 0) + it.coin;
    else if (it.kind === 'sheep') {
      h.sheep += it.n;
      v.flock.head += it.n;
      v.flock.ewes += Math.round(it.n * 0.6);
      h.stock = (h.stock || []).filter((o) => o.kind !== 'sheep');
    } else if (it.kind === 'yoke') {
      v.yokes.push({ owner: h.id });
      h.stock = (h.stock || []).filter((o) => o.kind !== 'yoke');
    } else if (it.kind === 'cart') {
      if (!v.cartOwners.includes(h.id)) v.cartOwners.push(h.id);
      h.stock = (h.stock || []).filter((o) => o.kind !== 'cart');
    }
    else if (it.kind === 'kit') {
      const p = v.people[it.man];
      if (p.alive) {
        p[it.piece] = it.item;
        kitOf(p)[it.piece] = 1;
        // A hoplite's shield is no use without a spear to go with it.
        if (it.piece === 'shield' && p.weapon !== 'dory') {
          p.weapon = 'dory';
          kitOf(p).weapon = 1;
        }
      }
      h.orders = (h.orders || []).filter((o) => o !== it.order && !(o.man === it.man && o.piece === it.piece));
    }
  }
  if (carrier) {
    const got = t.items.filter((it) => it.kind !== 'sell');
    const coin = t.items.filter((it) => it.kind === 'sell').reduce((a, it) => a + it.coin, 0);
    logNews(v, 'trade', `The men of the house of ${carrier.name} are back from Athens${coin ? `, having sold their goods for ${Math.round(coin)} drachmae` : ''}${got.length ? `${coin ? ',' : ''} with ${got.map((it) => describe(it) + (it.for != null ? ` for the house of ${v.households[it.for].name}` : '')).join(', ')}` : ''}.`, { house: carrier.id });
  }
}

export function tripOf(v, p) {
  return (v.trips || []).find((t) => t.men.includes(p.id)) || null;
}

export function monthName(v) {
  return MONTHS[monthOf(v)].name;
}
