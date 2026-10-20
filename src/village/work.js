import { VILLAGE, FIELDS, WOOD, STONE, LIFE, MONTHS, DRILL } from './rules.js';
import { projectOf, projectTask, build } from './building.js';
import { siteOf } from './land.js';
import { lifeStage, villageRng, canFight } from './people.js';
import { monthOf, dawnOf, duskOf, logNews } from './clock.js';
import { ECONOMY } from './rules.js';
import { pay } from './economy.js';

const HOURS_A_DAY = 9; // a man-day of work

// Work is given to households: each household's men and its women are sent somewhere as a body,
// and every one of them old enough to work goes, unless you have sent one of them somewhere of
// his own. Households sent to the same
// place work there together. Nothing is closed to either sex; how well someone does a job comes
// from their strength, for the heavy work, and their skill, which grows with practice.
export const TASKS = {
  plough: { text: 'ploughing', skill: 'farm', strength: 0.8 },
  sow: { text: 'sowing', skill: 'farm', strength: 0.1 },
  weed: { text: 'hoeing the weeds', skill: 'farm', strength: 0.3 },
  reap: { text: 'reaping', skill: 'farm', strength: 0.5 },
  wood: { text: 'felling and hauling timber', skill: 'wood', strength: 0.8 },
  stone: { text: 'quarrying and hauling stone', skill: 'wood', strength: 0.9 },
  build: { text: 'building', skill: 'build', strength: 0.6 },
  clear: { text: 'clearing new land', skill: 'farm', strength: 0.8 },
  farm: { text: 'in the fields', skill: 'farm', strength: 0.5 },
  herd: { text: 'out with the flock', skill: 'herd', strength: 0.2 },
  house: { text: 'working at home', skill: 'house', strength: 0.2 },
  drill: { text: 'drilling for war', skill: null, strength: 0.6 },
  idle: { text: 'nothing to do there now', skill: null, strength: 0 },
};

export const HALVES = { m: 'men', f: 'women' };

// How wide a strip of a field each worker takes as the crew goes up and down it: a plough turns
// a furrow, sowers broadcast a wide cast, reapers and hoers stand in a line.
const SWATH = { plough: 0.3, hoe: 1.2, sow: 6, weed: 1.5, reap: 2 };

// Send one half of a household somewhere; null sends them home.
export function assign(v, h, half, site) {
  h.assign[half] = site ? { kind: site.kind, id: site.id } : null;
}

// Send one person somewhere of his own, away from his household's work; 'home' keeps him at home,
// and null puts him back with the rest of his household.
export function assignPerson(v, p, site) {
  p.assign = site ? { kind: site.kind, id: site.id } : null;
}

export const isDrill = (v, p) => canFight(v, p) && !!p.weapon;

export function sameSite(a, b) {
  return a && b && a.kind === b.kind && a.id === b.id;
}

// Every place anyone has been sent, with the households' halves sent there and the people who
// are there of their own.
export function crews(v) {
  const seen = new Map();
  const at = (s) => {
    const key = `${s.kind}:${s.id}`;
    if (!seen.has(key)) seen.set(key, { site: s, halves: [], persons: [] });
    return seen.get(key);
  };
  for (const h of v.households) {
    for (const half of ['m', 'f']) {
      const s = h.assign[half];
      if (s) at(s).halves.push({ h, half });
    }
  }
  for (const p of v.people) if (p.alive && p.assign && p.assign.kind !== 'home' && !p.away) at(p.assign).persons.push(p);
  return [...seen.values()];
}

// Everyone at a site: the halves sent there, less anyone sent elsewhere of his own, and those
// sent there of their own.
export function peopleAt(v, c) {
  return v.people.filter((p) => p.alive && !p.away && canWork(v, p) && (c.site.kind !== 'drill' || isDrill(v, p))
    && (p.assign ? c.persons.includes(p) : c.halves.some((x) => x.h.id === p.household && x.half === p.sex)));
}

export function siteOfPerson(v, p) {
  if (p.assign) return p.assign.kind === 'home' ? null : p.assign;
  return v.households[p.household].assign[p.sex] || null;
}

// What there is to do at a field this month.
export function fieldTask(v, f) {
  const m = monthOf(v);
  const year = Math.floor(v.day / 360);
  const sowYear = f.rotation === year % 2;
  if (f.state === 'ripe') return 'reap';
  if (f.state === 'stubble' && sowYear && m >= FIELDS.sowFrom && m <= FIELDS.sowTo) return f.ploughed < 1 ? 'plough' : 'sow';
  if (f.state === 'sown' && m >= 3 && m <= 5 && f.weeded < 1) return 'weed';
  return null;
}

