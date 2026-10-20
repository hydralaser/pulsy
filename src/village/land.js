// The village's land, in metres, with the village at the origin. North (toward Boeotia and the
// border hills) is up, -y. The plain with the fields and the stream lies to the south and east;
// the hills to the north and west have the pasture and the woods.

import { DRILL, SMITH } from './rules.js';
import { publicSite } from './public.js';

export const BOUNDS = { x0: -2400, x1: 2400, y0: -2400, y1: 1800 };

// The stream comes down out of the hills and across the plain.
const STREAM = [{ x: -2400, y: -1300 }, { x: -1500, y: -800 }, { x: -800, y: -260 }, { x: -320, y: 260 }, { x: 260, y: 640 }, { x: 1100, y: 980 }, { x: 2400, y: 1250 }];

function nearestOnPolyline(p, line) {
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

function distToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

export function createLand(rng) {
  const land = { stream: STREAM, houses: [], fields: [], groves: [], pastures: [], trees: [] };

  // The wall: a rough ring of stone with a gate on the south side, toward the fields.
  const wall = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 72 + rng.range(-6, 6);
    wall.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.85 });
  }
  land.wall = wall;
  land.gate = { x: 0, y: 62 };
  land.well = { x: -8, y: -4 };
  land.threshing = { x: 60, y: 125, r: 11 };
  land.fold = { x: -110, y: 40 };
  land.woodpile = { x: -34, y: 92 }; // the yard outside the gate where carts unload
  land.drill = { ...DRILL.ground, name: 'the drill ground' }; // open ground where the men practise for war
  // Where the women take the washing: the nearest bank of the stream.
  const bank = nearestOnPolyline(land.gate, STREAM);
  land.washing = { x: bank.x + 6, y: bank.y - 6 };

  // The leading man's house: the big house at the head of the open middle, facing the gate.
  land.houses.push({ x: 0, y: -40, a: -Math.PI / 2, w: 24, h: 14, great: true, built: true });
  // The other houses, packed inside the wall round the open middle.
  for (let ring = 0; ring < 2; ring++) {
    const n = ring === 0 ? 13 : 7;
    const r = ring === 0 ? 46 : 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (ring ? 0.4 : 0.15);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.85;
      // Keep the way in from the gate clear, and the great house's ground.
      if (y > 30 && Math.abs(x) < 14) continue;
      if (Math.abs(x) < 22 && Math.abs(y + 40) < 16) continue;
      land.houses.push({ x, y, a, w: ring ? 11 : 13, h: ring ? 8 : 9, built: true });
    }
  }
  // Room for new houses: a few gaps left inside the wall, then plots outside it, along the road
  // and round the south side, where a house is easier to build and harder to defend.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.55;
    const x = Math.cos(a) * 34;
    const y = Math.sin(a) * 34 * 0.85;
    if (y > 24 && Math.abs(x) < 16) continue;
    if (Math.abs(x) < 22 && Math.abs(y + 40) < 18) continue;
    if (land.houses.some((o) => Math.hypot(o.x - x, o.y - y) < 13)) continue;
    land.houses.push({ x, y, a, w: 11, h: 8, built: false });
  }
  for (let i = 0; i < 14; i++) {
    const a = 0.05 * Math.PI + (i / 13) * 0.9 * Math.PI;
    const x = Math.cos(a) * 112;
    const y = Math.sin(a) * 112 * 0.85 + 6;
    // Not on the road, the threshing floor, the fold or the cart yard.
    if (Math.abs(x) < 16 || Math.hypot(x - 60, y - 125) < 24 || Math.hypot(x + 110, y - 40) < 26 || Math.hypot(x + 34, y - 92) < 18 || Math.hypot(x - DRILL.ground.x, y - DRILL.ground.y) < 30) continue;
    land.houses.push({ x, y, a, w: 11, h: 8, built: false, outside: true });
  }

  // Fields on the plain: plots of about a hectare and a half, not too close to the wall and
  // not on the stream's banks.
  const plots = [];
  for (let gx = -1700; gx <= 1800; gx += 135) {
    for (let gy = 140; gy <= 1750; gy += 125) {
      const c = { x: gx + rng.range(-12, 12), y: gy + rng.range(-12, 12) };
      const d = Math.hypot(c.x, c.y);
      if (d < 190 || d > 1750) continue;
      if (distToPolyline(c, STREAM) < 90) continue;
      plots.push({ c, d });
    }
  }
  plots.sort((a, b) => a.d - b.d);
  plots.slice(0, 56).forEach(({ c, d }, i) => {
    const w = 105 + rng.range(-12, 12);
    const h = 115 + rng.range(-12, 12);
    land.fields.push({
      id: i,
      name: `Field ${i + 1}`,
      x: c.x,
      y: c.y,
      w,
      h,
      ha: (w * h) / 10000,
      dist: d,
      // Half the fields are sown each year; the other half lie fallow.
      rotation: i % 2,
      state: 'stubble',
      ploughed: 0,
      sown: 0,
      weeded: 0,
      reaped: 0,
      crop: 0,
      quality: 1,
      ripeDays: 0,
    });
  });

  // Woods on the hills: a near copse, the big wood up toward the pass, and an oak wood east.
  const groveDefs = [
    { name: 'the near copse', x: -950, y: -280, r: 190, n: 60 },
    { name: 'the pine wood', x: 650, y: -1700, r: 340, n: 190 },
    { name: 'the oak wood', x: 1650, y: -650, r: 230, n: 90 },
  ];
  for (const g of groveDefs) {
    // The landing: where the wood is piled at the edge of the trees nearest the village, for carting.
    const d = Math.hypot(g.x, g.y);
    const landing = { x: g.x - (g.x / d) * (g.r + 15), y: g.y - (g.y / d) * (g.r + 15) * 0.8 };
    const grove = { id: land.groves.length, name: g.name, x: g.x, y: g.y, r: g.r, trees: [], landing, pile: 0 };
    for (let i = 0; i < g.n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = g.r * Math.sqrt(rng.next());
      // Each tree on the map stands for a stand of them.
      const max = rng.range(2000, 4500);
      const tree = { id: land.trees.length, grove: grove.id, x: g.x + Math.cos(a) * rr, y: g.y + Math.sin(a) * rr * 0.8, max, wood: max, felledOn: null };
      land.trees.push(tree);
      grove.trees.push(tree.id);
    }
    land.groves.push(grove);
  }

  // The quarry: a face of grey limestone on the hillside west of the village. Each face is broken
  // out without end.
  {
    const q = { x: -520, y: -420, r: 60 };
    const d = Math.hypot(q.x, q.y);
    const landing = { x: q.x - (q.x / d) * (q.r + 15), y: q.y - (q.y / d) * (q.r + 15) };
    const grove = { id: land.groves.length, name: 'the quarry', x: q.x, y: q.y, r: q.r, trees: [], landing, pile: 0, material: 'stone' };
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * (0.9 + 1.1 * (i / 7));
      const tree = { id: land.trees.length, grove: grove.id, x: q.x + Math.cos(a) * q.r * 0.7, y: q.y + Math.sin(a) * q.r * 0.5, max: 1e9, wood: 1e9, felledOn: null, stone: true };
      land.trees.push(tree);
      grove.trees.push(tree.id);
    }
    land.groves.push(grove);
  }

  // Pasture: rough grazing on the hillsides.
  land.pastures.push({ id: 0, name: 'the near hillside', x: -650, y: -700, r: 320 });
  land.pastures.push({ id: 1, name: 'the high pasture', x: -250, y: -1650, r: 420 });

  // The road south to Attica, and the track north over the hills to Boeotia.
  land.roads = [
    [{ x: 0, y: 62 }, { x: 40, y: 400 }, { x: 160, y: 1000 }, { x: 260, y: 1800 }],
    [{ x: 0, y: 62 }, { x: 70, y: 110 }, { x: 140, y: 40 }, { x: 260, y: -500 }, { x: 180, y: -1200 }, { x: 320, y: -2400 }],
  ];
  land.wild = wildPlots(land);
  // All the fields together, for households sent to work wherever there is work.
  land.farm = { id: 0, name: 'the fields', x: 120, y: 700 };
  return land;
}

