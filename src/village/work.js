import { VILLAGE, FIELDS, WOOD, LIFE } from './rules.js';
import { siteOf } from './land.js';
import { lifeStage, villageRng } from './people.js';
import { monthOf, duskOf, logNews } from './clock.js';

const HOURS_A_DAY = 9; // a man-day of work

// Work is given to households, not to people: each household's men and its women are sent
// somewhere as a body, and every one of them old enough to work goes. Households sent to the same
// place work there together. Nothing is closed to either sex; how well someone does a job comes
// from their strength, for the heavy work, and their skill, which grows with practice.
export const TASKS = {
  plough: { text: 'ploughing', skill: 'farm', strength: 0.8 },
  sow: { text: 'sowing', skill: 'farm', strength: 0.1 },
  weed: { text: 'hoeing the weeds', skill: 'farm', strength: 0.3 },
  reap: { text: 'reaping and threshing', skill: 'farm', strength: 0.5 },
  wood: { text: 'felling and carrying timber', skill: 'wood', strength: 0.8 },
  farm: { text: 'in the fields', skill: 'farm', strength: 0.5 },
  herd: { text: 'out with the flock', skill: 'herd', strength: 0.2 },
  house: { text: 'working at home', skill: 'house', strength: 0.2 },
  idle: { text: 'nothing to do there now', skill: null, strength: 0 },
};

export const HALVES = { m: 'men', f: 'women' };

// Send one half of a household somewhere; null sends them home.
export function assign(v, h, half, site) {
  h.assign[half] = site ? { kind: site.kind, id: site.id } : null;
}

export function sameSite(a, b) {
  return a && b && a.kind === b.kind && a.id === b.id;
}

// The halves of households sent to a site.
export function crewAt(v, site) {
  const out = [];
  for (const h of v.households) for (const half of ['m', 'f']) if (sameSite(h.assign[half], site)) out.push({ h, half });
  return out;
}

// Every place anyone has been sent, with who is there.
export function crews(v) {
  const seen = new Map();
  for (const h of v.households) {
    for (const half of ['m', 'f']) {
      const s = h.assign[half];
      if (!s) continue;
      const key = `${s.kind}:${s.id}`;
      if (!seen.has(key)) seen.set(key, { site: s, halves: [] });
      seen.get(key).halves.push({ h, half });
    }
  }
  return [...seen.values()];
}

export function siteOfPerson(v, p) {
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
  if (site.kind === 'grove') return s.trees.some((t) => v.land.trees[t].wood > 50) ? 'wood' : 'idle';
  if (site.kind === 'pasture') return 'herd';
  return 'idle';
}

// Where someone is at home: by their house, each in their own spot so they do not all stand on
// one point.
export function homeOf(v, p) {
  const hs = v.land.houses[v.households[p.household].house] || { x: 0, y: 0 };
  return { x: hs.x + ((p.id * 37) % 9) - 4, y: hs.y + ((p.id * 53) % 9) - 4 };
}

// Whether someone is of an age to work, and how much they can do: children help from seven, the
// old do what they can.
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

// Dawn: everyone with work away from home sets out for it.
export function morning(v) {
  const rng = villageRng(v);
  v.yokesFree = v.oxen;
  v.handsOn = {};
  const gangs = new Map();
  for (const p of v.people) {
    if (!p.alive) continue;
    p.workedToday = 0;
    p.load = 0;
    p.task = 'house';
    p.state = 'home';
    p.goal = null;
    if (!canWork(v, p)) {
      p.task = null;
      continue;
    }
    const site = siteOfPerson(v, p);
    const task = siteTask(v, site);
    if (!site || task === 'idle') {
      p.task = 'house';
      continue;
    }
    let s = siteOf(v, site);
    let spot;
    let today = task;
    // Sent to the fields in general: to whichever field most needs hands today.
    // A household's men, or its women, work a field together.
    if (site.kind === 'farm') {
      const key = `${p.household}${p.sex}`;
      if (!gangs.has(key)) gangs.set(key, pickField(v));
      s = gangs.get(key);
      today = fieldTask(v, s);
    }
    if (site.kind === 'field' || site.kind === 'farm') {
      spot = { x: s.x + rng.range(-0.4, 0.4) * s.w, y: s.y + rng.range(-0.4, 0.4) * s.h };
      p.field = s.id;
      v.handsOn[s.id] = (v.handsOn[s.id] || 0) + 1;
    }
    else if (site.kind === 'grove') {
      const standing = s.trees.map((t) => v.land.trees[t]).filter((t) => t.wood > 50);
      const t = rng.pick(standing);
      spot = { x: t.x + rng.range(-4, 4), y: t.y + rng.range(-4, 4) };
      p.tree = t.id;
    } else spot = { x: s.x + rng.range(-0.3, 0.3) * s.r, y: s.y + rng.range(-0.3, 0.3) * s.r };
    p.state = 'out';
    p.goal = spot;
    p.task = today;
    // A ploughman takes a yoke of oxen if there is one free.
    p.yoke = task === 'plough' && v.yokesFree > 0 ? (v.yokesFree--, true) : false;
    // Everyone has to be home by dark.
    const km = Math.hypot(spot.x, spot.y) / 1000;
    p.leaveAt = duskOf(v) - km / VILLAGE.walkLoaded;
  }
  // The flock goes out with its herders, if it has any.
  const herders = v.people.filter((p) => p.alive && p.state === 'out' && p.task === 'herd');
  v.flock.herders = herders.length;
  v.flock.out = herders.length > 0;
  if (v.flock.out) v.flock.goal = { ...herders[0].goal };
}

