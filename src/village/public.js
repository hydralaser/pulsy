import { PUBLIC, SMITH } from './rules.js';
import { clamp } from '../sim/core.js';
import { logNews } from './clock.js';
import { aliveHouseholds } from './economy.js';

// Public works, raised for the whole village and paid for out of the common granary: a watchtower
// on the border hills toward Boeotia, and a curtain wall drawn round the houses as they now stand.

// ---- the wall ----

// The wall as distance from the middle of the village by bearing: the village is a little wider
// than it is deep, so bearings are measured on that squashed circle.
const SQUASH = 0.85;
const polar = (p) => ({ a: Math.atan2(p.y / SQUASH, p.x), r: Math.hypot(p.x, p.y / SQUASH) });
const at = (a, r) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r * SQUASH });

function wallRadius(wall, a) {
  // Where the wall crosses this bearing, between its two nearest points.
  const pts = wall.map(polar).sort((p, q) => p.a - q.a);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    let span = q.a - p.a;
    if (span <= 0) span += Math.PI * 2;
    let d = a - p.a;
    while (d < 0) d += Math.PI * 2;
    if (d <= span) return p.r + (q.r - p.r) * (d / span);
  }
  return pts[0].r;
}

export function insideWall(v, p) {
  const { a, r } = polar(p);
  return r < wallRadius(v.land.wall, a);
}

// A curtain wall round every house there is now, and every house being built, with room to walk
// round them; never inside the old wall.
export function curtainWall(v) {
  const houses = v.land.houses.filter((hs, i) => hs.built || (v.projects || []).some((x) => x.kind === 'house' && x.plot === i));
  const n = PUBLIC.wall.points;
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI;
    let r = wallRadius(v.land.wall, a);
    for (const hs of houses) {
      const p = polar(hs);
      let d = Math.abs(p.a - a);
      if (d > Math.PI) d = Math.PI * 2 - d;
      // A house near this bearing pushes the wall out past it.
      if (d < PUBLIC.wall.reach) r = Math.max(r, p.r + PUBLIC.wall.margin);
    }
    ring.push(r);
  }
  // Smoothed, so it runs as a wall would rather than in and out round each house.
  const smooth = ring.map((r, i) => Math.max(r, (ring[(i + n - 1) % n] + r + ring[(i + 1) % n]) / 3));
  return smooth.map((r, i) => at((i / n) * Math.PI * 2 - Math.PI, r));
}

export function wallLength(ring) {
  let len = 0;
  for (let i = 0; i < ring.length; i++) len += Math.hypot(ring[(i + 1) % ring.length].x - ring[i].x, ring[(i + 1) % ring.length].y - ring[i].y);
  return len;
}

// Whether a new wall would take in anything the old one does not.
export function wallWanted(v) {
  return v.land.houses.some((hs, i) => (hs.built || (v.projects || []).some((x) => x.kind === 'house' && x.plot === i)) && !insideWall(v, hs));
}

// ---- starting the works ----

export function planWall(v, sponsor) {
  if ((v.projects || []).some((x) => x.kind === 'wall') || !wallWanted(v)) return null;
  const ring = curtainWall(v);
  const len = wallLength(ring);
  const x = { id: v.nextProjectId++, kind: 'wall', public: true, plot: -1, sponsor, ring, needs: { work: Math.round(len * PUBLIC.wall.perMetre) }, done: { work: 0 }, started: v.day, name: 'the new curtain wall' };
  x.hire = { on: true, cap: PUBLIC.cap, from: 'common' };
  v.projects.push(x);
  logNews(v, 'council', `The line of a new curtain wall is marked out round the village, ${Math.round(len)} m of it, taking in every house: about ${x.needs.work} days' work, quarrying the stone and laying it.`, { pause: true });
  return x;
}

export function planTower(v, sponsor) {
  if (v.tower || (v.projects || []).some((x) => x.kind === 'tower')) return null;
  const x = { id: v.nextProjectId++, kind: 'tower', public: true, plot: -1, sponsor, needs: { work: PUBLIC.tower.work }, done: { work: 0 }, started: v.day, name: 'the watchtower' };
  x.hire = { on: true, cap: PUBLIC.cap, from: 'common' };
  v.projects.push(x);
  logNews(v, 'council', `A watchtower is marked out on the hill toward Boeotia: about ${x.needs.work} days' work.`, { pause: true });
  return x;
}

// Where the work is, for the men sent to it.
export function publicSite(v, x) {
  if (x.kind === 'tower') return { id: x.id, name: x.name, x: PUBLIC.tower.site.x, y: PUBLIC.tower.site.y, r: 10 };
  // The wall: the stretch being built now, round from the gate.
  const f = x.done.work / x.needs.work;
  const i = Math.floor(f * x.ring.length) % x.ring.length;
  const p = x.ring[(i + Math.floor(x.ring.length / 4)) % x.ring.length];
  return { id: x.id, name: x.name, x: p.x, y: p.y, w: 30, h: 20, r: 20 };
}

export function finishPublic(v, x) {
  if (x.kind === 'tower') {
    v.tower = { built: v.day };
    logNews(v, 'council', 'The watchtower on the hill toward Boeotia is built.', { pause: true });
  } else if (x.kind === 'wall') {
    v.land.wall = x.ring;
    // The gate stays on the south side, toward the fields.
    const south = x.ring.reduce((a, p) => (Math.abs(p.x) < Math.abs(a.x) + 30 && p.y > a.y ? p : a), x.ring[0]);
    v.land.gate = { x: 0, y: Math.round(south.y) };
    for (const hs of v.land.houses) hs.outside = !insideWall(v, hs);
    logNews(v, 'council', 'The new curtain wall is finished: every house in the village stands inside it.', { pause: true });
  }
  for (const h of aliveHouseholds(v)) if (!h.player) h.goodwill = clamp((h.goodwill ?? 0.6) + PUBLIC.pride, 0, 1);
}

// ---- plots for new houses ----

// New houses are built outside the wall. When the plots marked out there are taken, more are marked
// out further from it, clear of the fields, the road and everything else on the ground.
export function morePlots(v) {
  const L = v.land;
  const clear = (x, y) => {
    if (Math.abs(x) < 16 && y > 0) return false; // the road to the gate
    if (L.houses.some((o) => Math.hypot(o.x - x, o.y - y) < 16)) return false;
    if (L.fields.some((f) => Math.abs(f.x - x) < f.w / 2 + 10 && Math.abs(f.y - y) < f.h / 2 + 10)) return false;
    if ((L.wild || []).some((w) => Math.abs(w.x - x) < w.w / 2 + 10 && Math.abs(w.y - y) < w.h / 2 + 10)) return false;
    for (const s of [L.threshing, L.fold, L.woodpile, L.drill, SMITH.site, PUBLIC.tower.site]) if (s && Math.hypot(s.x - x, s.y - y) < 26) return false;
    return !insideWall(v, { x, y });
  };
  let added = 0;
  for (let ring = 0; ring < 6 && added < 6; ring++) {
    for (let i = 0; i < 24 && added < 6; i++) {
      const a = (i / 24) * Math.PI * 2 + ring * 0.13;
      const r = wallRadius(L.wall, a) + 28 + ring * 22;
      const p = at(a, r);
      if (!clear(p.x, p.y)) continue;
      L.houses.push({ x: p.x, y: p.y, a, w: 11, h: 8, built: false, outside: true });
      added++;
    }
  }
  return added;
}
