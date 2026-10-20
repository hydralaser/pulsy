import { COUNCIL, FIELDS, FLOCK, BUILD } from './rules.js';
import { clamp } from '../sim/core.js';
import { canWork, fieldTask, crews, isDrill, TASKS } from './work.js';
import { villageRng } from './people.js';
import { dailyGrain, grainReserve } from './economy.js';
import { DRILL, VILLAGE, EXERTION } from './rules.js';
import { dailyFuel, worth, aliveHouseholds } from './economy.js';
import { freeHouse } from './family.js';
import { planHouse, planField, freePlot, freeWild, projectOf } from './building.js';
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
  { key: 'clear', group: 'For their own use', text: 'Clearing new land for their own farm' },
  { key: 'woodSale', group: 'To make a living', text: 'Cutting wood to sell' },
  { key: 'herd', group: 'To make a living', text: 'Herding the flock for the herders\' pay' },
];

export function ruleOf(p) {
  return p.kind === 'wood' ? (p.forSale ? 'woodSale' : 'woodOwn') : p.kind;
}

export const PETITION_TEXT = {
  wood: 'to cut wood',
  build: 'to build a house',
  clear: 'to clear new land for a field',
  herd: 'to take the flock out',
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

// Each dawn: every household's men and women go where its own plan, or your order, sends them.
export function decideDay(v) {
  for (const h of aliveHouseholds(v)) {
    h.ordered = h.ordered || { m: false, f: false };
    for (const half of ['m', 'f']) {
      if (h.ordered[half]) continue;
      let site = routine(v, h, half);
      const plan = h.plan;
      if (plan && plan.half === half && !(ownFieldsCall(v, h) && plan.kind !== 'herd')) site = planSite(v, h, plan) || site;
      h.assign[half] = site ? { kind: site.kind, id: site.id } : null;
    }
  }
  drillDay(v);
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
      if (!p.alive || p.away || p.assign || !isDrill(v, p)) continue;
      if (h.plan && h.plan.kind === 'herd' && p.task === 'herd') continue;
      const keen = ageYears(v, p) < 40 ? 1 : 0.5;
      if (!rng.chance(chance * keen)) continue;
      p.assign = { kind: 'drill', id: 0 };
      p.selfDrill = true;
    }
  }
}

// Where a granted plan takes the household's men today.
function planSite(v, h, plan) {
  if (plan.kind === 'wood') return { kind: 'grove', id: plan.grove };
  if (plan.kind === 'herd') return { kind: 'pasture', id: 0 };
  if (plan.kind === 'clear') return projectOf(v, plan.project) ? { kind: 'build', id: plan.project } : null;
  if (plan.kind === 'build') {
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
    else if (rule === 'refuse') refuse(v, pet, false, true);
    else logNews(v, 'petition', `The house of ${h.name} asks your leave ${PETITION_TEXT[want.kind]}.`, { house: h.id, pause: true });
  }
  // A petition left unanswered too long counts as refused.
  for (const p of [...(v.petitions || [])]) if (v.day - p.day > COUNCIL.answerWithin) refuse(v, p, true);
}

function planDone(v, h, plan) {
  if (plan.kind === 'wood') return h.stores.wood >= dailyFuel(v) * plan.until || v.day - plan.since > 60;
  if (plan.kind === 'herd') return v.day - plan.since > 120;
  return !projectOf(v, plan.project);
}

function planDoneText(plan) {
  return { wood: 'has its wood in', herd: 'gives up the herding', clear: 'has its new field cleared', build: 'has its new house built' }[plan.kind];
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
  if (h.waiting >= 0 && freeHouse(v) < 0 && freePlot(v) >= 0 && !(v.projects || []).some((x) => x.sponsor === h.id && x.kind !== 'field')) {
    return { kind: 'build', why: `${v.people[h.waiting].name} has a wife and children and wants a house of his own. They would quarry the stone and cut the timber themselves.` };
  }
  // Wood, for its own hearth before winter, or to sell while it is dear.
  const winterComing = m >= 0 && m <= 3;
  const dear = v.prices.wood > COUNCIL.dearWood;
  const ownNeed = woodDays < (winterComing ? 45 : 20);
  // Cutting to sell is only worth it while few others are at it.
  if (!busySeason && (ownNeed || (dear && woodDays < 120 && doing('wood').length < 2))) {
    const why = woodDays < (winterComing ? 45 : 20)
      ? `Their woodpile is down to ${Math.floor(woodDays)} days${winterComing ? ', with winter coming' : ''}.`
      : `Firewood is fetching ${v.prices.wood.toFixed(2)} kg of barley a kilo at the gate, and they have hands to spare.`;
    return { kind: 'wood', why, grove: nearestGrove(v), until: winterComing ? 120 : 60, forSale: !ownNeed };
  }
  // A well-off house with land too small for its mouths, in the slack of the year.
  const land = v.land.fields.filter((f) => f.owner === h.id).reduce((a, f) => a + f.ha, 0);
  const mouths = h.members.filter((id) => v.people[id].alive).length;
  if (!busySeason && rank < hs.length / 2 && men >= 2 && land / Math.max(1, mouths) < COUNCIL.landPerMouth && freeWild(v) >= 0 && !(v.projects || []).some((x) => x.sponsor === h.id && x.kind === 'field')) {
    return { kind: 'clear', why: `They have ${land.toFixed(1)} ha for ${mouths} mouths, and men to spare in the slack season. About ${Math.round(BUILD.field.work * 1.2)} days' work.` };
  }
  // The flock is short of herders, and a poorer house would take the wages.
  const herders = doing('herd').reduce((a, o) => a + workingMen(v, o), 0);
  const needed = Math.ceil(v.flock.head / FLOCK.perHerder);
  if (herders < needed && rank >= hs.length / 2) {
    return { kind: 'herd', why: `The flock of ${v.flock.head} has ${herders} to watch it, and needs ${needed}. They would take the herders' pay.` };
  }
  return null;
}

// ---- your answer ----

export function grant(v, p, standing = false) {
  const h = v.households[p.house];
  v.petitions = v.petitions.filter((o) => o !== p);
  addGoodwill(v, h, COUNCIL.grantGain);
  const plan = { kind: p.kind, half: 'm', since: v.day };
  if (p.kind === 'wood') Object.assign(plan, { grove: p.grove, until: p.until, forSale: p.forSale });
  if (p.kind === 'build') {
    const x = planHouse(v, h.id);
    if (!x) return;
    plan.project = x.id;
  }
  if (p.kind === 'clear') {
    const x = planField(v, h.id);
    if (!x) return;
    plan.project = x.id;
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
  logNews(v, 'council', `${standing ? 'By your standing word, you give' : 'You give'} the house of ${h.name} leave ${PETITION_TEXT[p.kind]}.${rivals.length ? ` The house${rivals.length > 1 ? 's' : ''} of ${rivals.map((id) => v.households[id].name).join(' and ')} ${rivals.length > 1 ? 'are' : 'is'} not pleased.` : ''}`, { house: h.id });
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

// Your order to a household, over its own plans.
export function order(v, h, half, site) {
  h.ordered = h.ordered || { m: false, f: false };
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
