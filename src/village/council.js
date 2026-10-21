import { COUNCIL, FIELDS, FLOCK, BUILD, HIRING, ECONOMY } from './rules.js';
import { clamp } from '../sim/core.js';
import { canWork, fieldTask, crews, isDrill, TASKS, siteTask } from './work.js';
import { villageRng, lifeStage } from './people.js';
import { dailyGrain, grainReserve } from './economy.js';
import { DRILL, VILLAGE, EXERTION, SMITH } from './rules.js';
import { smithDay, hasSmith } from './smith.js';
import { dailyFuel, worth, aliveHouseholds } from './economy.js';
import { freeHouse } from './family.js';
import { planHouse, planField, planForge, freePlot, freeWild, projectOf } from './building.js';
import { monthOf, logNews } from './clock.js';
import { ageYears } from './people.js';

// Households run their own lives. The routine of the year needs nobody's leave: the men work
// their own fields when they need it and hire out on others' when they do not, the women keep
// house, and at harvest every hand goes out. Anything beyond that, cutting wood, building a house,
// clearing new land, taking the flock, a household asks the leading man's blessing for: you. What
// you grant and refuse, and whom you set against whom, is remembered.

const FARM = { kind: 'farm', id: 0 };
const QUARRY = (v) => ({ kind: 'grove', id: v.land.groves.findIndex((g) => g.material === 'stone') });

// Your standing answers, by kind of petition: for their own use, or to make a living from.
export const RULES = [
  { key: 'woodOwn', group: 'For their own use', text: 'Cutting wood for their own hearth' },
  { key: 'build', group: 'For their own use', text: 'Building a house for a son' },
  { key: 'clear', group: 'For their own use', text: 'Clearing new land for their own farm', fee: true },
  { key: 'woodSale', group: 'To make a living', text: 'Cutting wood to sell' },
  { key: 'herd', group: 'To make a living', text: 'Herding the flock for the herders\' pay' },
  { key: 'forge', group: 'To make a living', text: 'Setting up a forge as the village smith' },
];

export function ruleOf(p) {
  return p.kind === 'wood' ? (p.forSale ? 'woodSale' : 'woodOwn') : p.kind;
}

export const PETITION_TEXT = {
  wood: 'to cut wood',
  build: 'to build a house',
  clear: 'to clear new land for a field',
  herd: 'to take the flock out',
  forge: 'to set up a forge and be the village\'s smith',
};

// ---- goodwill and ties ----

export function tie(v, a, b) {
  if (a === b) return 1;
  const k = a < b ? `${a}-${b}` : `${b}-${a}`;
  return (v.ties && v.ties[k]) || 0;
}

export function addTie(v, a, b, d) {
  if (a === b || a < 0 || b < 0) return;
  v.ties = v.ties || {};
  const k = a < b ? `${a}-${b}` : `${b}-${a}`;
  v.ties[k] = clamp((v.ties[k] || 0) + d, -1, 1);
}

export function addGoodwill(v, h, d) {
  if (h.player) return;
  h.goodwill = clamp((h.goodwill ?? COUNCIL.goodwill) + d, 0, 1);
}

export function goodwillWord(g) {
  return g > 0.8 ? 'devoted' : g > 0.62 ? 'loyal' : g > 0.45 ? 'content' : g > 0.3 ? 'grumbling' : 'resentful';
}

// ---- what a household does today ----

// Its own routine for a half, before any plan of its own or order of yours.
function routine(v, h, half) {
  if (half === 'm') return FARM;
  // At harvest every hand goes out to the household's ripe fields.
  const ripe = v.land.fields.some((f) => f.owner === h.id && f.state === 'ripe');
  return ripe ? FARM : null;
}

// The household's own fields need its men today: at sowing and harvest they come first.
function ownFieldsCall(v, h) {
  return v.land.fields.some((f) => f.owner === h.id && (fieldTask(v, f) === 'reap' || fieldTask(v, f) === 'plough' || fieldTask(v, f) === 'sow'));
}