// The field with work to do that has fewest hands on it for its size, the nearer the better.
function pickField(v) {
  let best = null;
  let bestScore = Infinity;
  for (const f of v.land.fields) {
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

// One step of the working day.
export function stepWork(v, dt) {
  for (const p of v.people) {
    if (!p.alive) continue;
    if ((p.state === 'out' || p.state === 'working') && v.hour >= p.leaveAt) {
      p.state = 'returning';
      p.goal = homeOf(v, p);
    }
    if (p.goal) {
      const speed = (p.state === 'returning' && p.load > 0 ? VILLAGE.walkLoaded : VILLAGE.walk) * 1000 * (0.6 + 0.4 * p.health);
      const dx = p.goal.x - p.pos.x;
      const dy = p.goal.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      const step = speed * dt;
      if (d <= step) {
        p.pos.x = p.goal.x;
        p.pos.y = p.goal.y;
        if (p.state === 'out') p.state = 'working';
        else if (p.state === 'returning') {
          p.state = 'home';
          p.goal = null;
          deliver(v, p);
        }
      } else {
        p.pos.x += (dx / d) * step;
        p.pos.y += (dy / d) * step;
      }
    }
    if (p.state === 'working') work(v, p, dt);
  }
  // The flock follows its herders, and is folded at night.
  const f = v.flock;
  const target = f.out && v.hour < duskOf(v) - 0.6 ? f.goal : v.land.fold;
  const dx = target.x - f.pos.x;
  const dy = target.y - f.pos.y;
  const d = Math.hypot(dx, dy);
  const step = 2.5 * 1000 * dt;
  if (d > step) {
    f.pos.x += (dx / d) * step;
    f.pos.y += (dy / d) * step;
  }
}

// Work at the site, by what it needs.
function work(v, p, dt) {
  const site = siteOfPerson(v, p);
  if (!site) return;
  p.workedToday += dt;
  const r = workRate(v, p, p.task);
  if (p.task === 'wood') {
    // Cutting and carrying it home: the further the wood, the more of the day goes in walking.
    const km = Math.hypot(p.pos.x, p.pos.y) / 1000;
    const trip = km / VILLAGE.walkLoaded + km / VILLAGE.walk;
    const perHour = 1 / (1 / (WOOD.cut * r) + trip / WOOD.load);
    const t = v.land.trees[p.tree];
    if (!t || t.wood <= 0) return;
    const got = Math.min(perHour * dt, t.wood);
    t.wood -= got;
    if (t.wood <= 1) {
      t.wood = 0;
      t.felledOn = v.day;
    }
    p.load += got;
    practise(p, 'wood', dt);
    return;
  }
  if (p.task === 'herd') {
    practise(p, 'herd', dt);
    return;
  }
  const f = v.land.fields[p.field];
  if (!f) return;
  const ha = (days) => (r * dt) / (days * HOURS_A_DAY) / f.ha;
  if (p.task === 'plough') {
    if (f.ploughed < 1) f.ploughed = Math.min(1, f.ploughed + ha(p.yoke ? FIELDS.ploughOxen : FIELDS.ploughHoe));
    else p.task = 'sow';
  } else if (p.task === 'sow') {
    if (f.sown < 1 && f.ploughed >= 1) {
      const add = Math.min(1 - f.sown, ha(FIELDS.sow));
      const seed = add * f.ha * FIELDS.seed;
      if (v.stores.grain < seed) return;
      v.stores.grain -= seed;
      f.sown += add;
      if (f.sown >= 1) {
        f.state = 'sown';
        f.quality = monthOf(v) >= FIELDS.sowTo ? FIELDS.lateSow : 1;
        logNews(v, 'field', `${f.name} is sown.`);
      }
    }
  } else if (p.task === 'weed') {
    f.weeded = Math.min(1, f.weeded + ha(FIELDS.weed));
  } else if (p.task === 'reap') {
    if (f.reaped < 1 && f.state === 'ripe') {
      const add = Math.min(1 - f.reaped, ha(FIELDS.harvest));
      f.reaped += add;
      p.load += add * f.crop;
      f.harvested += add * f.crop;
      if (f.reaped >= 1) {
        f.state = 'stubble';
        f.sown = 0;
        logNews(v, 'field', `${f.name} is reaped and threshed: ${Math.round(f.harvested)} kg of barley.`);
      }
    }
  }
  practise(p, 'farm', dt);
}

export function practise(p, skill, dt) {
  p.skills[skill] = Math.min(0.98, p.skills[skill] + LIFE.skillGain * (dt / HOURS_A_DAY) * (1 - p.skills[skill]));
}

// Home with what he carried.
function deliver(v, p) {
  if (!p.load) return;
  if (p.task === 'wood') v.stores.wood += p.load;
  else if (p.task === 'reap') v.stores.grain += p.load;
  v.today[p.task] = (v.today[p.task] || 0) + p.load;
  p.load = 0;
}