// What is to be done at a site today.
export function siteTask(v, site) {
  if (!site) return 'house';
  const s = siteOf(v, site);
  if (site.kind === 'field') return fieldTask(v, s) || 'idle';
  if (site.kind === 'farm') return v.land.fields.some((f) => fieldTask(v, f)) ? 'farm' : 'idle';
  if (site.kind === 'grove') return s.trees.some((t) => v.land.trees[t].wood > 50) ? (s.material === 'stone' ? 'stone' : 'wood') : 'idle';
  if (site.kind === 'build') return projectTask(v, projectOf(v, site.id));
  if (site.kind === 'pasture') return 'herd';
  if (site.kind === 'drill') return 'drill';
  return 'idle';
}

// A household's woodpile, stacked against the outside of its house.
export function woodpileOf(v, household) {
  const hs = v.land.houses[v.households[household].house] || { x: 0, y: 0 };
  const d = Math.hypot(hs.x, hs.y) || 1;
  return { x: hs.x + (hs.x / d) * 7, y: hs.y + (hs.y / d) * 7 };
}

// Where someone is at home: by their house, each in their own spot.
export function homeOf(v, p) {
  const hs = v.land.houses[v.households[p.household].house] || { x: 0, y: 0 };
  return { x: hs.x + ((p.id * 37) % 9) - 4, y: hs.y + ((p.id * 53) % 9) - 4 };
}

// Whether someone is of an age to work: children help from seven, the old do what they can.
export function canWork(v, p) {
  const s = lifeStage(v, p);
  return p.alive && s !== 'infant' && s !== 'child';
}

export function workRate(v, p, task) {
  const t = TASKS[task];
  const s = lifeStage(v, p);
  const age = s === 'youth' ? 0.5 : s === 'elder' ? 0.6 : s === 'adult' ? 1 : 0;
  const strength = 1 - t.strength + t.strength * (p.strength / 0.75);
  const skill = t.skill ? p.skills[t.skill] : 0.5;
  return age * strength * (0.4 + 0.6 * p.fed) * (0.7 + 0.6 * skill) * p.health;
}

// Walk toward a point at so many km an hour; true on arrival.
function moveTo(p, goal, kmh, dt) {
  const dx = goal.x - p.pos.x;
  const dy = goal.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  const step = kmh * 1000 * dt;
  if (d <= step) {
    p.pos.x = goal.x;
    p.pos.y = goal.y;
    return true;
  }
  p.pos.x += (dx / d) * step;
  p.pos.y += (dy / d) * step;
  return false;
}

const km = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / 1000;

// ---- the morning ----

