import { TUNING, WEAPONS, SHIELDS } from '../sim/rules.js';
import { fwdOf, isRunning } from '../sim/core.js';
import { slotWorld } from '../sim/unit.js';

// Reads the page's colour tokens so the battlefield follows light and dark themes.
export function readPalette(el) {
  const cs = getComputedStyle(el);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    ground: v('--ground'),
    grid: v('--grid'),
    ink: v('--ink'),
    muted: v('--muted'),
    bronze: v('--bronze'),
    alarm: v('--alarm'),
    sides: [v('--side-a'), v('--side-b')],
    sidesDim: [v('--side-a-dim'), v('--side-b-dim')],
    own: v('--own') || '#e0a800',
    paper: v('--paper'),
  };
}

export function makeCamera() {
  return { x: 0, y: 0, zoom: 1, scale: 0, init: false };
}

export function updateCamera(cam, world, w, h) {
  // Keep everyone still in the fight in view: both phalanxes and their light troops.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const take = (p) => {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  };
  for (const u of world.units) take(u.anchor);
  for (const s of world.soldiers) {
    if (s.state === 'dead' || s.state === 'down' || s.state === 'escaped' || s.state === 'fleeing' || s.state === 'rallying' || s.state === 'pursuing') continue;
    take(s.pos);
  }
  // Where you have panned the view to, off the fighting it follows.
  const tx = (x0 + x1) / 2 + (cam.panX || 0);
  const ty = (y0 + y1) / 2 + (cam.panY || 0);
  if (!cam.init) {
    cam.x = tx;
    cam.y = ty;
    cam.init = true;
    cam.scale = 0;
  }
  const follow = cam.panX || cam.panY ? 0.3 : 0.05;
  cam.x += (tx - cam.x) * follow;
  cam.y += (ty - cam.y) * follow;
  const spanX = Math.max(w < 600 ? 22 : 32, x1 - x0 + 10);
  const spanY = y1 - y0 + 10;
  const want = Math.min(w / spanX, h / Math.max(spanY, spanX * 0.62)) * cam.zoom;
  cam.scale = cam.scale ? cam.scale + (want - cam.scale) * 0.08 : want;
}

export function toScreen(cam, w, h, p) {
  return { x: w / 2 + (p.x - cam.x) * cam.scale, y: h / 2 + (p.y - cam.y) * cam.scale };
}

export function toWorld(cam, w, h, p) {
  return { x: cam.x + (p.x - w / 2) / cam.scale, y: cam.y + (p.y - h / 2) / cam.scale };
}

function lerpPos(s, alpha) {
  return { x: s.prev.x + (s.pos.x - s.prev.x) * alpha, y: s.prev.y + (s.pos.y - s.prev.y) * alpha };
}