// Work that comes to an end: a field ploughed or reaped, a house or a new field finished, a grove
// cut out. An order there is done when the work is; going to the fields wherever needed, the
// pasture, the drill ground or home has no end.
function orderDone(v, site) {
  return !!site && (site.kind === 'field' || site.kind === 'build' || site.kind === 'grove') && siteTask(v, site) === 'idle';
}

// Each dawn: every household's men and women go where its own plan, or your order, sends them.
// Once the work you sent them to is done, they are their own again.
export function decideDay(v) {
  for (const h of aliveHouseholds(v)) {
    h.ordered = h.ordered || { m: false, f: false };
    for (const half of ['m', 'f']) {
      // An order with nowhere to go (home, or work that has gone) is no order: they are their own.
      if (h.ordered[half] && !h.assign[half]) h.ordered[half] = false;
      if (h.ordered[half] && orderDone(v, h.assign[half])) {
        h.ordered[half] = false;
        if (!h.player) logNews(v, 'council', `The ${half === 'm' ? 'men' : 'women'} of the house of ${h.name}, the work you sent them to done, go back to their own.`, { house: h.id });
      }
      if (h.ordered[half]) continue;
      let site = routine(v, h, half);
      const plan = h.plan;
      if (plan && plan.half === half && !(ownFieldsCall(v, h) && plan.kind !== 'herd')) site = planSite(v, h, plan) || site;
      h.assign[half] = site ? { kind: site.kind, id: site.id } : null;
    }
  }
  for (const p of v.people) if (p.alive && p.assign && !p.selfDrill && (p.assign.kind === 'home' || orderDone(v, p.assign))) p.assign = null;
  smithDay(v);
  spareHerders(v);
  hireHands(v);
  drillDay(v);
}

// ---- hired hands ----

// How a project takes on hired men: whether it does, up to how many in all, and who pays.
export function hireOf(x) {
  x.hire = x.hire || { on: true, cap: HIRING.cap, from: 'house' };
  return x.hire;
}

// Who is at a site today: the sponsor's own and anyone you have sent, and the men hired.
export function crewAt(v, x) {
  const here = (a) => a && a.kind === 'build' && a.id === x.id;
  const own = [];
  const hired = [];
  for (const p of v.people) {
    if (!p.alive || p.away || !canWork(v, p)) continue;
    const h = v.households[p.household];
    const a = p.assign || (h.assign ? h.assign[p.sex] : null);
    if (!here(a)) continue;
    (p.hiredHand ? hired : own).push(p);
  }
  return { own, hired };
}

// A man's daily wage, and what a payer can spare for wages without going short.
function canPay(v, x) {
  const per = ECONOMY.wage * HIRING.ahead;
  if (hireOf(x).from === 'common') return Math.floor(Math.max(0, v.common.grain) / per);
  const h = v.households[x.sponsor];
  return Math.floor(Math.max(0, h.stores.grain - grainReserve(v, h) - 50) / per);
}

// Work there is for hired men today: a field to clear; a house only once its stone and timber are
// in, for they come out of the sponsor's own stores and its own men fetch them.
function hireable(v, x) {
  if (x.done.work >= x.needs.work) return false;
  if (x.kind !== 'house' && x.kind !== 'forge') return true;
  const h = v.households[x.sponsor];
  const left = (k) => x.needs[k] * (1 - x.done.work / x.needs.work) - (h.stores[k] || 0);
  return left('stone') <= 0 && left('wood') <= 0;
}

