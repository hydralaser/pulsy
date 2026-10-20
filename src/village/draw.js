import { BOUNDS } from './land.js';
import { monthOf, dawnOf, duskOf } from './clock.js';
import { lifeStage } from './people.js';
import { fieldFront, woodpileOf } from './work.js';

const TOKENS = ['paper', 'ink', 'muted', 'rule', 'bronze', 'alarm', 'plain', 'hill', 'water', 'stubble', 'ploughed', 'sown', 'green', 'ripe', 'tree', 'stump', 'wall', 'house', 'man', 'woman', 'night'];

export function readVillagePalette(el) {
  const cs = getComputedStyle(el);
  const pal = {};
  for (const t of TOKENS) pal[t] = cs.getPropertyValue(`--${t}`).trim();
  return pal;
}

// The camera: a point on the land at the middle of the screen, and pixels per metre.
export function fitCamera(cam, w, h) {
  const sx = w / (BOUNDS.x1 - BOUNDS.x0);
  const sy = h / (BOUNDS.y1 - BOUNDS.y0);
  cam.scale = Math.min(sx, sy) * 0.98;
  cam.x = (BOUNDS.x0 + BOUNDS.x1) / 2;
  cam.y = (BOUNDS.y0 + BOUNDS.y1) / 2;
}

export function toScreen(cam, w, h, p) {
  return { x: w / 2 + (p.x - cam.x) * cam.scale, y: h / 2 + (p.y - cam.y) * cam.scale };
}

export function toLand(cam, w, h, p) {
  return { x: cam.x + (p.x - w / 2) / cam.scale, y: cam.y + (p.y - h / 2) / cam.scale };
}

function fieldColour(v, f, pal) {
  if (f.state === 'ripe') return pal.ripe;
  if (f.state === 'sown') return monthOf(v) >= 3 ? pal.green : pal.sown;
  if (f.ploughed > 0) return pal.ploughed;
  return pal.stubble;
}

