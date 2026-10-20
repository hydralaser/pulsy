import { BUILD } from './rules.js';
import { logNews } from './clock.js';

// A new house: stone footings and lower walls, mudbrick above, a timber-framed roof of tiles or
// thatch. The household it is for pays: the stone and timber come out of its own stores as the
// walls go up, and anyone sent to the site does the work. Until it is done, the man who wants it
// and his family stay crowded in with his father's or brother's household.

export function projectOf(v, id) {
  return (v.projects || []).find((x) => x.id === id) || null;
}

// The best plot for a new house: inside the wall while there is room, then outside it.
export function freePlot(v) {
  const used = new Set([...v.households.filter((h) => h.members.some((id) => v.people[id].alive)).map((h) => h.house), ...(v.projects || []).map((x) => x.plot)]);
  const free = v.land.houses.map((x, i) => ({ x, i })).filter(({ x, i }) => !x.built && !used.has(i));
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

export function siteOfProject(v, x) {
  const hs = v.land.houses[x.plot];
  return { id: x.id, name: x.name, x: hs.x, y: hs.y, r: 10 };
}

export function projectTask(v, x) {
  return x && x.done.work < x.needs.work ? 'build' : 'idle';
}

// An hour's building by one person: the walls go up as far as the stone and timber laid in allow.
export function build(v, x, rate, dt) {
  const h = v.households[x.sponsor];
  const work = Math.min(x.needs.work - x.done.work, (rate * dt) / 9);
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
  const hs = v.land.houses[x.plot];
  hs.built = true;
  hs.builtOn = v.day;
  v.projects = v.projects.filter((o) => o !== x);
  // Anyone sent to build it goes home.
  for (const h of v.households) for (const half of ['m', 'f']) if (h.assign[half] && h.assign[half].kind === 'build' && h.assign[half].id === x.id) h.assign[half] = null;
  logNews(v, 'family', `${x.name} is finished.`, { house: x.sponsor, pause: true });
}