// Each morning, men with nothing to do (their own fields and every field in the village done, no
// plan of their house's, no order of yours) go where a house is paying, poorest houses first and
// those on good terms with the payer before others.
function hireHands(v) {
  for (const p of v.people) if (p.hiredHand) {
    p.assign = null;
    p.hiredHand = false;
  }
  const fieldsDone = siteTask(v, FARM) === 'idle';
  if (!fieldsDone) return;
  const free = (h) => !h.player && !(h.ordered && h.ordered.m) && !(h.plan && h.plan.half === 'm') && (!h.assign.m || h.assign.m.kind === 'farm');
  const men = [];
  for (const h of aliveHouseholds(v)) {
    if (!free(h)) continue;
    for (const id of h.members) {
      const p = v.people[id];
      if (p.alive && !p.away && p.sex === 'm' && canWork(v, p) && (!p.assign || p.spareHerd)) men.push(p);
    }
  }
  if (!men.length) return;
  const worthOf = new Map(aliveHouseholds(v).map((h) => [h.id, worth(v, h)]));
  const projects = (v.projects || []).filter((x) => hireOf(x).on && hireable(v, x)).sort((a, b) => a.started - b.started);
  for (const x of projects) {
    const { own } = crewAt(v, x);
    let want = Math.min(hireOf(x).cap - own.length, canPay(v, x));
    if (want <= 0) continue;
    const payer = hireOf(x).from === 'common' ? -1 : x.sponsor;
    men.sort((a, b) => (worthOf.get(a.household) - worthOf.get(b.household)) * 1e-4 - (tie(v, a.household, x.sponsor) - tie(v, b.household, x.sponsor)) + (lifeStage(v, a) === 'adult' ? 0 : 1) - (lifeStage(v, b) === 'adult' ? 0 : 1));
    while (want > 0 && men.length) {
      const i = men.findIndex((p) => p.household !== x.sponsor);
      if (i < 0) break;
      const [p] = men.splice(i, 1);
      p.assign = { kind: 'build', id: x.id };
      p.hiredHand = true;
      p.spareHerd = false;
      want--;
    }
    if (payer < 0 && !x.public && !x.commonNoted) {
      x.commonNoted = true;
      logNews(v, 'council', `Men are hired for ${x.name} with grain from the common granary. The other houses do not like to see the village's grain spent on one house's own work.`, { house: x.sponsor });
    }
  }
}

// ---- herding ----

const atPasture = (a) => a && a.kind === 'pasture';
const herdMen = (v, h) => h.members.map((id) => v.people[id]).filter((p) => p.alive && !p.away && p.sex === 'm' && canWork(v, p));

// How many men each household with leave to herd sends to the flock: only as many as it still
// needs, after anyone you have sent there yourself; the house that took it up first sends first.
export function allotHerders(v) {
  const needed = Math.ceil(v.flock.head / FLOCK.perHerder);
  let out = v.people.filter((p) => p.alive && !p.away && atPasture(p.assign) && !p.spareHerd).length;
  for (const h of aliveHouseholds(v)) if (h.ordered && h.ordered.m && atPasture(h.assign.m)) out += herdMen(v, h).filter((p) => !p.assign).length;
  const allot = new Map();
  const herding = aliveHouseholds(v).filter((h) => h.plan && h.plan.kind === 'herd' && !(h.ordered && h.ordered.m)).sort((a, b) => a.plan.since - b.plan.since);
  for (const h of herding) {
    const n = Math.max(0, Math.min(herdMen(v, h).filter((p) => !p.assign || p.spareHerd).length, needed - out));
    allot.set(h.id, n);
    out += n;
  }
  return { needed, out, allot };
}

// The men of a herding house the flock does not need go about the house's usual work instead.
function spareHerders(v) {
  for (const p of v.people) if (p.spareHerd) {
    p.assign = null;
    p.spareHerd = false;
  }
  const { allot } = allotHerders(v);
  for (const [id, n] of allot) {
    const h = v.households[id];
    if (!atPasture(h.assign.m)) continue;
    // Grown men first; boys and old men go only if they are needed.
    const men = herdMen(v, h).filter((p) => !p.assign).sort((a, b) => (lifeStage(v, a) === 'adult' ? 0 : 1) - (lifeStage(v, b) === 'adult' ? 0 : 1));
    for (const p of men.slice(n)) {
      p.assign = { ...FARM };
      p.spareHerd = true;
    }
  }
}