export function drawVillage(ctx, v, cam, w, h, pal, sel) {
  const k = cam.scale;
  const S = (p) => toScreen(cam, w, h, p);
  ctx.fillStyle = pal.plain;
  ctx.fillRect(0, 0, w, h);

  // Hills: the pastures and the woods stand on higher, rougher ground.
  ctx.fillStyle = pal.hill;
  for (const a of [...v.land.pastures, ...v.land.groves]) {
    const c = S(a);
    ctx.beginPath();
    ctx.arc(c.x, c.y, (a.r + 160) * k, 0, Math.PI * 2);
    ctx.fill();
  }

  // The stream and the roads.
  ctx.strokeStyle = pal.water;
  ctx.lineWidth = Math.max(1.5, 9 * k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  v.land.stream.forEach((p, i) => (i ? ctx.lineTo(S(p).x, S(p).y) : ctx.moveTo(S(p).x, S(p).y)));
  ctx.stroke();
  ctx.strokeStyle = pal.rule;
  ctx.lineWidth = Math.max(1, 4 * k);
  ctx.setLineDash([6, 5]);
  for (const r of v.land.roads) {
    ctx.beginPath();
    r.forEach((p, i) => (i ? ctx.lineTo(S(p).x, S(p).y) : ctx.moveTo(S(p).x, S(p).y)));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Fields, coloured by where they are in the year. Work in hand shows strip by strip, as the
  // crew goes up and down the field.
  for (const f of v.land.fields) {
    const x0 = f.x - f.w / 2;
    const y0 = f.y - f.h / 2;
    const a = S({ x: x0, y: y0 });
    const fw = f.w * k;
    const fh = f.h * k;
    let base = fieldColour(v, f, pal);
    let doneColour = null;
    let key = null;
    if (f.state === 'stubble' && f.sown > 0) [base, doneColour, key] = [pal.ploughed, pal.sown, 'sown'];
    else if (f.state === 'stubble' && f.ploughed > 0) [base, doneColour, key] = [pal.stubble, pal.ploughed, 'ploughed'];
    else if (f.state === 'ripe' && f.reaped > 0) [base, doneColour, key] = [pal.ripe, pal.stubble, 'reaped'];
    ctx.fillStyle = base;
    ctx.fillRect(a.x, a.y, fw, fh);
    if (key) {
      const task = { sown: 'sow', ploughed: 'plough', reaped: 'reap' }[key];
      const band = f.bandTask === task && f.band ? f.band : 4;
      const fr = fieldFront(f, f[key], band);
      ctx.fillStyle = doneColour;
      ctx.fillRect(a.x, a.y, (fr.x - x0) * k, fh);
      const partY = fr.dir > 0 ? y0 : f.y + f.h / 2 - fr.along;
      const p0 = S({ x: fr.x, y: partY });
      ctx.fillRect(p0.x, p0.y, Math.max(0.5, band * k), fr.along * k);
    }
    const picked = sel.site && sel.site.kind === 'field' && sel.site.id === f.id;
    ctx.strokeStyle = picked ? pal.ink : pal.rule;
    ctx.lineWidth = picked ? 2 : 1;
    ctx.strokeRect(a.x, a.y, fw, fh);
    if (k > 0.35) {
      ctx.fillStyle = pal.muted;
      ctx.font = `${Math.min(13, 10 + k * 2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(f.id + 1), a.x + fw / 2, a.y + fh / 2 + 4);
    }
  }

  // Rough ground being cleared: its outline, and the cleared part as bare stubble.
  for (const x of v.projects || []) {
    if (x.kind !== 'field') continue;
    const w = v.land.wild[x.plot];
    const a = S({ x: w.x - w.w / 2, y: w.y - w.h / 2 });
    ctx.fillStyle = pal.hill;
    ctx.fillRect(a.x, a.y, w.w * k, w.h * k);
    ctx.fillStyle = pal.stubble;
    ctx.fillRect(a.x, a.y, w.w * k * (x.done.work / x.needs.work), w.h * k);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, w.w * k, w.h * k);
    ctx.setLineDash([]);
  }

  // Woods: each tree a stand, smaller as it is cut, a stump when it is gone.
  // The quarry: a scar of grey rock on the hillside, its faces marked.
  for (const g of v.land.groves) {
    if (g.material !== 'stone') continue;
    const c = S(g);
    ctx.fillStyle = pal.wall;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, g.r * k, g.r * 0.7 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const t of v.land.trees) {
    if (t.stone) continue;
    const c = S(t);
    const r = Math.max(1.2, 16 * k * Math.sqrt(t.wood / t.max));
    ctx.fillStyle = t.wood > 50 ? pal.tree : pal.stump;
    ctx.beginPath();
    ctx.arc(c.x, c.y, t.wood > 50 ? r : Math.max(1, 4 * k), 0, Math.PI * 2);
    ctx.fill();
  }

  // The village: wall, houses, well, threshing floor and the fold.
  const wall = v.land.wall.map(S);
  ctx.fillStyle = pal.paper;
  ctx.beginPath();
  wall.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pal.wall;
  ctx.lineWidth = Math.max(2, 5 * k);
  ctx.stroke();
  const building = new Map((v.projects || []).filter((x) => x.kind !== 'field').map((x) => [x.plot, x]));
  for (const [i, hs] of v.land.houses.entries()) {
    const c = S(hs);
    const x = building.get(i);
    if (!hs.built && !x) continue;
    if (!hs.built) {
      // A house going up: its outline, and as much of it filled as is built.
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(hs.a);
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect((-hs.h / 2) * k, (-hs.w / 2) * k, hs.h * k, hs.w * k);
      ctx.setLineDash([]);
      ctx.fillStyle = pal.house;
      const f = x.done.work / x.needs.work;
      ctx.fillRect((-hs.h / 2) * k, (-hs.w / 2) * k, hs.h * k * f, hs.w * k);
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(hs.a);
    ctx.fillStyle = pal.house;
    ctx.fillRect((-hs.h / 2) * k, (-hs.w / 2) * k, hs.h * k, hs.w * k);
    if (hs.great) {
      // The leading man's house, with its court.
      ctx.strokeStyle = pal.bronze;
      ctx.lineWidth = Math.max(1.5, 0.8 * k);
      ctx.strokeRect((-hs.h / 2) * k, (-hs.w / 2) * k, hs.h * k, hs.w * k);
      ctx.strokeRect((hs.h / 2 - 5) * k, (-hs.w / 4) * k, 5 * k, (hs.w / 2) * k);
    }
    ctx.restore();
  }
  // Each household's firewood, stacked beside its house: more stacks, not bigger ones.
  for (const h of v.households) {
    if (h.extinct || !h.stores) continue;
    const at = woodpileOf(v, h.id);
    const d = Math.hypot(at.x, at.y) || 1;
    const tx = -at.y / d;
    const ty = at.x / d;
    // Stone for building, heaped beside the woodpile.
    const stone = Math.min(8, Math.ceil((h.stores.stone || 0) / 800));
    ctx.fillStyle = pal.wall;
    for (let i = 0; i < stone; i++) {
      const s = S({ x: at.x - tx * (4 + i * 1.8) - (at.x / d) * 2, y: at.y - ty * (4 + i * 1.8) - (at.y / d) * 2 });
      ctx.fillRect(s.x - 0.8 * k, s.y - 0.8 * k, Math.max(1, 1.6 * k), Math.max(1, 1.6 * k));
    }
    const stacks = Math.min(10, Math.ceil(h.stores.wood / 600));
    ctx.fillStyle = pal.stump;
    for (let i = 0; i < stacks; i++) {
      const row = Math.floor(i / 5);
      const s = S({ x: at.x + tx * ((i % 5) - 2) * 2.2 + (at.x / d) * row * 2, y: at.y + ty * ((i % 5) - 2) * 2.2 + (at.y / d) * row * 2 });
      ctx.fillRect(s.x - 0.8 * k, s.y - 0.8 * k, Math.max(1, 1.6 * k), Math.max(1, 1.6 * k));
    }
  }
  const th = S(v.land.threshing);
  ctx.strokeStyle = pal.wall;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(th.x, th.y, Math.max(2, v.land.threshing.r * k), 0, Math.PI * 2);
  ctx.stroke();
  const fold = S(v.land.fold);
  ctx.strokeRect(fold.x - 14 * k, fold.y - 10 * k, 28 * k, 20 * k);

  // The well, the washing place on the stream, the woodpile, and wood piled at the landings.
  const well = S(v.land.well);
  ctx.fillStyle = pal.water;
  ctx.beginPath();
  ctx.arc(well.x, well.y, Math.max(1.5, 2.5 * k), 0, Math.PI * 2);
  ctx.fill();
  const wash = S(v.land.washing);
  ctx.strokeStyle = pal.wall;
  ctx.lineWidth = 1;
  ctx.strokeRect(wash.x - 8 * k, wash.y - 4 * k, 16 * k, 8 * k);
  const pile = (at, kg) => {
    if (kg < 20) return;
    const c = S(at);
    const r = Math.max(1.5, Math.sqrt(kg) * 0.12 * k);
    ctx.fillStyle = pal.stump;
    ctx.fillRect(c.x - r, c.y - r * 0.6, r * 2, r * 1.2);
  };
  const yard = S(v.land.woodpile);
  ctx.strokeStyle = pal.rule;
  ctx.strokeRect(yard.x - 6 * k, yard.y - 4 * k, 12 * k, 8 * k);
  for (const g of v.land.groves) pile(g.landing, g.pile);

  // Ox carts, with their loads.
  for (const c of v.cartsOut || []) {
    const g = v.land.groves[c.grove];
    const to = c.state === 'back' ? v.land.woodpile : g.landing;
    const dx = to.x - c.pos.x;
    const dy = to.y - c.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const cp = S(c.pos);
    const L = Math.max(4, 3 * k);
    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = pal.wall;
    ctx.fillRect(-L, -L * 0.45, L * 1.4, L * 0.9);
    if (c.load > 0) {
      ctx.fillStyle = pal.stump;
      ctx.fillRect(-L, -L * 0.35, L * 1.4 * Math.min(1, c.load / 450), L * 0.7);
    }
    ctx.fillStyle = pal.ploughed;
    ctx.beginPath();
    ctx.arc(L * 1.1, -L * 0.3, L * 0.32, 0, Math.PI * 2);
    ctx.arc(L * 1.1, L * 0.3, L * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The flock.
  const fl = S(v.flock.pos);
  ctx.fillStyle = pal.paper;
  ctx.strokeStyle = pal.muted;
  ctx.lineWidth = 0.5;
  const n = Math.min(80, Math.ceil(v.flock.head / 4));
  for (let i = 0; i < n; i++) {
    const a = i * 2.399;
    const rr = Math.sqrt(i) * Math.max(1.6, 6 * k);
    ctx.beginPath();
    ctx.arc(fl.x + Math.cos(a) * rr, fl.y + Math.sin(a) * rr * 0.7, Math.max(1.2, 2.2 * k), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // People. Those at home are inside the walls, gathered round their houses.
  const big = k > 0.6;
  for (const p of v.people) {
    if (!p.alive || p.away) continue;
    const c = S(p.pos);
    const stage = lifeStage(v, p);
    const r = Math.max(stage === 'adult' || stage === 'elder' ? 2 : 1.4, (stage === 'adult' ? 0.9 : 0.6) * k);
    if (p.yoke && p.task === 'plough' && p.state === 'working') {
      // His yoke of oxen, ahead of him on the furrow.
      const o = S({ x: p.pos.x, y: p.pos.y + (p.facing || 1) * 2.6 });
      ctx.fillStyle = pal.ploughed;
      ctx.beginPath();
      ctx.arc(o.x - 0.6 * k, o.y, Math.max(1.6, 0.7 * k), 0, Math.PI * 2);
      ctx.arc(o.x + 0.6 * k, o.y, Math.max(1.6, 0.7 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    if (p.task === 'wood' && p.load > 0 && (p.sub === 'drag' || p.state === 'returning')) {
      // A log dragged behind him.
      const g = v.land.groves[p.grove];
      const to = p.state === 'returning' || !g.carted ? woodpileOf(v, p.household) : g.landing;
      const dx = to.x - p.pos.x;
      const dy = to.y - p.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      const e = S({ x: p.pos.x - (dx / d) * 5, y: p.pos.y - (dy / d) * 5 });
      ctx.strokeStyle = pal.stump;
      ctx.lineWidth = Math.max(1.5, 0.5 * k);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    }
    ctx.fillStyle = p.sex === 'm' ? pal.man : pal.woman;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    const chosen = sel.halves.some((x) => x.h === p.household && x.half === p.sex);
    if (chosen || sel.person === p.id) {
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = sel.person === p.id ? 2 : 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + (big ? 3 : 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Night falls.
  const dawn = dawnOf(v);
  const dusk = duskOf(v);
  let dark = 0;
  if (v.hour < dawn - 0.75 || v.hour > dusk + 0.75) dark = 1;
  else if (v.hour < dawn + 0.75) dark = Math.max(0, (dawn + 0.75 - v.hour) / 1.5);
  else if (v.hour > dusk - 0.75) dark = Math.min(1, (v.hour - dusk + 0.75) / 1.5);
  if (sel.noNight) dark = 0;
  if (dark > 0) {
    ctx.globalAlpha = dark;
    ctx.fillStyle = pal.night;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // Names of the places people have been sent to, with what they are doing there.
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const l of sel.labels) {
    const c = S(l.at);
    const tw = ctx.measureText(l.text).width + 10;
    ctx.fillStyle = pal.paper;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(c.x - tw / 2, c.y - 24, tw, 17);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.ink;
    ctx.fillText(l.text, c.x, c.y - 12);
  }
}

// The person nearest a point on the screen, if near enough to mean them.
export function pickPerson(v, cam, w, h, pt) {
  let best = null;
  let bd = 10;
  for (const p of v.people) {
    if (!p.alive || p.away) continue;
    const c = toScreen(cam, w, h, p.pos);
    const d = Math.hypot(c.x - pt.x, c.y - pt.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
