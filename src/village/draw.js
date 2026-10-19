import { BOUNDS } from './land.js';
import { monthOf, dawnOf, duskOf } from './clock.js';
import { lifeStage } from './people.js';

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

  // Fields, coloured by where they are in the year; a field half-ploughed shows the line.
  for (const f of v.land.fields) {
    const a = S({ x: f.x - f.w / 2, y: f.y - f.h / 2 });
    const fw = f.w * k;
    const fh = f.h * k;
    ctx.fillStyle = pal.stubble;
    ctx.fillRect(a.x, a.y, fw, fh);
    const progress = f.state === 'stubble' ? Math.max(f.ploughed, f.sown) : f.state === 'ripe' ? 1 - f.reaped : 1;
    ctx.fillStyle = fieldColour(v, f, pal);
    if (f.state === 'stubble' && f.sown > 0) ctx.fillStyle = pal.sown;
    ctx.fillRect(a.x, a.y, fw * progress, fh);
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

  // Woods: each tree a stand, smaller as it is cut, a stump when it is gone.
  for (const t of v.land.trees) {
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
  for (const hs of v.land.houses) {
    const c = S(hs);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(hs.a);
    ctx.fillStyle = pal.house;
    ctx.fillRect((-hs.h / 2) * k, (-hs.w / 2) * k, hs.h * k, hs.w * k);
    ctx.restore();
  }
  const th = S(v.land.threshing);
  ctx.strokeStyle = pal.wall;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(th.x, th.y, Math.max(2, v.land.threshing.r * k), 0, Math.PI * 2);
  ctx.stroke();
  const fold = S(v.land.fold);
  ctx.strokeRect(fold.x - 14 * k, fold.y - 10 * k, 28 * k, 20 * k);

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
    if (!p.alive) continue;
    const c = S(p.pos);
    const stage = lifeStage(v, p);
    const r = Math.max(stage === 'adult' || stage === 'elder' ? 2 : 1.4, (stage === 'adult' ? 0.9 : 0.6) * k);
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
    if (!p.alive) continue;
    const c = toScreen(cam, w, h, p.pos);
    const d = Math.hypot(c.x - pt.x, c.y - pt.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