function drawGround(ctx, cam, w, h, pal) {
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, 0, w, h);
  const step = 5;
  const tl = toWorld(cam, w, h, { x: 0, y: 0 });
  const br = toWorld(cam, w, h, { x: w, y: h });
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
    const sx = Math.round(toScreen(cam, w, h, { x, y: 0 }).x) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
    const sy = Math.round(toScreen(cam, w, h, { x: 0, y }).y) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  // Scale bar
  const len = step * cam.scale;
  const x0 = 14;
  const y0 = h - 16;
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 4);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + len, y0);
  ctx.lineTo(x0 + len, y0 - 4);
  ctx.stroke();
  ctx.fillStyle = pal.ink;
  ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${step} m`, x0 + len + 6, y0 + 1);
}

export function unitLabel(world, u) {
  if (u.mode === 'routed') return 'Routed';
  if (u.mode === 'pursuing') return 'Pursuing';
  if (u.mode === 'withdrawing') return 'Withdrawing';
  if (u.charging) return u.counterCharge ? 'Counter-charging' : 'Charging';
  if (u.bracing) return 'Bracing';
  if (u.order === 'advance' && !u.inContact) return 'Advancing';
  if (u.order === 'back') return 'Giving ground';
  if (u.inContact) return world.inPulse ? 'Fighting' : 'Holding the gap';
  return 'Holding';
}

const HORSE_LABEL = {
  form: 'formed up',
  engage: 'charging the enemy horse',
  screen: 'covering the flank',
  hunt: 'riding down light troops',
  raid: 'raiding',
  pursue: 'pursuing',
  rest: 'resting the horses',
  broken: 'routed',
  leave: 'riding off',
};

const LIGHT_LABEL = {
  screen: 'skirmishing',
  clear: 'clearing the front',
  flank: 'on the flanks',
  leave: 'making off',
  fallback: 'falling back',
  broken: 'driven off',
};

function drawUnitLabels(ctx, world, cam, w, h, pal) {
  ctx.textAlign = 'center';
  // Each side's light troops, labelled where most of them are.
  // Out on the flanks they split, one party round each end, so each party gets its own label.
  for (const g of world.lights || []) {
    const men = g.members.map((id) => world.soldiers[id]).filter((s) => s.state === 'skirmishing' || s.state === 'retiring' || s.state === 'resting');
    const rt = rightOf(world.units[g.side].heading);
    const a = world.units[g.side].anchor;
    const parties = g.mode === 'screen' ? [men] : [men.filter((s) => (s.pos.x - a.x) * rt.x + (s.pos.y - a.y) * rt.y < 0), men.filter((s) => (s.pos.x - a.x) * rt.x + (s.pos.y - a.y) * rt.y >= 0)];
    for (const party of parties) {
      if (party.length < 2) continue;
      const c = { x: party.reduce((t, s) => t + s.pos.x, 0) / party.length, y: party.reduce((t, s) => t + s.pos.y, 0) / party.length };
      const p = toScreen(cam, w, h, c);
      ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = pal.muted;
      ctx.fillText(`Peltasts · ${LIGHT_LABEL[g.mode] || g.mode}`, p.x, p.y - 10);
    }
  }
  // Each squadron, labelled where most of its riders are.
  for (const b of world.horse || []) {
    const men = b.members.map((id) => world.soldiers[id]).filter((s) => ['riding', 'charging', 'melee', 'wheeling'].includes(s.state));
    if (men.length < 2) continue;
    const c = { x: men.reduce((t, s) => t + s.pos.x, 0) / men.length, y: men.reduce((t, s) => t + s.pos.y, 0) / men.length };
    const p = toScreen(cam, w, h, c);
    ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = pal.muted;
    ctx.fillText(`Cavalry · ${HORSE_LABEL[b.mode] || b.mode}`, p.x, p.y - 14);
  }
  for (const u of world.units) {
    if (u.mode === 'routed' && world.t - u.routT > 4) continue;
    const fw = fwdOf(u.heading);
    // Each contingent's name just behind its block of files.
    if (u.contingents.length > 1) {
      ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (const c of u.contingents) {
        const back = slotWorld(u, (c.file0 + c.file1 - 1) / 2, c.depth - 1);
        const p = toScreen(cam, w, h, { x: back.x - fw.x * 1.1, y: back.y - fw.y * 1.1 });
        ctx.fillStyle = pal.muted;
        ctx.fillText(c.name, p.x, p.y);
      }
    }
    const depth = u.ranks * TUNING.rankSpacing + (u.contingents.length > 1 ? 2.6 : 1.6);
    const p = toScreen(cam, w, h, { x: u.anchor.x - fw.x * depth, y: u.anchor.y - fw.y * depth });
    ctx.fillStyle = pal.sides[u.side];
    ctx.font = '600 13px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(u.short, p.x, p.y - 2);
    ctx.fillStyle = pal.muted;
    ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(unitLabel(world, u), p.x, p.y + 1);
  }
  ctx.textAlign = 'left';
}

function drawSlots(ctx, world, cam, w, h, pal) {
  // Faint dots where each slot is, so gaps in the line are visible.
  ctx.fillStyle = pal.grid;
  for (const u of world.units) {
    if (u.mode === 'routed') continue;
    for (let r = 0; r < u.ranks; r++) {
      for (let f = 0; f < u.files; f++) {
        if (u.grid[r][f] >= 0 || r >= u.contingents[u.fileOwner[f]].depth) continue;
        const p = toScreen(cam, w, h, slotWorld(u, f, r));
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1.5, cam.scale * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawSoldier(ctx, world, cam, w, h, pal, s, alpha, opts) {
  const p = toScreen(cam, w, h, lerpPos(s, alpha));
  const k = cam.scale;
  const r = Math.max(2.5, TUNING.bodyRadius * k);
  const colour = pal.sides[s.side];

  if (s.state === 'dead') {
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = Math.max(1, k * 0.06);
    const d = r * 0.6;
    ctx.beginPath();
    ctx.moveTo(p.x - d, p.y - d);
    ctx.lineTo(p.x + d, p.y + d);
    ctx.moveTo(p.x + d, p.y - d);
    ctx.lineTo(p.x - d, p.y + d);
    ctx.stroke();
    return;
  }
  // Down, alive: a man lying on the ground.
  if (s.state === 'down') {
    const f = fwdOf(s.facing);
    ctx.fillStyle = pal.sidesDim[s.side];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * 1.1, r * 0.45, Math.atan2(f.y, f.x) + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (opts.selected === s.id) {
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  const running = isRunning(s);
  const f = fwdOf(s.facing);
  ctx.globalAlpha = running ? 0.55 : 1;
  if (s.kind === 'light') {
    drawPeltast(ctx, pal, s, p, r, f, k, colour);
    ctx.globalAlpha = 1;
    return;
  }
  if (s.kind === 'horse') {
    drawRider(ctx, world, pal, s, p, f, k, colour, opts);
    ctx.globalAlpha = 1;
    return;
  }

  // Spear: held about a third of the way along, thrust forward when striking.
  if (!running && WEAPONS[s.weapon].thrust) {
    const jab = world.t - s.lastAttackT < 0.35 ? 0.7 * (1 - (world.t - s.lastAttackT) / 0.35) : 0;
    const back = 0.6 * k;
    const front = (1.6 + jab) * k;
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, k * 0.05);
    ctx.beginPath();
    ctx.moveTo(p.x - f.x * back + -f.y * r * 0.5, p.y - f.y * back + f.x * r * 0.5);
    ctx.lineTo(p.x + f.x * front + -f.y * r * 0.5, p.y + f.y * front + f.x * r * 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Body
  ctx.fillStyle = s.wounds.length ? pal.sidesDim[s.side] : colour;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Shield on the left arm, covering the front and left.
  if (!running && s.shield !== 'none') {
    ctx.strokeStyle = pal.bronze;
    ctx.lineWidth = Math.max(1.5, k * 0.12);
    const sr = Math.max(r * 1.25, SHIELDS[s.shield].radius * k);
    ctx.beginPath();
    ctx.arc(p.x, p.y, sr, s.facing - 1.9, s.facing + 0.45);
    ctx.stroke();
  }

  if (s.state === 'wavering') {
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const u = world.units[s.unit];
  if (s.id === u.leaderId) {
    ctx.strokeStyle = pal.bronze;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.veteran) {
    ctx.fillStyle = pal.bronze;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5, r * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }

  if (opts.showMood && !running) {
    // Eagerness: a dark wedge ahead of men straining to get at the enemy.
    const eager = s.resolve * (1 - (s.halt || 0));
    if (eager > 0.45 && s.state !== 'fighting') {
      ctx.fillStyle = pal.ink;
      ctx.globalAlpha = Math.min(0.85, eager);
      const tip = r + 4 + eager * 6;
      const w = Math.max(3, r * 0.7);
      ctx.beginPath();
      ctx.moveTo(p.x + f.x * tip, p.y + f.y * tip);
      ctx.lineTo(p.x + f.x * (r + 1) - f.y * w, p.y + f.y * (r + 1) + f.x * w);
      ctx.lineTo(p.x + f.x * (r + 1) + f.y * w, p.y + f.y * (r + 1) - f.x * w);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const fear = 1 - Math.min(1, s.nerve / 0.8);
    if (fear > 0.25) {
      ctx.strokeStyle = pal.alarm;
      ctx.globalAlpha = Math.min(1, fear);
      ctx.lineWidth = 1 + fear * 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  if (opts.selected === s.id) {
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// A light man: smaller, lighter, a little wicker shield and a couple of javelins in hand.
function drawPeltast(ctx, pal, s, p, r, f, k, colour) {
  const lr = r * 0.8;
  if (s.javelins > 0) {
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha *= 0.5;
    ctx.lineWidth = Math.max(1, k * 0.035);
    ctx.beginPath();
    ctx.moveTo(p.x - f.x * 0.4 * k - f.y * lr * 0.6, p.y - f.y * 0.4 * k + f.x * lr * 0.6);
    ctx.lineTo(p.x + f.x * 1.1 * k - f.y * lr * 0.6, p.y + f.y * 1.1 * k + f.x * lr * 0.6);
    ctx.stroke();
    ctx.globalAlpha /= 0.5;
  }
  ctx.fillStyle = s.wounds.length ? pal.sidesDim[s.side] : colour;
  ctx.globalAlpha *= 0.8;
  ctx.beginPath();
  ctx.arc(p.x, p.y, lr, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha /= 0.8;
  ctx.strokeStyle = pal.bronze;
  ctx.lineWidth = Math.max(1, k * 0.07);
  ctx.beginPath();
  ctx.arc(p.x, p.y, lr * 1.25, s.facing - 1.5, s.facing + 0.1);
  ctx.stroke();
}

// A horseman: the horse a long body under him, his spear held level when he is at grips.
function drawRider(ctx, world, pal, s, p, f, k, colour, opts) {
  const len = Math.max(5, 1.1 * k);
  const wid = Math.max(2.5, 0.42 * k);
  const rt = { x: -f.y, y: f.x };
  ctx.fillStyle = s.wounds.length ? pal.sidesDim[s.side] : colour;
  ctx.globalAlpha *= 0.75;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, len, wid, Math.atan2(f.y, f.x), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha /= 0.75;
  // The horse's head, and the rider.
  ctx.beginPath();
  ctx.arc(p.x + f.x * len * 0.95, p.y + f.y * len * 0.95, wid * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.ink;
  ctx.beginPath();
  ctx.arc(p.x - f.x * len * 0.1, p.y - f.y * len * 0.1, Math.max(1.5, wid * 0.5), 0, Math.PI * 2);
  ctx.fill();
  if (s.state === 'melee' || s.state === 'charging') {
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha *= 0.6;
    ctx.lineWidth = Math.max(1, k * 0.05);
    ctx.beginPath();
    ctx.moveTo(p.x + rt.x * wid * 0.6, p.y + rt.y * wid * 0.6);
    ctx.lineTo(p.x + rt.x * wid * 0.6 + f.x * len * 1.6, p.y + rt.y * wid * 0.6 + f.y * len * 1.6);
    ctx.stroke();
    ctx.globalAlpha /= 0.6;
  }
  if (opts.selected === s.id) {
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, len + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  void world;
}

function drawMarks(ctx, world, cam, w, h, pal) {
  for (const m of world.marks) {
    const age = world.t - m.t;
    if (m.kind === 'javelin') {
      // A javelin in flight, from the thrower to where his man stood.
      const len = Math.hypot(m.x2 - m.x, m.y2 - m.y);
      const flight = Math.max(0.3, len / 22);
      if (age > flight) continue;
      const k0 = age / flight;
      const k1 = Math.min(1, k0 + 1.2 / Math.max(1, len));
      const a = toScreen(cam, w, h, { x: m.x + (m.x2 - m.x) * k0, y: m.y + (m.y2 - m.y) * k0 });
      const b = toScreen(cam, w, h, { x: m.x + (m.x2 - m.x) * k1, y: m.y + (m.y2 - m.y) * k1 });
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = Math.max(1, cam.scale * 0.04);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      continue;
    }
    const p = toScreen(cam, w, h, m);
    if (m.kind === 'death' && age < 1.5) {
      ctx.globalAlpha = 1 - age / 1.5;
      ctx.strokeStyle = pal.alarm;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (0.4 + age) * cam.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

export function drawBattle(ctx, world, cam, w, h, pal, alpha, opts) {
  drawGround(ctx, cam, w, h, pal);
  drawSlots(ctx, world, cam, w, h, pal);
  const lying = (s) => (s.state === 'dead' || s.state === 'down' ? 0 : 1);
  const order = [...world.soldiers].sort((a, b) => lying(a) - lying(b));
  for (const s of order) {
    if (s.state === 'escaped') continue;
    drawSoldier(ctx, world, cam, w, h, pal, s, alpha, opts);
  }
  drawMarks(ctx, world, cam, w, h, pal);
  drawOwnMen(ctx, world, cam, w, h, pal, alpha);
  drawUnitLabels(ctx, world, cam, w, h, pal);
}

// Men from the player's own village: a small pennant over each, so they can be found in the line;
// a bigger one over the player himself. The fallen keep a grey one where they lie.
function drawOwnMen(ctx, world, cam, w, h, pal, alpha) {
  const r = Math.max(2.5, TUNING.bodyRadius * cam.scale);
  for (const s of world.soldiers) {
    if (s.villageId == null || s.state === 'escaped') continue;
    const p = toScreen(cam, w, h, lerpPos(s, alpha));
    const size = s.player ? 6 : 4;
    const y = p.y - r - 3 - size;
    ctx.globalAlpha = isRunning(s) ? 0.55 : 1;
    ctx.fillStyle = s.state === 'dead' || s.state === 'down' ? pal.muted : pal.own;
    ctx.strokeStyle = pal.paper;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, y + size * 1.6);
    ctx.lineTo(p.x - size, y);
    ctx.lineTo(p.x + size, y);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function pickSoldier(world, cam, w, h, screen) {
  const p = toWorld(cam, w, h, screen);
  let best = null;
  let bestD = Math.max(0.6, 10 / cam.scale);
  for (const s of world.soldiers) {
    if (s.state === 'escaped') continue;
    const d = Math.hypot(s.pos.x - p.x, s.pos.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
