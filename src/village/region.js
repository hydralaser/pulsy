import { CITY } from './rules.js';
import { monthOf, dawnOf, duskOf } from './clock.js';
import { demeOf, peopleOfDeme } from './neighbours.js';

// The country round Oinoe: Attica to the south and east, Boeotia over Kithairon to the north. The
// demes, the Boeotian towns and Athens stand where they stood, in metres from Oinoe's gate (east
// is +x, south is +y), and are joined by the roads between them. Men going to Athens, the army on
// the march, a dealer's carts and travellers move along them. Oinoe alone is lived in fully; the
// others are drawn, when you look at them, from what their lighter lives say of them: so many
// houses for their people, fields green or burned as their year has gone, their flocks, and their
// people going out to the fields and coming home.

const KM = 1000;
// Positions from the sites' latitude and longitude, near enough.
export const REGION = {
  Oinoe: { x: 0, y: 0, kind: 'home' },
  Athens: { x: 26.3, y: 22.2, kind: 'city' },
  Piraeus: { x: 18.4, y: 25.6, kind: 'port' },
  Eleusis: { x: 9.6, y: 14.4, kind: 'deme' },
  Thria: { x: 13.2, y: 12.2, kind: 'deme' },
  Acharnai: { x: 26.3, y: 10.0, kind: 'deme' },
  Phyle: { x: 20.2, y: 2.2, kind: 'deme' },
  Dekeleia: { x: 30.7, y: 0.0, kind: 'deme' },
  Aphidna: { x: 36.0, y: -3.3, kind: 'deme' },
  Panakton: { x: 3.5, y: -3.3, kind: 'deme' },
  Eleutherai: { x: -4.4, y: -1.1, kind: 'deme' },
  Plataia: { x: -14.0, y: -4.4, kind: 'town', people: 'Plataians' },
  Thebes: { x: -9.6, y: -16.7, kind: 'town', people: 'Thebans' },
  Tanagra: { x: 8.8, y: -17.8, kind: 'town', people: 'Tanagrans' },
  Thespiai: { x: -24.6, y: -14.4, kind: 'town', people: 'Thespians' },
  Haliartos: { x: -30.7, y: -23.3, kind: 'town', people: 'Haliartians' },
  Koroneia: { x: -40.3, y: -25.5, kind: 'town', people: 'Koroneians' },
  // Places a battle may be fought, with no village of their own.
  Skourta: { x: 10.0, y: -8.0, kind: 'place' },
  'the Kithairon pass': { x: -6.0, y: -5.5, kind: 'place' },
  Drymos: { x: 5.0, y: -6.0, kind: 'place' },
  'the Asopos': { x: -5.0, y: -10.0, kind: 'place' },
  Hysiai: { x: -12.0, y: -6.5, kind: 'place' },
  Erythrai: { x: -9.0, y: -7.5, kind: 'place' },
  'the Dryoskephalai road': { x: -7.5, y: -4.5, kind: 'place' },
};
for (const p of Object.values(REGION)) {
  p.x *= KM;
  p.y *= KM;
}

// The roads: the Sacred Way from Athens to Eleusis, the road over Kithairon by Oinoe and Eleutherai
// to Plataia and Thebes, the road by Phyle and Panakton, the road north by Dekeleia, and the roads
// of Boeotia.
const ROADS = [
  ['Athens', 'Piraeus'], ['Athens', 'Eleusis'], ['Eleusis', 'Thria'], ['Thria', 'Acharnai'], ['Athens', 'Acharnai'],
  ['Eleusis', 'Oinoe'], ['Oinoe', 'Eleutherai'], ['Eleutherai', 'the Dryoskephalai road'], ['the Dryoskephalai road', 'the Kithairon pass'],
  ['the Kithairon pass', 'Erythrai'], ['Erythrai', 'Hysiai'], ['Hysiai', 'Plataia'], ['Erythrai', 'the Asopos'], ['the Asopos', 'Thebes'],
  ['Acharnai', 'Phyle'], ['Phyle', 'Panakton'], ['Panakton', 'Oinoe'], ['Panakton', 'Drymos'], ['Drymos', 'Skourta'], ['Skourta', 'Tanagra'],
  ['Acharnai', 'Dekeleia'], ['Dekeleia', 'Aphidna'], ['Dekeleia', 'Tanagra'], ['Tanagra', 'Thebes'],
  ['Plataia', 'Thespiai'], ['Thebes', 'Thespiai'], ['Thespiai', 'Haliartos'], ['Thebes', 'Haliartos'], ['Haliartos', 'Koroneia'],
];

