// The village's land, in metres, with the village at the origin. North (toward Boeotia and the
// border hills) is up, -y. The plain with the fields and the stream lies to the south and east;
// the hills to the north and west have the pasture and the woods.

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
  // Where the women take the washing: the nearest bank of the stream.
  const bank = nearestOnPolyline(land.gate, STREAM);
  land.washing = { x: bank.x + 6, y: bank.y - 6 };

  // The leading man's house: the big house at the head of the open middle, facing the gate.
  land.houses.push({ x: 0, y: -40, a: -Math.PI / 2, w: 24, h: 14, great: true });
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
      land.houses.push({ x, y, a, w: ring ? 11 : 13, h: ring ? 8 : 9 });
    }
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

  // Pasture: rough grazing on the hillsides.
  land.pastures.push({ id: 0, name: 'the near hillside', x: -650, y: -700, r: 320 });
  land.pastures.push({ id: 1, name: 'the high pasture', x: -250, y: -1650, r: 420 });

  // The road south to Attica, and the track north over the hills to Boeotia.
  land.roads = [
    [{ x: 0, y: 62 }, { x: 40, y: 400 }, { x: 160, y: 1000 }, { x: 260, y: 1800 }],
    [{ x: 0, y: 62 }, { x: 70, y: 110 }, { x: 140, y: 40 }, { x: 260, y: -500 }, { x: 180, y: -1200 }, { x: 320, y: -2400 }],
  ];
  // All the fields together, for households sent to work wherever there is work.
  land.farm = { id: 0, name: 'the fields', x: 120, y: 700 };
  return land;
}

export function siteOf(v, site) {
  if (!site) return null;
  if (site.kind === 'farm') return v.land.farm;
  if (site.kind === 'field') return v.land.fields[site.id];
  if (site.kind === 'grove') return v.land.groves[site.id];
  if (site.kind === 'pasture') return v.land.pastures[site.id];
  return null;
}

export function siteName(v, site) {
  const s = siteOf(v, site);
  return s ? s.name : 'the village';
}

// Which site, if any, is at this point on the map.
export function siteAt(v, p) {
  for (const f of v.land.fields) {
    if (Math.abs(p.x - f.x) < f.w / 2 && Math.abs(p.y - f.y) < f.h / 2) return { kind: 'field', id: f.id };
  }
  for (const g of v.land.groves) if (Math.hypot(p.x - g.x, (p.y - g.y) / 0.8) < g.r + 30) return { kind: 'grove', id: g.id };
  for (const s of v.land.pastures) if (Math.hypot(p.x - s.x, p.y - s.y) < s.r) return { kind: 'pasture', id: s.id };
  return null;
}