// For a petition to herd: the flock's need now, and who else is asking.
export function herdingNeed(v, house) {
  const { needed, out } = allotHerders(v);
  const asking = (v.petitions || []).filter((p) => p.kind === 'herd' && p.house !== house).map((p) => v.households[p.house]);
  const men = herdMen(v, v.households[house]).length;
  return { needed, out, short: Math.max(0, needed - out), asking, men };
}

// Households send men to drill of their own accord, when the work that has to be done is done:
// never while their own fields need them, and in the busy months only if they can afford to give
// up a hired man's wages. The better off a house, the more its men drill: they have the leisure,
// and a hoplite's standing to keep up. Your house does the same, unless you have sent its men, or
// the man himself, somewhere else.
function drillDay(v) {
  const rng = villageRng(v);
  const slack = !v.land.fields.some((f) => fieldTask(v, f));
  for (const p of v.people) if (p.selfDrill) {
    p.assign = null;
    p.selfDrill = false;
  }
  for (const h of aliveHouseholds(v)) {
    if (h.ordered.m || ownFieldsCall(v, h)) continue;
    if (h.plan && h.plan.half === 'm' && h.plan.kind !== 'herd') continue;
    // How far its grain would carry it: the measure of what it can spare.
    const days = h.stores.grain / Math.max(0.1, dailyGrain(v, h));
    const ease = clamp((days - DRILL.easeFrom) / DRILL.easeSpan, 0, 1);
    let chance = slack ? DRILL.slack + DRILL.slackEase * ease : DRILL.busyEase * Math.max(0, ease - 0.4);
    // And what it would cost in grain: a drilling man eats more than one at home. A house on short
    // rations sends no one; one with little to spare beyond what it must keep, few.
    const men = h.members.filter((id) => isDrill(v, v.people[id]) && !v.people[id].away).length;
    const extra = VILLAGE.ration.man * EXERTION.food * (TASKS.drill.strength * DRILL.hours / EXERTION.day - EXERTION.usual);
    const spare = h.stores.grain + h.sheep * FLOCK.meat - grainReserve(v, h);
    chance *= h.rationing ? 0 : clamp(spare / Math.max(0.1, extra * men * DRILL.costDays), 0, 1);
    if (chance <= 0) continue;
    for (const id of h.members) {
      const p = v.people[id];
      if (!p.alive || p.away || (p.assign && !p.spareHerd) || !isDrill(v, p)) continue;
      if (h.plan && h.plan.kind === 'herd' && p.task === 'herd') continue;
      const keen = ageYears(v, p) < 40 ? 1 : 0.5;
      if (!rng.chance(chance * keen)) continue;
      p.assign = { kind: 'drill', id: 0 };
      p.selfDrill = true;
      p.spareHerd = false;
    }
  }
}

// Where a granted plan takes the household's men today.
function planSite(v, h, plan) {
  if (plan.kind === 'wood') return { kind: 'grove', id: plan.grove };
  if (plan.kind === 'herd') return { kind: 'pasture', id: 0 };
  if (plan.kind === 'clear') return projectOf(v, plan.project) ? { kind: 'build', id: plan.project } : null;
  if (plan.kind === 'build' || plan.kind === 'forge') {
    const x = projectOf(v, plan.project);
    if (!x) return null;
    // Stone first, then timber, then the walls.
    const left = (k) => x.needs[k] * (1 - x.done.work / x.needs.work) - (h.stores[k] || 0);
    if (left('stone') > 0) return QUARRY(v);
    if (left('wood') > 0) return { kind: 'grove', id: nearestGrove(v) };
    return { kind: 'build', id: x.id };
  }
  return null;
}

function nearestGrove(v) {
  let best = 0;
  let bd = Infinity;
  for (const g of v.land.groves) {
    if (g.material === 'stone') continue;
    const standing = g.trees.reduce((a, t) => a + (v.land.trees[t].wood > 50 ? 1 : 0), 0);
    if (!standing) continue;
    const d = Math.hypot(g.x, g.y);
    if (d < bd) {
      bd = d;
      best = g.id;
    }
  }
  return best;
}