// The coast of the Saronic gulf, and the mountains.
const COAST = [{ x: -20, y: 21 }, { x: -6, y: 18 }, { x: 4, y: 17 }, { x: 9.6, y: 15.8 }, { x: 14, y: 18 }, { x: 17, y: 24 }, { x: 18.4, y: 26.6 }, { x: 22, y: 27.5 }, { x: 28, y: 30 }, { x: 40, y: 34 }].map((p) => ({ x: p.x * KM, y: p.y * KM }));
const MOUNTAINS = [
  { name: 'Kithairon', x: -12, y: -7, rx: 13, ry: 3.5 },
  { name: 'Parnes', x: 20, y: -1, rx: 10, ry: 5 },
  { name: 'Pentelikon', x: 38, y: 10, rx: 4, ry: 4 },
  { name: 'Aigaleos', x: 18, y: 16, rx: 2, ry: 5 },
  { name: 'Helikon', x: -38, y: -18, rx: 6, ry: 4 },
].map((m) => ({ ...m, x: m.x * KM, y: m.y * KM, rx: m.rx * KM, ry: m.ry * KM }));

// A small, steady hash: the same place and number always give the same answer.
function hash(s, n = 0) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A road between two places, bending a little as roads do.
const roadCache = new Map();
function roadLine(a, b) {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (!roadCache.has(key)) {
    const A = REGION[a < b ? a : b];
    const B = REGION[a < b ? b : a];
    const pts = [A];
    const n = 6;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const bend = Math.sin(t * Math.PI) * (hash(key, 1) - 0.5) * len * 0.12 + (hash(key, i + 2) - 0.5) * len * 0.03;
      pts.push({ x: A.x + dx * t - (dy / len) * bend, y: A.y + dy * t + (dx / len) * bend });
    }
    pts.push(B);
    roadCache.set(key, pts);
  }
  const pts = roadCache.get(key);
  return a < b ? pts : [...pts].reverse();
}

// The way from one place to another along the roads: the shortest, by Dijkstra.
const routeCache = new Map();
export function route(from, to) {
  const key = `${from}>${to}`;
  if (routeCache.has(key)) return routeCache.get(key);
  if (!REGION[from] || !REGION[to]) return null;
  const dist = { [from]: 0 };
  const prev = {};
  const todo = new Set(Object.keys(REGION));
  while (todo.size) {
    let u = null;
    for (const n of todo) if (dist[n] != null && (u == null || dist[n] < dist[u])) u = n;
    if (u == null || u === to) break;
    todo.delete(u);
    for (const [a, b] of ROADS) {
      const w = a === u ? b : b === u ? a : null;
      if (!w || !todo.has(w)) continue;
      const d = dist[u] + Math.hypot(REGION[a].x - REGION[b].x, REGION[a].y - REGION[b].y);
      if (dist[w] == null || d < dist[w]) {
        dist[w] = d;
        prev[w] = u;
      }
    }
  }
  if (dist[to] == null) return null;
  const names = [to];
  while (names[0] !== from) names.unshift(prev[names[0]]);
  const pts = [];
  for (let i = 1; i < names.length; i++) {
    const seg = roadLine(names[i - 1], names[i]);
    pts.push(...(i === 1 ? seg : seg.slice(1)));
  }
  // Along the way: how far each point is from the start.
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const r = { pts, at, len: at[at.length - 1] };
  routeCache.set(key, r);
  return r;
}

