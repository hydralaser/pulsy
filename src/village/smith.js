import { TOOLS, SMITH, CITY, KIT, MONTHS } from './rules.js';
import { clamp } from '../sim/core.js';
import { logNews, monthOf } from './clock.js';
import { aliveHouseholds, grainReserve, pay, dailyFuel } from './economy.js';
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

export const hasSmith = (v) => !!(v.smith && v.smith.man >= 0 && v.people[v.smith.man] && v.people[v.smith.man].alive);

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
  if (job.house !== s.house) pay(v, job.house, s.house, spec(job).price, 'smithing');
  s.done = (s.done || 0) + 1;
  s.earned = (s.earned || 0) + (job.house !== s.house ? spec(job).price : 0);
}

// Each dawn: the smith goes to the forge if there is work, and whoever takes over the forge when
// he dies or grows too old to work it.
export function smithDay(v) {
  const s = v.smith;
  if (!s) return;
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
  if (it.kind === 'iron' || it.kind === 'bronze') return it.kg;
  if (it.kind === 'repair') return 0; // carried there and back
  return CITY.weight[it.piece === 'armour' && it.item === 'bronze' ? 'bronze_armour' : it.piece === 'greaves' ? 'greaves' : it.item] || 3;
};

export function describe(it) {
  if (it.kind === 'tool') return `a new ${TOOLS.names[it.tool]}`;
  if (it.kind === 'iron') return `${it.kg} kg of iron`;
  if (it.kind === 'bronze') return `${it.kg} kg of bronze`;
  if (it.kind === 'repair') return `${it.name}'s ${it.piece === 'weapon' ? 'spear' : it.piece} made good`;
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
    for (const k of Object.keys(TOOLS.names)) {
      if (t[k] > CITY.worn) continue;
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
  return { items, urgent };
}

// A house that has done well buys better kit for its best fighting man, now and then.
function wantsBetter(v, rng, h) {
  if (h.player || h.wealth < 0.5 || rng.next() > 1 / 120) return;
  const spare = h.stores.grain - grainReserve(v, h);
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

// Each dawn: those back from the city unload, and households that need to go set out.
export function cityDay(v) {
  v.trips = v.trips || [];
  for (const t of [...v.trips]) if (v.day >= t.back) arrive(v, t);
  const rng = villageRng(v);
  for (const h of aliveHouseholds(v)) {
    if (v.trips.some((t) => t.house === h.id)) continue;
    if (h.player && v.cityAuto === false && !h.cityNow) continue;
    wantsBetter(v, rng, h);
    if (!h.player) replaceLost(v, h);
    const { items, urgent } = cityNeeds(v, h);
    if (!items.length || (!urgent && !h.cityNow)) continue;
    // In the busy months a house goes only for a broken tool it needs, or because you said so.
    const broken = items.some((it) => it.kind === 'tool' && toolsOf(h)[it.tool] <= 0);
    if (FIELD_MONTHS.has(monthOf(v)) && !broken && !h.cityNow) continue;
    depart(v, h, items);
    h.cityNow = false;
  }
}

function depart(v, h, items) {
  // What it can pay for: essentials first, then the rest while there is grain to spare.
  let purse = Math.max(0, h.stores.grain - grainReserve(v, h));
  const essentials = Math.max(0, h.stores.grain - 30);
  const buy = [];
  for (const it of [...items].sort((a, b) => (b.essential ? 1 : 0) - (a.essential ? 1 : 0))) {
    if (it.essential ? essentials - buy.reduce((a, x) => a + itemPrice(x), 0) >= it.price : purse >= it.price) {
      buy.push(it);
      if (!it.essential) purse -= it.price;
    }
  }
  if (!buy.length) return;
  // Who goes: enough men to carry it home, or the cart and a man to drive it.
  const weight = buy.reduce((a, it) => a + weightOf(it), 0);
  const free = h.members.map((id) => v.people[id]).filter((p) => p.alive && !p.away && p.sex === 'm' && lifeStage(v, p) === 'adult' && !(v.smith && v.smith.man === p.id))
    .sort((a, b) => ageYears(v, a) - ageYears(v, b));
  const smithGoes = !free.length && v.smith && v.smith.house === h.id ? [v.people[v.smith.man]].filter((p) => p && p.alive && !p.away) : [];
  const men = free.length ? free : smithGoes;
  if (!men.length) return;
  const cart = v.cartOwners.includes(h.id) && weight > CITY.carry * 2 && !v.trips.some((t) => t.cart && t.house === h.id);
  const n = cart ? 1 : clamp(Math.ceil(weight / CITY.carry), 1, men.length);
  const going = men.slice(0, n);
  const cost = buy.reduce((a, it) => a + itemPrice(it), 0);
  h.stores.grain -= cost;
  for (const p of going) {
    p.away = { city: true };
    p.assign = null;
  }
  const t = { house: h.id, men: going.map((p) => p.id), cart, left: v.day, back: v.day + CITY.days, items: buy, cost };
  v.trips.push(t);
  v.cityTrips = (v.cityTrips || []).filter((d) => d > v.day - 360).concat(v.day);
  logNews(v, 'trade', `${going.map((p) => p.name).join(' and ')} of the house of ${h.name} set${going.length > 1 ? '' : 's'} out for Athens${cart ? ' with the cart' : ''}, to buy ${buy.map(describe).join(', ')}: ${Math.round(cost)} kg of barley, and ${CITY.days} days on the road.`, { house: h.id });
}

function arrive(v, t) {
  v.trips = v.trips.filter((o) => o !== t);
  const h = v.households[t.house];
  for (const id of t.men) if (v.people[id].away && v.people[id].away.city) v.people[id].away = null;
  for (const it of t.items) {
    if (it.kind === 'tool') toolsOf(h)[it.tool] = 1;
    else if (it.kind === 'iron' && v.smith) v.smith.iron += it.kg;
    else if (it.kind === 'bronze' && v.smith) v.smith.bronze += it.kg;
    else if (it.kind === 'repair') kitOf(v.people[it.man])[it.piece] = 1;
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
  if (h) logNews(v, 'trade', `The men of the house of ${h.name} are back from Athens with ${t.items.map(describe).join(', ')}.`, { house: h.id });
}

export function tripOf(v, p) {
  return (v.trips || []).find((t) => t.men.includes(p.id)) || null;
}

export function monthName(v) {
  return MONTHS[monthOf(v)].name;
}