// ---- council days ----

export function councilEvery(v) {
  return v.councilEvery ?? COUNCIL.councilEvery;
}

// Days a petition waits for an answer: always past the next council day.
export function answerWithin(v) {
  return Math.max(COUNCIL.answerWithin, councilEvery(v) + 2);
}

// ---- what a household wants ----

// Each household thinks things over every few days. If its plan is done, it goes back to its
// routine; if it wants something more, it asks you.
export function thinkAhead(v) {
  const hs = aliveHouseholds(v);
  for (const h of hs) {
    if (h.player || (v.day + h.id) % COUNCIL.thinkEvery !== 0) continue;
    if (h.plan && planDone(v, h, h.plan)) {
      logNews(v, 'council', `The house of ${h.name} ${planDoneText(h.plan)}, and goes back to its usual work.`, { house: h.id });
      h.plan = null;
    }
    if (h.plan || (v.petitions || []).some((p) => p.house === h.id)) continue;
    const want = wants(v, h, hs);
    if (!want) continue;
    if (h.refused && h.refused[want.kind] > v.day - COUNCIL.cooldown) continue;
    v.petitions = v.petitions || [];
    const pet = { id: v.nextPetitionId++, house: h.id, day: v.day, ...want };
    v.petitions.push(pet);
    // Settled by your standing word, if you have given one for this kind of thing.
    const rule = (v.rules || {})[ruleOf(pet)];
    if (rule === 'grant') grant(v, pet, true);
    else if (rule === 'grantFee') grant(v, pet, true, COUNCIL.feeUsual);
    else if (rule === 'refuse') refuse(v, pet, false, true);
    else logNews(v, 'petition', `The house of ${h.name} asks your leave ${PETITION_TEXT[want.kind]}.`, { house: h.id, pause: true });
  }
  // A petition left unanswered too long counts as refused.
  for (const p of [...(v.petitions || [])]) if (v.day - p.day > answerWithin(v)) refuse(v, p, true);
}

// Whether cutting wood to sell pays now: a man's day of it, at the going price, against a day's wage,
// with buyers who could not get all they wanted.
export function woodPays(v) {
  const w = v.wanted && v.wanted.wood;
  return v.prices.wood * COUNCIL.woodDay >= ECONOMY.wage * COUNCIL.woodPays && !!w && w.demand > w.supply;
}

// How many houses cutting to sell the buyers' shortfall would keep busy for a month.
function woodSellersWanted(v) {
  const w = v.wanted && v.wanted.wood;
  if (!w) return 0;
  return clamp(Math.ceil((w.demand - w.supply) / (COUNCIL.woodDay * 30)), 1, COUNCIL.woodSellers);
}

function planDone(v, h, plan) {
  // Cutting to sell goes on while it pays: a season of it at a time.
  if (plan.kind === 'wood' && plan.forSale) return v.day - plan.since > 90 || (v.day - plan.since > 20 && !woodPays(v));
  if (plan.kind === 'wood') return h.stores.wood >= dailyFuel(v) * plan.until || v.day - plan.since > 60;
  if (plan.kind === 'herd') return v.day - plan.since > 120;
  return !projectOf(v, plan.project);
}

function planDoneText(plan) {
  return { wood: 'has its wood in', herd: 'gives up the herding', clear: 'has its new field cleared', build: 'has its new house built', forge: 'has its forge built' }[plan.kind];
}

function workingMen(v, h) {
  return h.members.map((id) => v.people[id]).filter((p) => p.alive && p.sex === 'm' && canWork(v, p)).length;
}

// The households already at a kind of work, or asking to be: their plans, or your orders.
function committed(v, kind) {
  const site = { wood: 'grove', herd: 'pasture' }[kind];
  const out = new Set();
  for (const o of aliveHouseholds(v)) {
    if (o.player) continue;
    if (o.plan && o.plan.kind === kind) out.add(o);
    if ((v.petitions || []).some((p) => p.house === o.id && p.kind === kind)) out.add(o);
    if (site && o.ordered && o.ordered.m && o.assign.m && o.assign.m.kind === site && !(site === 'grove' && v.land.groves[o.assign.m.id].material === 'stone')) out.add(o);
  }
  return [...out];
}