// The point a share of the way along a route.
export function along(r, f) {
  const d = Math.max(0, Math.min(1, f)) * r.len;
  let i = 1;
  while (i < r.at.length - 1 && r.at[i] < d) i++;
  const a = r.pts[i - 1];
  const b = r.pts[i];
  const t = (d - r.at[i - 1]) / Math.max(1e-6, r.at[i] - r.at[i - 1]);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, dy: b.y - a.y };
}

// Where a battle's place is: a deme, a town (or its people), or a place on the road.
export function placeOf(name) {
  if (REGION[name]) return name;
  const town = Object.keys(REGION).find((k) => REGION[k].people === name);
  return town || 'the Kithairon pass';
}

// ---- who is on the roads ----

export function travellers(v) {
  const out = [];
  const t = v.day + v.hour / 24;
  // Men of Oinoe gone to Athens to buy and sell: there, a day in the city, and back.
  for (const tr of v.trips || []) {
    const r = route('Oinoe', 'Athens');
    const f = (t - tr.left) / Math.max(1, tr.back - tr.left);
    const share = f < 0.4 ? f / 0.4 : f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4;
    const p = along(r, share);
    const h = v.households[tr.house];
    out.push({ ...p, n: tr.men.length, cart: !!tr.cart, kind: 'trip', label: `${h ? (h.player ? 'Your house' : `House of ${h.name}`) : 'Men of Oinoe'}, ${f < 0.4 ? 'to Athens' : f < 0.6 ? 'in Athens' : 'home from Athens'}` });
  }
  // The army on the march, and coming home.
  const c = v.war && v.war.campaign;
  if (c) {
    const r = route('Oinoe', placeOf(c.place));
    if (r) {
      let f = 1;
      if (c.stage === 'marching') f = (t - c.leftDay) / Math.max(1, c.battleDay - c.leftDay);
      else if (c.stage === 'home') f = 1 - (t - (c.homeDay - CITY.days)) / CITY.days;
      const p = along(r, Math.max(0, Math.min(1, f)));
      out.push({ ...p, n: Math.max(8, (c.men || []).length * 4), army: true, kind: 'army', label: c.stage === 'battle' ? `The army, drawn up at ${c.place}` : c.stage === 'home' ? 'The army, coming home' : `The army, marching to ${c.place}` });
    }
  }
  // The dealer from Athens with his carts, after the vintage and the pressing.
  const m = monthOf(v);
  const dom = v.day % 30 + v.hour / 24;
  if ((m === 0 || m === 3) && dom > 12 && dom < 18) {
    const r = route('Athens', 'Oinoe');
    const share = dom < 15 ? (dom - 12) / 3 : 1 - (dom - 15) / 3;
    out.push({ ...along(r, share), n: 2, cart: true, kind: 'dealer', label: 'A dealer from Athens, with his carts' });
  }
  // Travellers on every road, in daylight: carters, herdsmen, men going to market.
  if (v.hour > dawnOf(v) && v.hour < duskOf(v)) {
    ROADS.forEach(([a, b], i) => {
      for (let k = 0; k < 2; k++) {
        const seed = hash(`${a}${b}`, k);
        const phase = (t * (0.5 + seed) + seed * 7) % 2;
        const share = phase < 1 ? phase : 2 - phase;
        const line = roadLine(a, b);
        const at = [0];
        for (let j = 1; j < line.length; j++) at.push(at[j - 1] + Math.hypot(line[j].x - line[j - 1].x, line[j].y - line[j - 1].y));
        const p = along({ pts: line, at, len: at[at.length - 1] }, share);
        out.push({ ...p, n: 1 + Math.floor(seed * 3), cart: seed > 0.7, kind: 'traveller', label: null });
      }
    });
  }
  return out;
}