// Dawn: everyone with work away from home sets out for it; those at home plan their chores.
export function morning(v) {
  const rng = villageRng(v);
  for (const y of v.yokes) y.busy = false;
  v.hired = [];
  v.handsOn = {};
  const gangs = new Map();
  const groveCrews = new Map();
  let drillers = 0;
  for (const f of v.land.fields) f.crew = [];
  for (const p of v.people) {
    if (!p.alive) continue;
    // Away with the army: no work at home until he is back.
    if (p.away) {
      p.task = null;
      p.state = 'away';
      continue;
    }
    p.load = 0;
    p.task = 'house';
    p.state = 'home';
    p.goal = null;
    p.sub = null;
    p.chores = null;
    p.yoke = false;
    if (!canWork(v, p)) {
      p.task = null;
      continue;
    }
    const site = siteOfPerson(v, p);
    const task = siteTask(v, site);
    if (!site || task === 'idle') continue;
    p.state = 'out';
    if (site.kind === 'field' || site.kind === 'farm') {
      // Sent to the fields in general: a household's men, or its women, go together to whichever
      // field most needs hands.
      let f = siteOf(v, site);
      if (site.kind === 'farm') {
        const key = `${p.household}${p.sex}`;
        if (!gangs.has(key)) gangs.set(key, pickField(v, p.household));
        f = gangs.get(key);
      }
      p.field = f.id;
      p.task = fieldTask(v, f);
      f.crew.push(p.id);
      v.handsOn[f.id] = (v.handsOn[f.id] || 0) + 1;
      p.leaveAt = duskOf(v) - km(f, v.land.gate) / VILLAGE.walk;
    } else if (site.kind === 'build') {
      const s = siteOf(v, site);
      p.task = task;
      p.project = site.id;
      p.goal = s.w ? { x: s.x + rng.range(-0.4, 0.4) * s.w, y: s.y + rng.range(-0.4, 0.4) * s.h } : { x: s.x + rng.range(-9, 9), y: s.y + rng.range(-7, 7) };
      p.leaveAt = duskOf(v) - km(s, v.land.gate) / VILLAGE.walk - 0.3;
    } else if (site.kind === 'grove') {
      const g = siteOf(v, site);
      p.task = g.material === 'stone' ? 'stone' : 'wood';
      p.grove = g.id;
      p.sub = 'toStand';
      pickStand(v, rng, p);
      if (!groveCrews.has(g.id)) groveCrews.set(g.id, []);
      groveCrews.get(g.id).push(p);
      p.leaveAt = duskOf(v) - km(g, v.land.gate) / VILLAGE.drag - 0.3;
    } else if (site.kind === 'drill') {
      // Only men of fighting age with arms of their own drill; anyone else sent with them stays home.
      if (!isDrill(v, p)) {
        p.state = 'home';
        continue;
      }
      const d = v.land.drill;
      const i = drillers++;
      p.task = 'drill';
      p.goal = { x: d.x - d.w / 2 + 4 + (i % 8) * 4, y: d.y - d.h / 2 + 5 + Math.floor(i / 8) * 5 };
      p.leaveAt = duskOf(v) - km(d, v.land.gate) / VILLAGE.walk - 0.5;
    } else if (site.kind === 'pasture') {
      p.task = 'herd';
      p.pasture = site.id;
      p.leaveAt = duskOf(v) - km(siteOf(v, site), v.land.gate) / VILLAGE.walk - 0.5;
    }
  }
  // Ploughmen take the yokes of oxen, as many as there are.
  for (const f of v.land.fields) {
    for (const id of f.crew) {
      const p = v.people[id];
      if (p.task !== 'plough') continue;
      // His household's own oxen if it has them, or another's, hired for the day.
      const y = v.yokes.find((o) => o.owner === p.household && !o.busy) || v.yokes.find((o) => !o.busy);
      if (!y) continue;
      y.busy = true;
      p.yoke = true;
      if (y.owner !== p.household) v.hired.push({ from: p.household, to: y.owner, kg: ECONOMY.yokeHire, why: 'oxen' });
    }
  }
  // A yoke left over and a cart: a crew in the woods takes it, and one of them drives it.
  v.cartsOut = [];
  for (const [gid, crew] of groveCrews) {
    const yoke = v.yokes.find((o) => !o.busy);
    const cartOwner = v.cartOwners.find((o) => !v.cartsOut.some((c) => c.owner === o));
    if (crew.length < 2 || !yoke || cartOwner == null) continue;
    yoke.busy = true;
    const carter = crew.reduce((a, b) => (b.skills.wood < a.skills.wood ? b : a));
    if (yoke.owner !== carter.household) v.hired.push({ from: carter.household, to: yoke.owner, kg: ECONOMY.yokeHire, why: 'oxen' });
    if (cartOwner !== carter.household) v.hired.push({ from: carter.household, to: cartOwner, kg: ECONOMY.cartHire, why: 'cart' });
    carter.sub = 'cart';
    v.cartsOut.push({ grove: gid, driver: carter.id, owner: cartOwner, load: 0, shares: {}, pos: { ...v.land.woodpile }, state: 'out' });
  }
  for (const [gid, crew] of groveCrews) v.land.groves[gid].carted = v.cartsOut.some((c) => c.grove === gid);

  // The flock goes out with its herders, if it has any.
  const herders = v.people.filter((p) => p.alive && p.task === 'herd');
  const fl = v.flock;
  fl.herders = herders.length;
  fl.out = herders.length > 0;
  fl.pasture = fl.out ? herders[0].pasture : null;
  fl.graze = null;
  fl.home = false;
  herders.forEach((p, i) => { p.herdSlot = i; });

  planChores(v, rng);
}