// Those who would mind your granting this: households already making their living at the same
// work.
// Cutting wood for your own hearth takes nobody's trade; cutting it to sell does.
export function rivalsOf(v, p) {
  if (p.kind !== 'wood' || !p.forSale) return [];
  return committed(v, 'wood').filter((o) => o.id !== p.house && o.plan && o.plan.forSale !== false && !(v.petitions || []).some((q) => q.house === o.id && q.kind === 'wood'));
}

// What a household would ask for now, and why.
function wants(v, h, hs) {
  const m = monthOf(v);
  const men = workingMen(v, h);
  if (!men) return null;
  // Busy while its own fields need it; free once its sowing or reaping is done.
  const busySeason = ownFieldsCall(v, h);
  const fuel = dailyFuel(v);
  const woodDays = h.stores.wood / fuel;
  const rank = [...hs].sort((a, b) => worth(v, b) - worth(v, a)).indexOf(h);
  const doing = (kind) => committed(v, kind).filter((o) => o !== h);
  // A son of the house wants a house of his own, and none stands empty.
  if (h.waiting >= 0 && freeHouse(v) < 0 && freePlot(v) >= 0 && !(v.projects || []).some((x) => x.sponsor === h.id && x.kind === 'house')) {
    return { kind: 'build', why: `${v.people[h.waiting].name} has a wife and children and wants a house of his own. They would quarry the stone and cut the timber themselves.` };
  }
  // Wood, for its own hearth before winter, or to sell while it pays.
  const winterComing = m >= 0 && m <= 3;
  const ownNeed = woodDays < (winterComing ? 45 : 20);
  // Cutting to sell: while a day of it fetches more than a day's wage would, and there are buyers
  // short of it (the forge above all, which burns more than any hearth), and not so many others at
  // it already as the buyers need.
  const sellers = doing('wood').filter((o) => o.plan && o.plan.forSale).length;
  if (!busySeason && (ownNeed || (woodPays(v) && sellers < woodSellersWanted(v)))) {
    const forge = v.smith && !v.smith.ruined && (v.smith.burn || 0) > dailyFuel(v);
    const why = ownNeed
      ? `Their woodpile is down to ${Math.floor(woodDays)} days${winterComing ? ', with winter coming' : ''}.`
      : `Firewood is fetching ${v.prices.wood.toFixed(2)} kg of barley a kilo at the gate, more than a man earns in a day's hire, and ${forge ? 'the forge cannot get enough of it' : 'there are buyers short of it'}. They have hands to spare.`;
    return { kind: 'wood', why, grove: nearestGrove(v), until: winterComing ? 120 : 60, forSale: !ownNeed };
  }
  // A well-off house with land too small for its mouths, in the slack of the year.
  const land = v.land.fields.filter((f) => f.owner === h.id).reduce((a, f) => a + f.ha, 0);
  const mouths = h.members.filter((id) => v.people[id].alive).length;
  // Your rents put them off: the more you have asked for leave to clear before, the less they ask.
  const rent = v.rentsAsked && v.rentsAsked.length ? v.rentsAsked.reduce((a, x) => a + x, 0) / v.rentsAsked.length : COUNCIL.feeUsual;
  const putOff = rent > COUNCIL.feeUsual && (v.day + h.id * 7) % 10 < Math.round(Math.min(9, (rent - COUNCIL.feeUsual) * 40));
  if (!busySeason && !putOff && rank < hs.length / 2 && men >= 2 && land / Math.max(1, mouths) < COUNCIL.landPerMouth && freeWild(v) >= 0 && !(v.projects || []).some((x) => x.sponsor === h.id && x.kind === 'field')) {
    return { kind: 'clear', ha: v.land.wild[freeWild(v)].ha, why: `They have ${land.toFixed(1)} ha for ${mouths} mouths, and men to spare in the slack season. About ${Math.round(BUILD.field.work * 1.2)} days' work.` };
  }
  // No smith in the village, and the walk to Athens for every mending: a house with a man who
  // learned the trade in the city would set up a forge. Or an empty forge wants a smith.
  const trips = (v.cityTrips || []).filter((d) => d > v.day - 360).length;
  const forging = (v.projects || []).some((x) => x.kind === 'forge') || (v.petitions || []).some((p) => p.kind === 'forge' && p.house !== h.id);
  if (!hasSmith(v) && !forging && !busySeason && men >= 2 && rank >= hs.length / 4 && (trips >= 3 || (v.smith && v.smith.man < 0))) {
    const son = h.members.map((id) => v.people[id]).filter((p) => p.alive && p.sex === 'm' && !p.slave && ageYears(v, p) >= 18 && ageYears(v, p) < 40)[0];
    if (son && (v.day + h.id) % 3 === 0) {
      return v.smith
        ? { kind: 'forge', man: son.id, takeOver: true, why: `The forge outside the gate stands cold. ${son.name} would take it on and be the village's smith.` }
        : { kind: 'forge', man: son.id, why: `${trips} times this year men have walked to Athens to buy tools or have them mended. ${son.name} worked at a smithy in the city; they would build a forge outside the gate and set him up as the village's smith. They would quarry the stone and cut the timber themselves.` };
    }
  }
  // The flock is short of herders, and a poorer house would take the wages.
  const herders = doing('herd').reduce((a, o) => a + workingMen(v, o), 0);
  const needed = Math.ceil(v.flock.head / FLOCK.perHerder);
  if (herders < needed && rank >= hs.length / 2) {
    return { kind: 'herd', why: `The flock is short of herders, and they would take the herders' pay.` };
  }
  return null;
}