// ---- a deme as it looks: drawn from its light life, the same each time you look ----

const layoutCache = new Map();
function layoutOf(name, people, fieldsWanted) {
  const key = `${name}:${people}:${fieldsWanted}`;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const P = REGION[name];
  const nh = Math.max(4, Math.ceil(people / 6));
  const houses = [];
  for (let i = 0; i < nh; i++) {
    const a = i * 2.39996 + hash(name, i) * 0.4;
    const r = 14 * Math.sqrt(i + 1);
    houses.push({ x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r * 0.85 });
  }
  const town = 14 * Math.sqrt(nh) + 30;
  const fields = [];
  const nf = Math.min(160, fieldsWanted);
  const cell = 135;
  for (let ring = 1; fields.length < nf && ring < 30; ring++) {
    for (let gx = -ring; gx <= ring && fields.length < nf; gx++) {
      for (const gy of [-ring, ring]) {
        const x = P.x + gx * cell;
        const y = P.y + gy * cell + (ring % 2 ? 40 : 0);
        if (Math.hypot(x - P.x, y - P.y) < town + 60 || hash(name, fields.length * 7 + gx * 31 + gy) < 0.18) continue;
        fields.push({ x, y, w: 100 + hash(name, gx * 13 + gy) * 18, h: 104 + hash(name, gx + gy * 17) * 18 });
        if (fields.length >= nf) break;
      }
    }
  }
  const out = { houses, fields, town };
  layoutCache.set(key, out);
  return out;
}

// What the light life says of a place now.
function stateOf(v, name) {
  const P = REGION[name];
  if (P.kind === 'deme') return demeOf(v, name);
  if (P.kind === 'town') return demeOf(v, P.people);
  return null;
}

// ---- drawing ----

