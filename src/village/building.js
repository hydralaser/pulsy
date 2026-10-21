import { BUILD, SMITH } from './rules.js';
import { finishPublic, morePlots } from './public.js';
import { logNews } from './clock.js';
import { finishPlanting, planPlanting } from './orchard.js';

// A new house: stone footings and lower walls, mudbrick above, a timber-framed roof of tiles or
// thatch. The household it is for pays: the stone and timber come out of its own stores as the
// walls go up, and anyone sent to the site does the work. Until it is done, the man who wants it
// and his family stay crowded in with his father's or brother's household.

export function projectOf(v, id) {
  return (v.projects || []).find((x) => x.id === id) || null;
}

// The best plot for a new house: outside the wall, where there is room. When those marked out are all
// taken, more are marked out further from it.
export function freePlot(v) {
  const used = new Set([...v.households.filter((h) => h.members.some((id) => v.people[id].alive)).map((h) => h.house), ...(v.projects || []).map((x) => x.plot)]);
  const find = () => v.land.houses.map((x, i) => ({ x, i })).filter(({ x, i }) => !x.built && x.outside && !used.has(i));
  let free = find();
  if (!free.length && morePlots(v)) free = find();
  free.sort((a, b) => (a.x.outside - b.x.outside) || (Math.hypot(a.x.x, a.x.y) - Math.hypot(b.x.x, b.x.y)));
  return free.length ? free[0].i : -1;
}

export function planHouse(v, sponsor) {
  const plot = freePlot(v);
  if (plot < 0) return null;
  v.projects = v.projects || [];
  const h = v.households[sponsor];
  const x = { id: v.nextProjectId++, kind: 'house', plot, sponsor, needs: { ...BUILD.house }, done: { work: 0, stone: 0, wood: 0 }, started: v.day };
  // Named for the man it is for, if someone is waiting for it.
  const man = h.waiting >= 0 ? v.people[h.waiting] : null;
  x.name = `${man ? man.name : h.name}'s new house`;
  v.projects.push(x);
  logNews(v, 'family', `A house is marked out ${v.land.houses[plot].outside ? 'outside the wall' : 'inside the wall'} for the house of ${h.name}.`, { house: sponsor });
  return x;
}

// A forge, just outside the gate, for the man who will be the village's smith: stone and timber
// from the house's own stores, like a house, but smaller.
export function planForge(v, sponsor, man) {
  if ((v.projects || []).some((x) => x.kind === 'forge')) return null;
  v.projects = v.projects || [];
  const h = v.households[sponsor];
  const x = { id: v.nextProjectId++, kind: 'forge', plot: -1, sponsor, man, needs: { ...SMITH.forge }, done: { work: 0, stone: 0, wood: 0 }, started: v.day };
  x.name = `the forge of the house of ${h.name}`;
  v.projects.push(x);
  logNews(v, 'family', `A forge is marked out outside the gate for the house of ${h.name}.`, { house: sponsor });
  return x;
}

// A new field: the nearest stretch of rough ground nobody is clearing yet.
export function freeWild(v) {
  const used = new Set((v.projects || []).filter((x) => x.kind === 'field').map((x) => x.plot));
  const w = v.land.wild.find((o) => !o.taken && !used.has(o.id));
  return w ? w.id : -1;
}

export function planField(v, sponsor) {
  const plot = freeWild(v);
  if (plot < 0) return null;
  const w = v.land.wild[plot];
  const h = v.households[sponsor];
  const c = BUILD.field;
  const x = { id: v.nextProjectId++, kind: 'field', plot, sponsor, needs: { work: c.work * w.ha }, done: { work: 0 }, yields: { wood: c.wood * w.ha, stone: c.stone * w.ha }, started: v.day };
  x.name = `${h.name}'s new field`;
  v.projects = v.projects || [];
  v.projects.push(x);
  logNews(v, 'family', `The house of ${h.name} marks out ${w.ha.toFixed(1)} ha of rough ground ${(w.dist / 1000).toFixed(1)} km out to clear for a field.`, { house: sponsor });
  return x;
}

export function projectTask(v, x) {
  if (!x || x.done.work >= x.needs.work) return 'idle';
  return x.kind === 'field' ? 'clear' : x.kind === 'plant' ? 'plant' : 'build';
}

// An hour's building by one person: the walls go up as far as the stone and timber laid in allow.
export function build(v, x, rate, dt) {
  const h = v.households[x.sponsor];
  const work = Math.min(x.needs.work - x.done.work, (rate * dt) / 9);
  if (x.public || x.kind === 'plant') {
    // Public works, and planting vines or olives: the labour is all.
    x.done.work += work;
    if (x.done.work >= x.needs.work - 1e-6) finish(v, x);
    return work;
  }
  if (x.kind === 'field') {
    // What comes off the land as it is cleared goes to the house paying for it.
    const f = work / x.needs.work;
    h.stores.wood += x.yields.wood * f;
    h.stores.stone = (h.stores.stone || 0) + x.yields.stone * f;
    x.done.work += work;
    if (x.done.work >= x.needs.work - 1e-6) finish(v, x);
    return work;
  }
  const frac = (x.done.work + work) / x.needs.work;
  // Materials go in at the pace the work needs them.
  for (const k of ['stone', 'wood']) {
    const want = x.needs[k] * frac - x.done[k];
    if (want <= 0) continue;
    const got = Math.min(want, h.stores[k] || 0);
    h.stores[k] -= got;
    x.done[k] += got;
    if (got < want - 1e-6) {
      if (!x.short) logNews(v, 'alarm', `Work on ${x.name} stops: the house of ${h.name} has no more ${k === 'stone' ? 'stone' : 'timber'} laid in.`, { house: h.id });
      x.short = k;
      return 0;
    }
  }
  x.short = null;
  x.done.work += work;
  if (x.done.work >= x.needs.work - 1e-6) finish(v, x);
  return work;
}