// Rough ground that could be cleared for fields: beyond the old fields, off the stream's banks and
// clear of the woods and pastures. The eschatia, the Athenians called it: the land at the edge.
export function wildPlots(land) {
  const out = [];
  const clear = (c) => !land.groves.some((g) => Math.hypot(c.x - g.x, c.y - g.y) < g.r + 160)
    && !land.pastures.some((s) => Math.hypot(c.x - s.x, c.y - s.y) < s.r + 120)
    && !land.fields.some((f) => Math.abs(c.x - f.x) < f.w + 10 && Math.abs(c.y - f.y) < f.h + 10)
    && distToPolyline(c, STREAM) >= 90;
  for (let gx = -2200; gx <= 2200; gx += 135) {
    for (let gy = -900; gy <= 1650; gy += 125) {
      const c = { x: gx, y: gy };
      const d = Math.hypot(c.x, c.y);
      if (d < 700 || d > 2300 || !clear(c)) continue;
      out.push({ id: out.length, x: c.x, y: c.y, w: 105, h: 115, ha: (105 * 115) / 10000, dist: d, taken: false });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  out.forEach((w, i) => { w.id = i; });
  return out;
}

export function ensureWild(v) {
  if (!v.land.wild) v.land.wild = wildPlots(v.land);
  if (!v.land.drill) v.land.drill = { ...DRILL.ground, name: 'the drill ground' };
}

export function siteOf(v, site) {
  if (!site) return null;
  if (site.kind === 'build') {
    const x = (v.projects || []).find((o) => o.id === site.id);
    if (!x) return null;
    if (x.kind === 'field') {
      const w = v.land.wild[x.plot];
      return { id: x.id, name: x.name, x: w.x, y: w.y, w: w.w, h: w.h, r: 50 };
    }
    if (x.kind === 'forge') return { id: x.id, name: x.name, x: SMITH.site.x, y: SMITH.site.y, r: 8 };
    if (x.public) return publicSite(v, x);
    const hs = v.land.houses[x.plot];
    return { id: x.id, name: x.name, x: hs.x, y: hs.y, r: 10 };
  }
  if (site.kind === 'forge') return { id: 0, name: 'the forge', x: SMITH.site.x, y: SMITH.site.y, r: 8 };
  if (site.kind === 'farm') return v.land.farm;
  if (site.kind === 'field') return v.land.fields[site.id];
  if (site.kind === 'grove') return v.land.groves[site.id];
  if (site.kind === 'pasture') return v.land.pastures[site.id];
  if (site.kind === 'drill') return v.land.drill;
  return null;
}

export function siteName(v, site) {
  const s = siteOf(v, site);
  return s ? s.name : 'the village';
}

// Which site, if any, is at this point on the map.
export function siteAt(v, p) {
  for (const x of v.projects || []) {
    if (x.kind === 'field') {
      const w = v.land.wild[x.plot];
      if (Math.abs(p.x - w.x) < w.w / 2 && Math.abs(p.y - w.y) < w.h / 2) return { kind: 'build', id: x.id };
      continue;
    }
    const at = x.kind === 'forge' ? SMITH.site : x.public ? publicSite(v, x) : v.land.houses[x.plot];
    if (Math.hypot(p.x - at.x, p.y - at.y) < 12) return { kind: 'build', id: x.id };
  }
  if (v.smith && Math.hypot(p.x - SMITH.site.x, p.y - SMITH.site.y) < 10) return { kind: 'forge', id: 0 };
  for (const f of v.land.fields) {
    if (Math.abs(p.x - f.x) < f.w / 2 && Math.abs(p.y - f.y) < f.h / 2) return { kind: 'field', id: f.id };
  }
  for (const g of v.land.groves) if (Math.hypot(p.x - g.x, (p.y - g.y) / 0.8) < g.r + 30) return { kind: 'grove', id: g.id };
  const d = v.land.drill;
  if (d && Math.abs(p.x - d.x) < d.w / 2 + 4 && Math.abs(p.y - d.y) < d.h / 2 + 4) return { kind: 'drill', id: 0 };
  for (const s of v.land.pastures) if (Math.hypot(p.x - s.x, p.y - s.y) < s.r) return { kind: 'pasture', id: s.id };
  return null;
}