// Under Oinoe's own land: the sea, the mountains, the roads, the other places and who is on the
// roads. k is pixels per metre.
export function drawRegion(ctx, v, cam, w, h, pal, S) {
  const k = cam.scale;
  const tl = { x: cam.x - w / 2 / k, y: cam.y - h / 2 / k };
  const br = { x: cam.x + w / 2 / k, y: cam.y + h / 2 / k };
  const seen = (x, y, r) => x + r > tl.x && x - r < br.x && y + r > tl.y && y - r < br.y;
  // The sea.
  ctx.fillStyle = pal.water;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  COAST.forEach((p, i) => (i ? ctx.lineTo(S(p).x, S(p).y) : ctx.moveTo(S(p).x, S(p).y)));
  ctx.lineTo(S({ x: 60 * KM, y: 60 * KM }).x, S({ x: 60 * KM, y: 60 * KM }).y);
  ctx.lineTo(S({ x: -60 * KM, y: 60 * KM }).x, S({ x: -60 * KM, y: 60 * KM }).y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // The mountains.
  ctx.fillStyle = pal.hill;
  for (const m of MOUNTAINS) {
    if (!seen(m.x, m.y, Math.max(m.rx, m.ry))) continue;
    const c = S(m);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, m.rx * k, m.ry * k, -0.2, 0, Math.PI * 2);
    ctx.fill();
    if (k < 0.004) {
      ctx.fillStyle = pal.muted;
      ctx.font = 'italic 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.name, c.x, c.y);
      ctx.fillStyle = pal.hill;
    }
  }
  // The roads.
  ctx.strokeStyle = pal.rule;
  ctx.lineWidth = Math.max(1, 5 * k);
  ctx.lineCap = 'round';
  for (const [a, b] of ROADS) {
    const line = roadLine(a, b);
    ctx.beginPath();
    line.forEach((p, i) => (i ? ctx.lineTo(S(p).x, S(p).y) : ctx.moveTo(S(p).x, S(p).y)));
    ctx.stroke();
  }
  // The Long Walls, from Athens down to the Piraeus.
  if (seen(REGION.Athens.x, REGION.Athens.y, 12 * KM)) {
    ctx.strokeStyle = pal.wall;
    ctx.lineWidth = Math.max(1, 6 * k);
    for (const off of [-180, 180]) {
      const a = S({ x: REGION.Athens.x + off - 900, y: REGION.Athens.y + 1100 });
      const b = S({ x: REGION.Piraeus.x + off + 500, y: REGION.Piraeus.y - 800 });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  // The other places: from far off a mark and a name; close to, the place itself.
  for (const [name, P] of Object.entries(REGION)) {
    if (name === 'Oinoe' || P.kind === 'place') continue;
    if (!seen(P.x, P.y, 3500)) continue;
    if (k > 0.03) drawPlace(ctx, v, name, P, k, pal, S, seen);
    const c = S(P);
    const d = stateOf(v, name);
    const big = P.kind === 'city' ? 7 : P.kind === 'town' ? 5 : 4;
    if (k <= 0.03) {
      ctx.fillStyle = d && d.burned ? pal.alarm : P.kind === 'town' ? pal.alarm : pal.house;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (P.kind === 'city') ctx.rect(c.x - big, c.y - big, big * 2, big * 2);
      else ctx.arc(c.x, c.y, big, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (k < 0.2) {
      ctx.fillStyle = pal.ink;
      ctx.font = `${P.kind === 'city' ? '600 13px' : '12px'} system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(name, c.x, c.y - (k <= 0.03 ? big + 5 : 18));
    }
  }
  // Oinoe's own name, from far off.
  if (k < 0.03) {
    const c = S(REGION.Oinoe);
    ctx.fillStyle = pal.bronze;
    ctx.strokeStyle = pal.ink;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.ink;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(v.name, c.x, c.y - 11);
  }
  // Who is on the roads.
  for (const tr of travellers(v)) {
    if (!seen(tr.x, tr.y, 200)) continue;
    const c = S(tr);
    const len = Math.hypot(tr.dx, tr.dy) || 1;
    const ux = tr.dx / len;
    const uy = tr.dy / len;
    const r = Math.max(tr.army ? 2.2 : 1.6, 0.9 * k);
    const n = Math.min(tr.n, k < 0.02 ? 3 : 40);
    if (tr.cart) {
      ctx.fillStyle = pal.stump;
      ctx.fillRect(c.x - ux * 6 - 3, c.y - uy * 6 - 3, 6, 6);
    }
    ctx.fillStyle = tr.army ? pal.bronze : pal.man;
    for (let i = 0; i < n; i++) {
      // In file along the road, two abreast for an army.
      const back = tr.army ? Math.floor(i / 2) : i;
      const side = tr.army ? (i % 2 ? 1 : -1) : 0;
      const sp = Math.max(r * 2.4, 1.2 * k);
      ctx.beginPath();
      ctx.arc(c.x - ux * back * sp - uy * side * sp * 0.6, c.y - uy * back * sp + ux * side * sp * 0.6, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tr.label && (k > 0.004 || tr.army)) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      const tw = ctx.measureText(tr.label).width + 8;
      ctx.fillStyle = pal.paper;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(c.x + 8, c.y - 14, tw, 15);
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.ink;
      ctx.fillText(tr.label, c.x + 12, c.y - 3);
    }
  }
}

// A deme, a Boeotian town or Athens, close to: its houses, its fields as its year has gone, its
// flock, and its people about their day.
function drawPlace(ctx, v, name, P, k, pal, S, seen) {
  const d = stateOf(v, name);
  const city = P.kind === 'city' || P.kind === 'port';
  const people = city ? (P.kind === 'city' ? 1200 : 300) : d ? peopleOfDeme(d) : 100;
  const L = layoutOf(name, Math.min(people, 1500), city ? 0 : Math.round(people / 2));
  const m = monthOf(v);
  const year = Math.floor(v.day / 360);
  // Fields: green in spring, gold at harvest, stubble after; burned black this year if raided.
  const burned = d && d.burned;
  const olives = d ? Math.round((d.olives || 0) / 1.3) : 0;
  const vines = d ? Math.round((d.vines || 0) / 1.3) : 0;
  L.fields.forEach((f, i) => {
    if (!seen(f.x, f.y, 120)) return;
    const a = S({ x: f.x - f.w / 2, y: f.y - f.h / 2 });
    const kind = i < olives ? 'olives' : i < olives + vines ? 'vines' : null;
    const sownYear = (i + year) % 2 === 0;
    let col = kind ? pal[kind] : pal.stubble;
    if (!kind && sownYear) col = m >= 3 && m < 7 ? pal.green : m === 7 ? pal.ripe : m <= 2 ? pal.sown : pal.stubble;
    if (burned && hash(name, i + year * 101) < 0.6) col = pal.stump;
    ctx.fillStyle = col;
    ctx.fillRect(a.x, a.y, f.w * k, f.h * k);
    ctx.strokeStyle = pal.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, f.w * k, f.h * k);
    if (kind && k > 0.12) {
      ctx.fillStyle = pal[kind === 'vines' ? 'vine' : 'olive'];
      const step = kind === 'vines' ? 12 : 20;
      for (let yy = 6; yy < f.h; yy += step) for (let xx = 6; xx < f.w; xx += step) {
        const pt = S({ x: f.x - f.w / 2 + xx, y: f.y - f.h / 2 + yy });
        ctx.fillRect(pt.x, pt.y, Math.max(1, 1.5 * k), Math.max(1, 1.5 * k));
      }
    }
  });
  // A city's walls, or a town's; the Acropolis.
  if (P.kind !== 'deme') {
    const r = P.kind === 'city' ? 1300 : P.kind === 'port' ? 700 : L.town + 40;
    const c = S(P);
    ctx.fillStyle = pal.house;
    ctx.globalAlpha = city ? 0.55 : 0.25;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * k, r * 0.85 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.wall;
    ctx.lineWidth = Math.max(1.5, 5 * k);
    ctx.stroke();
    if (P.kind === 'city') {
      const a = S({ x: P.x - 150, y: P.y + 150 });
      ctx.fillStyle = pal.hill;
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, 160 * k, 80 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.wall;
      ctx.fillRect(a.x - 35 * k, a.y - 15 * k, 70 * k, 30 * k);
    }
  }
  // Houses: for a city, the crowded quarters inside the walls.
  ctx.fillStyle = pal.house;
  ctx.strokeStyle = pal.wall;
  const hs = city ? 260 : L.houses.length;
  for (let i = 0; i < hs; i++) {
    let x;
    let y;
    if (city) {
      const a = hash(name, i) * Math.PI * 2;
      const rr = Math.sqrt(hash(name, i + 999)) * (P.kind === 'city' ? 1200 : 600);
      x = P.x + Math.cos(a) * rr;
      y = P.y + Math.sin(a) * rr * 0.85;
    } else {
      x = L.houses[i].x;
      y = L.houses[i].y;
    }
    if (!seen(x, y, 20)) continue;
    const c = S({ x: x - 4.5, y: y - 4.5 });
    ctx.fillRect(c.x, c.y, Math.max(1.5, 9 * k), Math.max(1.5, 9 * k));
  }
  // The flock on the hill behind the village.
  if (d && d.sheep > 0 && k > 0.06) {
    const fx = P.x - 380;
    const fy = P.y - 420;
    ctx.fillStyle = pal.paper;
    const n = Math.min(80, Math.round(d.sheep / 4));
    for (let i = 0; i < n; i++) {
      const a = hash(name, i + 500) * Math.PI * 2;
      const rr = Math.sqrt(hash(name, i + 700)) * 60;
      const wob = Math.sin(v.hour + i) * 4;
      const c = S({ x: fx + Math.cos(a) * rr + wob, y: fy + Math.sin(a) * rr });
      ctx.fillRect(c.x - 1, c.y - 1, Math.max(2, 1.4 * k), Math.max(2, 1.4 * k));
    }
  }
  // Its people about their day: out to the fields after dawn, home before dark; in a city, about
  // the streets.
  if (k > 0.05) {
    const dawn = dawnOf(v);
    const dusk = duskOf(v);
    const n = Math.min(city ? 160 : 70, Math.round(people / (city ? 8 : 2)));
    for (let i = 0; i < n; i++) {
      const home = city ? null : L.houses[i % L.houses.length];
      let x;
      let y;
      if (city) {
        const a = hash(name, i + 3000) * Math.PI * 2 + (v.hour / 24) * (hash(name, i) - 0.5) * 6;
        const rr = Math.sqrt(hash(name, i + 4000)) * (P.kind === 'city' ? 1100 : 550);
        x = P.x + Math.cos(a) * rr;
        y = P.y + Math.sin(a) * rr * 0.85;
      } else {
        const f = L.fields[Math.floor(hash(name, i + v.day * 7) * Math.max(1, L.fields.length))] || home;
        const out = v.hour < dawn || v.hour > dusk || !f ? 0 : Math.min(1, (v.hour - dawn) / 1.2, (dusk - v.hour) / 1.2);
        const jig = Math.sin(v.hour * 3 + i) * 6;
        x = home.x + (f.x - home.x) * out + jig;
        y = home.y + (f.y - home.y) * out + Math.cos(v.hour * 2 + i) * 4;
      }
      if (!seen(x, y, 5)) continue;
      const c = S({ x, y });
      ctx.fillStyle = i % 2 ? pal.woman : pal.man;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1.3, 0.9 * k), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Its name, close to.
  if (k >= 0.2) {
    const c = S({ x: P.x, y: P.y - (city ? 1400 : L.town + 30) });
    ctx.fillStyle = pal.ink;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, c.x, c.y);
  }
}

// What a place is, for the map's tooltip: from its light life.
export function describePlace(v, land, k) {
  for (const [name, P] of Object.entries(REGION)) {
    if (name === 'Oinoe') continue;
    const reach = Math.max(P.kind === 'city' ? 1500 : 500, 14 / k);
    if (Math.hypot(land.x - P.x, land.y - P.y) > reach) continue;
    const d = stateOf(v, name);
    const way = route('Oinoe', name);
    const far = Math.round((way ? way.len : Math.hypot(P.x, P.y)) / 1000);
    if (P.kind === 'city') return `<b>Athens</b>, the city: ${far} km by the road through Eleusis, ${CITY.days} days there and back with a load. Its market buys Oinoe's surplus and sells what Oinoe cannot make.`;
    if (P.kind === 'port') return '<b>The Piraeus</b>, the port of Athens, joined to the city by the Long Walls; where the oil and wine dealers ship from.';
    if (P.kind === 'place') return `<b>${name}</b>, ${far} km from ${v.name} by road.`;
    if (!d) return `<b>${name}</b>`;
    const who = P.kind === 'town' ? `${name}, town of the ${P.people}` : `${name}, a deme of Attica`;
    return `<b>${who}</b>, ${far} km by road. ${peopleOfDeme(d)} people, ${d.men} men of fighting age; ${d.sheep} sheep${d.olives ? `; ${d.olives.toFixed(1)} ha of olives and ${d.vines.toFixed(1)} of vines` : ''}${d.burned ? '; <b>its fields burned this year</b>' : ''}. ${d.news && d.news[0] ? d.news[0].text : ''}`;
  }
  return null;
}

export const REGION_BOUNDS = { x0: -45 * KM, x1: 42 * KM, y0: -30 * KM, y1: 30 * KM };