// ---- your answer ----

// What one harvest of new land of this size should bring, in kg of barley.
export function clearingHarvest(ha) {
  return ha * FIELDS.yield * BUILD.field.soil;
}

// fee: for leave to clear land, the share of each harvest it gives you ask as rent to your house.
export function grant(v, p, standing = false, fee = 0) {
  const h = v.households[p.house];
  v.petitions = v.petitions.filter((o) => o !== p);
  addGoodwill(v, h, COUNCIL.grantGain);
  let charged = 0;
  const plan = { kind: p.kind, half: 'm', since: v.day };
  if (p.kind === 'wood') Object.assign(plan, { grove: p.grove, until: p.until, forSale: p.forSale });
  if (p.kind === 'build') {
    const x = planHouse(v, h.id);
    if (!x) return;
    plan.project = x.id;
  }
  if (p.kind === 'forge') {
    const man = v.people[p.man];
    if (!man || !man.alive) return;
    man.skills.smith = Math.max(man.skills.smith || 0, SMITH.start);
    if (p.takeOver && v.smith) {
      // The empty forge is theirs to work.
      v.smith.house = h.id;
      v.smith.man = man.id;
      logNews(v, 'council', `${standing ? 'By your standing word, you give' : 'You give'} the house of ${h.name} the forge. ${man.name} is the village's smith now.`, { house: h.id, pause: true });
      return;
    }
    const x = planForge(v, h.id, man.id);
    if (!x) return;
    plan.project = x.id;
  }
  if (p.kind === 'clear') {
    const x = planField(v, h.id);
    if (!x) return;
    plan.project = x.id;
    // A tenth is what they expect to pay; less pleases them, more does not. Once the field is
    // cleared, that share of each harvest it gives goes to your house, whoever holds it.
    addGoodwill(v, h, COUNCIL.feeFeel * (COUNCIL.feeUsual - fee) / COUNCIL.feeUsual);
    charged = fee;
    v.rentsAsked = [...(v.rentsAsked || []), fee].slice(-6);
    const me = v.households.find((o) => o.player);
    if (fee > 0 && me) x.rent = { share: fee, to: me.id };
  }
  h.plan = plan;
  // Those already doing this work see their trade undercut; the more so when it is already well
  // supplied.
  const glut = p.kind === 'wood' ? clamp(COUNCIL.dearWood / Math.max(0.01, v.prices.wood), 0.5, 1.5) : 1;
  const rivals = rivalsOf(v, p).map((o) => o.id);
  for (const id of rivals) {
    const o = v.households[id];
    addGoodwill(v, o, -COUNCIL.undercut * glut);
    addTie(v, o.id, h.id, -COUNCIL.rivalry * glut);
  }
  const price = p.kind === 'clear' ? (charged > 0 ? ` for a rent of ${Math.round(charged * 100)}% of each harvest it gives${fee > COUNCIL.feeUsual ? ', more than is usual' : fee < COUNCIL.feeUsual ? ', less than is usual' : ''}` : ', asking nothing for it') : '';
  logNews(v, 'council', `${standing ? 'By your standing word, you give' : 'You give'} the house of ${h.name} leave ${PETITION_TEXT[p.kind]}${price}.${rivals.length ? ` The house${rivals.length > 1 ? 's' : ''} of ${rivals.map((id) => v.households[id].name).join(' and ')} ${rivals.length > 1 ? 'are' : 'is'} not pleased.` : ''}`, { house: h.id });
}