function finish(v, x) {
  v.projects = v.projects.filter((o) => o !== x);
  if (x.kind === 'field') {
    const f = newField(v, x);
    // Cleared to be planted: the planting comes next, by the same hands.
    if (x.crop) {
      const next = planPlanting(v, x.sponsor, f.id, x.crop);
      if (next) carryOn(v, x, next);
    }
  } else if (x.kind === 'plant') finishPlanting(v, x);
  else if (x.public) finishPublic(v, x);
  else if (x.kind === 'forge') {
    // The village has a smith: a little iron and bronze to start with, the rest from the city.
    const man = v.people[x.man];
    const smith = man && man.alive && man.household === x.sponsor ? man : v.households[x.sponsor].members.map((id) => v.people[id]).find((p) => p.alive && p.sex === 'm' && !p.slave);
    if (smith) smith.skills.smith = Math.max(smith.skills.smith || 0, SMITH.start);
    if (v.smith && v.smith.ruined) {
      // The forge built again after the town was burned: the same smith, what stock he saved.
      v.smith.ruined = false;
      v.smith.built = v.day;
    } else v.smith = { house: x.sponsor, man: smith ? smith.id : -1, iron: 6, bronze: 2, charcoal: 0, built: v.day, done: 0, earned: 0 };
    logNews(v, 'family', `The forge outside the gate is built. ${smith ? `${smith.name} is the village's smith: tools mended, new ones made, armour repaired, without the walk to Athens.` : ''}`, { house: x.sponsor, pause: true });
  } else {
    const hs = v.land.houses[x.plot];
    hs.built = true;
    hs.builtOn = v.day;
  }
  // Anyone sent to build it is done there: a household you sent is its own again, and goes back to
  // its own work tomorrow.
  for (const h of v.households) {
    for (const half of ['m', 'f']) {
      if (!h.assign[half] || h.assign[half].kind !== 'build' || h.assign[half].id !== x.id) continue;
      h.assign[half] = null;
      if (h.ordered && h.ordered[half]) {
        h.ordered[half] = false;
        if (!h.player) logNews(v, 'council', `The ${half === 'm' ? 'men' : 'women'} of the house of ${h.name}, the work you sent them to done, go back to their own.`, { house: h.id });
      }
    }
  }
  for (const p of v.people) if (p.assign && p.assign.kind === 'build' && p.assign.id === x.id) p.assign = null;
  if (x.kind !== 'plant') logNews(v, 'family', x.kind === 'field' ? (x.crop ? `${x.name}: the ground is cleared, and the planting begins.` : `${x.name} is cleared and ready for the plough.`) : `${x.name} is finished.`, { house: x.sponsor, pause: !x.crop });
}

// Work that leads straight on to more: those who were at the one go to the next, and the house's
// plan, and its hiring, follow.
function carryOn(v, x, next) {
  next.hire = x.hire ? { ...x.hire } : undefined;
  for (const h of v.households) {
    if (h.plan && h.plan.project === x.id) h.plan.project = next.id;
    for (const half of ['m', 'f']) if (h.assign[half] && h.assign[half].kind === 'build' && h.assign[half].id === x.id) h.assign[half] = { kind: 'build', id: next.id };
  }
  for (const p of v.people) if (p.assign && p.assign.kind === 'build' && p.assign.id === x.id) p.assign = { kind: 'build', id: next.id };
}

// The cleared ground joins the fields, in whichever year of the rotation the house has less land.
function newField(v, x) {
  const w = v.land.wild[x.plot];
  w.taken = true;
  const own = v.land.fields.filter((f) => f.owner === x.sponsor);
  const r0 = own.filter((f) => f.rotation === 0).reduce((a, f) => a + f.ha, 0);
  const r1 = own.filter((f) => f.rotation === 1).reduce((a, f) => a + f.ha, 0);
  const id = v.land.fields.length;
  v.land.fields.push({
    id, name: `Field ${id + 1}`, x: w.x, y: w.y, w: w.w, h: w.h, ha: w.ha, dist: w.dist,
    rotation: r0 <= r1 ? 0 : 1, state: 'stubble', ploughed: 0, sown: 0, weeded: 0, reaped: 0, crop: 0, quality: 1, ripeDays: 0,
    owner: x.sponsor, soil: BUILD.field.soil, cleared: v.day,
    // A share of each harvest as rent, if leave to clear it was given for one (see grant in council.js).
    rent: x.rent && (x.rent.share > 0 || x.rent.kg > 0) ? { ...x.rent } : null,
  });
  return v.land.fields[id];
}