// The field with work to do that has fewest hands on it for its size, the nearer the better.
function pickField(v, household) {
  let best = null;
  let bestScore = Infinity;
  // Its own land first; then, hired, wherever hands are wanted.
  const own = v.land.fields.filter((f) => f.owner === household && fieldTask(v, f));
  for (const f of own.length ? own : v.land.fields) {
    const task = fieldTask(v, f);
    if (!task) continue;
    // Reaping comes first, before the grain sheds; then sowing, then the rest.
    const urgency = task === 'reap' ? 0.3 : task === 'plough' || task === 'sow' ? 1 : 2;
    const score = (((v.handsOn[f.id] || 0) + 1) / f.ha) * urgency + f.dist / 3000;
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

// A stand of trees to work on, near the others.
function pickStand(v, rng, p) {
  const g = v.land.groves[p.grove];
  const standing = g.trees.map((t) => v.land.trees[t]).filter((t) => t.wood > 50);
  if (!standing.length) {
    p.tree = -1;
    return;
  }
  // Start on the side nearest the village and work in.
  standing.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const t = standing[Math.min(standing.length - 1, rng.int(Math.min(4, standing.length)))];
  p.tree = t.id;
  p.stand = { x: t.x + rng.range(-5, 5), y: t.y + rng.range(-5, 5) };
}

// Those who stay home: water from the well morning, midday and evening; the washing taken down to
// the stream every few days; and a meal carried out at midday to the household's men working away.
function planChores(v, rng) {
  const dawn = dawnOf(v);
  const dusk = duskOf(v);
  const summer = MONTHS[monthOf(v)].season === 'summer';
  for (const h of v.households) {
    const home = h.members.map((id) => v.people[id]).filter((p) => p.alive && p.task === 'house' && p.state === 'home');
    if (!home.length) continue;
    // Women and girls first for the fetching and carrying, then whoever else is home.
    home.sort((a, b) => (a.sex === b.sex ? lifeStage(v, b) === 'youth' ? 1 : -1 : a.sex === 'f' ? -1 : 1));
    for (const p of home) p.chores = [];
    let k = 0;
    const next = () => home[k++ % home.length];
    const waterTimes = summer ? [dawn + 0.4, 11, 15, dusk - 1.2] : [dawn + 0.4, 12, dusk - 1.2];
    for (const t of waterTimes) next().chores.push({ kind: 'water', at: wellSpot(v, rng), from: t, until: t + 0.35 });
    if ((v.day + h.id) % 6 === 0) {
      const p = next();
      p.chores.push({ kind: 'wash', at: { x: v.land.washing.x + rng.range(-12, 12), y: v.land.washing.y + rng.range(-6, 6) }, from: dawn + 1.5, until: dawn + 5 });
    }
    // A meal for the men in the fields or the woods.
    const away = h.members.map((id) => v.people[id]).find((p) => p.alive && p.state === 'out' && p.task !== 'herd');
    if (away) {
      const bearer = home.find((p) => lifeStage(v, p) === 'youth') || next();
      const there = away.field != null && (away.task === 'plough' || away.task === 'sow' || away.task === 'weed' || away.task === 'reap') ? v.land.fields[away.field] : away.grove != null ? v.land.groves[away.grove] : null;
      if (there) {
        const trip = km(there, v.land.gate) / VILLAGE.walk;
        bearer.chores.push({ kind: 'meal', to: away.id, from: 11.5 - trip, until: 11.5 + trip + 0.5 });
      }
    }
    for (const p of home) p.chores.sort((a, b) => a.from - b.from);
  }
}

function wellSpot(v, rng) {
  return { x: v.land.well.x + rng.range(-3, 3), y: v.land.well.y + rng.range(-3, 3) };
}

// ---- the working day ----

export function stepWork(v, dt) {
  for (const f of v.land.fields) if (f.crew && f.crew.length) workField(v, f, dt);
  for (const p of v.people) {
    if (!p.alive || p.state === 'dead') continue;
    if ((p.task === 'wood' || p.task === 'stone') && p.state !== 'home') workWood(v, p, dt);
    else if ((p.task === 'build' || p.task === 'clear') && p.state !== 'home') workBuild(v, p, dt);
    else if (p.task === 'herd' && p.state !== 'home') herd(v, p, dt);
    else if (p.task === 'drill' && p.state !== 'home' && p.state !== 'returning') drillStep(v, p, dt);
    else if (p.state === 'home') chores(v, p, dt);
    else if (p.state === 'returning') goHome(v, p, dt);
  }
  for (const c of v.cartsOut || []) driveCart(v, c, dt);
  moveFlock(v, dt);
}

// At the drill ground: men paired off, stepping in and out at one another with spear and shield.
function drillStep(v, p, dt) {
  if (p.state === 'out') {
    if (moveTo(p, p.goal, VILLAGE.walk * (0.6 + 0.4 * p.health), dt)) p.state = 'working';
    return;
  }
  if (v.hour >= p.leaveAt) {
    p.state = 'returning';
    return;
  }
  const phase = v.hour * 40 + (p.id % 2) * Math.PI;
  p.pos = { x: p.goal.x + Math.sin(phase) * 1.2, y: p.goal.y + ((p.id % 2) ? 1.2 : -1.2) };
  const rate = (0.5 + 0.5 * p.health) * (0.4 + 0.6 * p.fed);
  p.skill = Math.min(0.98, (p.skill || 0.3) + DRILL.skill * rate * (1 - (p.skill || 0.3)) * dt);
  p.courage = Math.min(0.98, (p.courage || 0.5) + DRILL.courage * rate * (1 - (p.courage || 0.5)) * dt);
  p.drilled = (p.drilled || 0) + dt;
}

function goHome(v, p, dt) {
  const kmh = p.load > 0 ? VILLAGE.walkLoaded : VILLAGE.walk;
  if (moveTo(p, homeOf(v, p), kmh * (0.6 + 0.4 * p.health), dt)) {
    p.state = 'home';
    p.goal = null;
    deliver(v, p);
  }
}

// Home with what he carried.
function deliver(v, p) {
  if (!p.load) return;
  const h = v.households[p.household];
  if (p.task === 'wood') h.stores.wood += p.load;
  else if (p.task === 'reap') h.stores.grain += p.load;
  v.today[p.task] = (v.today[p.task] || 0) + p.load;
  p.load = 0;
}

export function practise(p, skill, dt) {
  p.skills[skill] = Math.min(0.98, p.skills[skill] + LIFE.skillGain * (dt / HOURS_A_DAY) * (1 - p.skills[skill]));
}

// ---- fields ----

// A crew works a field strip by strip along its length, turning at the ends: a plough furrow by
// furrow, reapers and hoers in a line abreast. How much of the field is done says where the
// working edge is, and so where everyone stands.
export function fieldFront(f, done, band) {
  const area = done * f.w * f.h;
  const strip = Math.floor(area / (band * f.h));
  const along = Math.min(f.h, (area - strip * band * f.h) / band);
  const x = f.x - f.w / 2 + Math.min(f.w - band, strip * band);
  const down = strip % 2 === 0;
  const y = down ? f.y - f.h / 2 + along : f.y + f.h / 2 - along;
  return { x, y, dir: down ? 1 : -1, band, strip, along };
}

const PROGRESS = { plough: 'ploughed', sow: 'sown', weed: 'weeded', reap: 'reaped' };

function workField(v, f, dt) {
  const crew = f.crew.map((id) => v.people[id]).filter((p) => p.alive && p.field === f.id && (p.state === 'out' || p.state === 'working'));
  // Time to go home.
  for (const p of crew) {
    if (v.hour >= p.leaveAt) {
      p.state = 'returning';
      p.goal = homeOf(v, p);
    }
  }
  const at = crew.filter((p) => p.state === 'out' || p.state === 'working');
  if (!at.length) return;
  let task = fieldTask(v, f);
  if (!task) {
    for (const p of at) {
      p.state = 'returning';
      p.goal = homeOf(v, p);
    }
    return;
  }
  for (const p of at) p.task = task;
  const ploughs = at.filter((p) => p.yoke);
  const pattern = task === 'plough' && !ploughs.length ? 'hoe' : task;
  const band = pattern === 'plough' ? SWATH.plough * ploughs.length : SWATH[pattern] * at.length;
  f.band = band;
  f.bandTask = task;
  const key = PROGRESS[task];
  const front = fieldFront(f, f[key], band);
  f.front = front;
  // The work done this step by those at the edge.
  let done = 0;
  const working = at.filter((p) => p.state === 'working');
  for (const p of working) {
    const r = workRate(v, p, task);
    const days = task === 'plough' ? (p.yoke ? FIELDS.ploughOxen : FIELDS.ploughHoe) : task === 'sow' ? FIELDS.sow : task === 'weed' ? FIELDS.weed : FIELDS.harvest;
    done += (r * dt) / (days * HOURS_A_DAY) / f.ha;
    practise(p, 'farm', dt);
    // A hired hand on another household's land earns a day wage, except at harvest.
    if (p.household !== f.owner && task !== 'reap') {
      p.hiredBy = f.owner;
      p.hiredHours = (p.hiredHours || 0) + dt * (lifeStage(v, p) === 'adult' ? 1 : 0.5);
    }
  }
  done = Math.min(done, 1 - f[key]);
  if (task === 'sow') {
    // Seed comes from the owner's store.
    const seed = done * f.ha * FIELDS.seed;
    const store = f.owner >= 0 ? v.households[f.owner].stores : v.common;
    if (store.grain < seed) {
      done = 0;
      if (!f.noSeed) logNews(v, 'alarm', `${f.owner >= 0 ? `The house of ${v.households[f.owner].name}` : 'The common granary'} has no seed left for ${f.name}.`);
      f.noSeed = true;
    } else {
      store.grain -= seed;
      f.noSeed = false;
    }
  }
  if (task === 'reap' && done > 0) {
    // The reapers carry home the threshed grain from what they cut.
    // The levy goes to the common granary; a hired reaper takes his share of what he cuts; the
    // rest is the owner's, carried to his threshing floor.
    const grain = done * f.crop;
    f.harvested += grain;
    v.common.grain += grain * v.levy;
    const net = grain * (1 - v.levy);
    const owner = f.owner >= 0 ? v.households[f.owner].stores : v.common;
    for (const p of working) {
      const part = net / working.length;
      if (p.household === f.owner) p.load += part;
      else {
        p.load += part * ECONOMY.reapShare;
        owner.grain += part * (1 - ECONOMY.reapShare);
      }
    }
  }
  f[key] += done;
  if (f[key] >= 1 - 1e-9) finishTask(v, f, task);
  // Everyone to their place at the working edge.
  const plough = pattern === 'plough';
  let i = 0;
  for (const p of at) {
    let spot;
    if (plough && p.yoke) {
      // Plough teams follow one another down the furrows.
      const j = ploughs.indexOf(p);
      spot = { x: front.x + (j + 0.5) * SWATH.plough, y: clampY(f, front.y - front.dir * j * 14) };
    } else if (plough) {
      // Men without oxen break the clods behind the ploughs.
      spot = { x: front.x - 2 - (i++ % 3) * 1.5, y: clampY(f, front.y - front.dir * (8 + 5 * i)) };
    } else {
      const k = at.indexOf(p);
      spot = { x: front.x + (k + 0.5) * (band / at.length), y: front.y };
    }
    p.facing = front.dir;
    if (p.state === 'out') {
      if (moveTo(p, spot, VILLAGE.walk, dt)) p.state = 'working';
    } else {
      p.pos.x = spot.x;
      p.pos.y = spot.y;
    }
  }
}

function clampY(f, y) {
  return Math.max(f.y - f.h / 2, Math.min(f.y + f.h / 2, y));
}

function finishTask(v, f, task) {
  f[PROGRESS[task]] = 1;
  if (task === 'sow') {
    f.state = 'sown';
    f.quality = monthOf(v) >= FIELDS.sowTo ? FIELDS.lateSow : 1;
    logNews(v, 'field', `${f.name} is sown.`);
  } else if (task === 'reap') {
    f.state = 'stubble';
    f.sown = 0;
    logNews(v, 'field', `${f.name} is reaped and threshed: ${Math.round(f.harvested)} kg of barley.`);
  }
}

// ---- woods ----

// A woodcutter fells and cuts up a stand, then drags a log home to the village woodpile and comes
// back for more. If his crew has a cart, he drags the logs only to the landing at the edge of the
// trees, and the carter takes them home a cartload at a time.
function workWood(v, p, dt) {
  const g = v.land.groves[p.grove];
  const late = v.hour >= p.leaveAt;
  const health = 0.6 + 0.4 * p.health;
  // Stone is broken out faster than wood is cut, but carried in smaller loads, on the back.
  const stone = g.material === 'stone';
  const mat = stone ? 'stone' : 'wood';
  const haul = stone ? VILLAGE.walkLoaded : VILLAGE.drag;
  if (p.sub === 'cart') {
    // The carter goes with his cart; the cart is driven in driveCart.
    const cart = v.cartsOut.find((c) => c.driver === p.id);
    if (cart) {
      p.pos.x = cart.pos.x;
      p.pos.y = cart.pos.y;
      if (cart.state === 'home') {
        p.sub = null;
        p.state = 'returning';
      }
    }
    if (p.state === 'returning') goHome(v, p, dt);
    return;
  }
  if (p.state === 'returning') {
    // Home with any log he has, by way of the woodpile.
    if (p.load > 0) {
      if (moveTo(p, woodpileOf(v, p.household), haul * health, dt)) {
        v.households[p.household].stores[mat] += p.load;
        v.today[mat] = (v.today[mat] || 0) + p.load;
        p.load = 0;
      }
    } else goHome(v, p, dt);
    return;
  }
  if (late) {
    // Anything cut but not yet dragged is left at the landing for tomorrow.
    if (p.sub === 'cut' && p.load > 0 && g.carted) {
      addToPile(g, p.household, p.load);
      p.load = 0;
    }
    p.state = 'returning';
    return;
  }
  if (p.sub === 'toStand') {
    if (p.tree < 0) {
      p.state = 'returning';
      return;
    }
    if (moveTo(p, p.stand, VILLAGE.walk * health, dt)) {
      p.sub = 'cut';
      p.state = 'working';
    }
    return;
  }
  if (p.sub === 'cut') {
    const t = v.land.trees[p.tree];
    if (!t || t.wood <= 0) {
      pickStand(v, villageRng(v), p);
      p.sub = 'toStand';
      return;
    }
    const got = Math.min((stone ? STONE.cut : WOOD.cut) * workRate(v, p, p.task) * dt, t.wood);
    if (!stone) {
      t.wood -= got;
      if (t.wood <= 1) {
        t.wood = 0;
        t.felledOn = v.day;
      }
    }
    p.load += got;
    practise(p, 'wood', dt);
    if (p.load >= (stone ? STONE.load : WOOD.log)) {
      p.sub = 'drag';
      p.state = 'out';
    }
    return;
  }
  if (p.sub === 'drag') {
    const to = g.carted ? g.landing : woodpileOf(v, p.household);
    if (moveTo(p, to, haul * health, dt)) {
      if (g.carted) addToPile(g, p.household, p.load);
      else {
        v.households[p.household].stores[mat] += p.load;
        v.today[mat] = (v.today[mat] || 0) + p.load;
      }
      p.load = 0;
      // Back for more, if there is time to cut another log and get it home before dark.
      p.sub = 'toStand';
      const t = v.land.trees[p.tree];
      if (!t || t.wood <= 0) pickStand(v, villageRng(v), p);
    }
  }
}

function addToPile(g, household, kg) {
  g.piles = g.piles || {};
  g.piles[household] = (g.piles[household] || 0) + kg;
  g.pile += kg;
}

// The ox cart: out empty to the landing, loaded with what is piled there, home to the woodpile.
function driveCart(v, c, dt) {
  const g = v.land.groves[c.grove];
  const driver = v.people[c.driver];
  const going = { pos: c.pos };
  const late = v.hour >= (driver ? driver.leaveAt : 0);
  if (c.state === 'out') {
    if (moveTo(going, g.landing, VILLAGE.cart, dt)) c.state = 'loading';
  } else if (c.state === 'loading') {
    const take = Math.min(g.pile, WOOD.cartLoad - c.load, 900 * dt);
    // Each household's wood stays its own on the cart.
    if (take > 0) {
      for (const [hid, kg] of Object.entries(g.piles)) {
        const part = take * (kg / g.pile);
        g.piles[hid] -= part;
        c.shares[hid] = (c.shares[hid] || 0) + part;
      }
      g.pile -= take;
    }
    c.load += take;
    if (c.load >= WOOD.cartLoad - 1 || (late && c.load > 0) || late) c.state = 'back';
  } else if (c.state === 'back') {
    if (moveTo(going, v.land.woodpile, VILLAGE.cart, dt)) {
      const mat = g.material === 'stone' ? 'stone' : 'wood';
      for (const [hid, kg] of Object.entries(c.shares)) v.households[hid].stores[mat] += kg;
      v.today[mat] = (v.today[mat] || 0) + c.load;
      c.shares = {};
      c.load = 0;
      c.state = late ? 'home' : 'out';
    }
  }
}

// ---- building ----

// Builders work round the house as it goes up: making mudbrick, laying stone and brick, roofing.
function workBuild(v, p, dt) {
  const x = projectOf(v, p.project);
  const health = 0.6 + 0.4 * p.health;
  if (p.state === 'returning' || !x) {
    goHome(v, p, dt);
    return;
  }
  if (v.hour >= p.leaveAt) {
    p.state = 'returning';
    return;
  }
  if (p.state === 'out') {
    if (moveTo(p, p.goal, VILLAGE.walk * health, dt)) p.state = 'working';
    return;
  }
  // Grubbing out scrub and carrying off stones as the clearing creeps across the plot.
  if (p.task === 'clear' && x.kind === 'field') {
    const w = v.land.wild[x.plot];
    const f = x.done.work / x.needs.work;
    const tx = w.x - w.w / 2 + w.w * Math.min(0.98, f + 0.02);
    p.pos.x += (tx - p.pos.x) * Math.min(1, dt * 2);
  }
  build(v, x, workRate(v, p, p.task), dt);
  practise(p, p.task === 'clear' ? 'farm' : 'build', dt);
  // Working on another household's house or land is paid.
  if (p.household !== x.sponsor) {
    p.hiredBy = x.sponsor;
    p.hiredHours = (p.hiredHours || 0) + dt * (lifeStage(v, p) === 'adult' ? 1 : 0.5);
  }
}

// ---- the flock ----

// The flock drifts across the pasture as it grazes, and the herders walk round it, keeping it
// together; at evening they bring it home to the fold.
function moveFlock(v, dt) {
  const fl = v.flock;
  const rng = villageRng(v);
  const herders = v.people.filter((p) => p.alive && p.task === 'herd' && p.state !== 'home');
  const homeTime = fl.out && herders.length && v.hour >= Math.min(...herders.map((p) => p.leaveAt));
  if (!fl.out || homeTime || !herders.some((p) => p.state === 'working')) {
    // Out to the pasture with the herders in the morning, or home to the fold.
    const target = fl.out && !homeTime && herders.length ? herders[0].pos : v.land.fold;
    const kmh = fl.out && !homeTime ? VILLAGE.walk * 0.9 : VILLAGE.walk * 0.7;
    moveTo(fl, target, kmh, dt);
    return;
  }
  const pasture = v.land.pastures[fl.pasture];
  if (!fl.graze || km(fl.pos, fl.graze) < 0.005) {
    const a = rng.range(0, Math.PI * 2);
    const r = pasture.r * Math.sqrt(rng.next()) * 0.85;
    fl.graze = { x: pasture.x + Math.cos(a) * r, y: pasture.y + Math.sin(a) * r };
  }
  moveTo(fl, fl.graze, VILLAGE.graze, dt);
}

function herd(v, p, dt) {
  const fl = v.flock;
  const health = 0.6 + 0.4 * p.health;
  if (p.state === 'out') {
    const pasture = v.land.pastures[p.pasture];
    if (moveTo(p, { x: pasture.x, y: pasture.y }, VILLAGE.walk * 0.9 * health, dt)) p.state = 'working';
    return;
  }
  if (p.state === 'working' && v.hour >= p.leaveAt) p.state = 'returning';
  if (p.state === 'returning') {
    // Bring the flock in, then go home.
    if (km(fl.pos, v.land.fold) > 0.02) {
      const ring = herdRing(v, p, fl.pos);
      moveTo(p, ring, VILLAGE.walk, dt);
    } else goHome(v, p, dt);
    return;
  }
  moveTo(p, herdRing(v, p, fl.pos), VILLAGE.walk, dt);
  practise(p, 'herd', dt);
  p.workedHerd = true;
}

// Herders spread round the flock, the ring slowly turning as they walk round it.
function herdRing(v, p, c) {
  const n = Math.max(1, v.flock.herders);
  const a = (p.herdSlot / n) * Math.PI * 2 + v.hour * 0.8;
  const r = 14 + Math.sqrt(v.flock.head) * 1.2;
  return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.7 };
}

// ---- at home ----

function chores(v, p, dt) {
  if (!p.homeAt || p.homeAt.h !== p.household) p.homeAt = { ...homeOf(v, p), h: p.household };
  const home = p.homeAt;
  const now = p.chores && p.chores.find((c) => v.hour >= c.from && v.hour < c.until);
  if (!now) {
    p.doing = null;
    if (p.pos.x !== home.x || p.pos.y !== home.y) moveTo(p, home, VILLAGE.walk * 0.8, dt);
    return;
  }
  p.doing = now.kind;
  let at = now.at;
  if (now.kind === 'meal') {
    const to = v.people[now.to];
    // Out with the meal, a while with them, then home.
    const back = v.hour > (now.from + now.until) / 2 + 0.25;
    at = !to || !to.alive || to.state === 'home' || to.state === 'returning' || back ? home : to.pos;
  }
  moveTo(p, at, VILLAGE.walk * 0.85, dt);
}