export function refuse(v, p, lapsed = false, standing = false) {
  const h = v.households[p.house];
  v.petitions = v.petitions.filter((o) => o !== p);
  // Refusing those in real need hurts more.
  const need = p.kind === 'wood' && h.stores.wood / dailyFuel(v) < 20 ? 2 : p.kind === 'build' ? 1.5 : 1;
  addGoodwill(v, h, -COUNCIL.refuseLoss * need * (lapsed ? 1.3 : 1));
  h.refused = h.refused || {};
  h.refused[p.kind] = v.day;
  logNews(v, 'council', lapsed ? `You never answered the house of ${h.name}, who wanted ${PETITION_TEXT[p.kind]}. They take it as no.` : `${standing ? 'By your standing word, you refuse' : 'You refuse'} the house of ${h.name} leave ${PETITION_TEXT[p.kind]}.`, { house: h.id });
}

// Your order to a household, over its own plans. Sending them home is no order at all: it leaves
// them to do as they see fit.
export function order(v, h, half, site) {
  h.ordered = h.ordered || { m: false, f: false };
  if (!site) {
    release(v, h, half);
    return;
  }
  h.ordered[half] = true;
  h.assign[half] = site ? { kind: site.kind, id: site.id } : null;
  if (!h.player) addGoodwill(v, h, -COUNCIL.orderCost);
}

export function release(v, h, half) {
  h.ordered = h.ordered || { m: false, f: false };
  h.ordered[half] = false;
}

// ---- ties grow day by day ----

// Households who work side by side grow closer. Grudges, and gratitude, fade with time.
export function tiesDay(v) {
  for (const h of v.households) if (!h.player && h.goodwill != null) h.goodwill += (COUNCIL.goodwill - h.goodwill) * COUNCIL.fade;
  for (const k of Object.keys(v.ties || {})) v.ties[k] *= 1 - COUNCIL.fade / 4;
  for (const c of crews(v)) {
    const hs = [...new Set([...c.halves.map((x) => x.h.id), ...c.persons.map((p) => p.household)])];
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) addTie(v, hs[i], hs[j], COUNCIL.workTogether);
  }
}

export function initCouncil(v, rng) {
  v.petitions = [];
  v.nextPetitionId = 1;
  v.ties = {};
  for (const h of v.households) {
    h.goodwill = h.player ? 1 : clamp(rng.normal(COUNCIL.goodwill, 0.1), 0.3, 0.9);
    h.ordered = { m: false, f: false };
    h.plan = null;
  }
  // Neighbours and kin start with some liking for one another.
  for (const a of v.households) for (const b of v.households) if (a.id < b.id) addTie(v, a.id, b.id, rng.range(-0.1, 0.25));
  void ageYears;
}
