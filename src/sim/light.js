import { TUNING, LIGHT, SHIELDS, ARMOUR, HELMETS, WOUND_LOCATIONS, pickWeighted } from './rules.js';
import { isFormed, isGone, dist, clamp, fwdOf, rightOf, shiftNerve, logEvent } from './core.js';
import { frontDistance } from './unit.js';
import { killSoldier, woundSoldier, shieldCover } from './combat.js';
import { SIDES } from './names.js';

// Light troops: peltasts in loose order who fight with javelins and keep out of the way of
// hoplites. Before the lines meet they screen their own phalanx and skirmish with the enemy's
// light troops; when the phalanxes close they clear the front, and once the lines are locked
// together they work round the ends of the enemy line and throw at men whose unshielded side
// or back is turned to them. Each man moves on his own; the group only decides what they are
// about, as men shout to each other across the open order.

export function createLights(side, count) {
  const roster = SIDES[side];
  return {
    id: side,
    side,
    name: `${roster.adjective} peltasts`,
    short: `${roster.adjective} peltasts`,
    members: [],
    count,
    mode: 'screen', // screen | clear | flank | fallback | broken
    modeT: 0,
    present: 0,
    running: 0,
    nerve: 1,
    javelins: LIGHT.javelins,
    cohesion: 0.6, // open order: there are always gaps to get through
    momentum: 0,
    sinceBlow: 0,
    causes: {},
    stats: { killed: 0, killedPursuit: 0, wounds: 0, fled: 0 },
    decideT: 0,
  };
}

const ACTIVE = new Set(['skirmishing', 'retiring', 'resting']);

// The light troops' group decisions, twice a second.
export function stepLights(world, g, dt) {
  const T = TUNING;
  g.modeT += dt;
  g.decideT -= dt;
  if (g.decideT > 0 || !g.members.length) return;
  g.decideT = 0.5;
  let present = 0;
  let running = 0;
  let nerve = 0;
  let javelins = 0;
  for (const id of g.members) {
    const s = world.soldiers[id];
    if (ACTIVE.has(s.state)) {
      present++;
      nerve += s.nerve;
      javelins += s.javelins;
    } else if (s.state === 'fleeing') {
      running++;
    }
  }
  g.present = present;
  g.running = running;
  g.nerve = present ? nerve / present : 0;
  g.javelins = present ? javelins / present : 0;
  const u = world.units[g.side];
  const e = world.units[1 - g.side];
  const eg = world.lights[1 - g.side];
  const set = (mode, text) => {
    g.mode = mode;
    g.modeT = 0;
    if (text) logEvent(world, 'light', text, { unit: g.side });
  };
  if (g.mode !== 'broken' && (running / Math.max(1, present + running) > 0.45 || present <= Math.round(0.25 * g.members.length))) {
    set('broken', `The ${g.name} are driven off and run back behind their phalanx.`);
    return;
  }
  if (e.mode === 'routed') {
    if (g.mode !== 'flank' && g.mode !== 'broken') set('flank', `The ${g.name} run after the beaten enemy.`);
    return;
  }
  const close = world.contactT != null || frontDistance(u, e) < T.screenClear || u.charging || e.charging;
  switch (g.mode) {
    case 'screen':
      if (close) set('clear', `The ${g.name} clear the front as the phalanxes close.`);
      else if (g.nerve < 0.4 && g.modeT > 10) set('fallback', `The ${g.name} have had the worst of it and fall back behind their phalanx.`);
      else if (g.modeT > 10 && present < 0.5 * eg.present) set('fallback', `Outnumbered, the ${g.name} fall back behind their phalanx.`);
      break;
    case 'clear':
      if (world.contactT != null && g.modeT > 4) set('flank', `The ${g.name} work round the ends of the enemy line.`);
      break;
    case 'fallback':
    case 'broken':
      // Rallied behind their own line, they go back out when they have their nerve back.
      if (g.modeT > (g.mode === 'broken' ? 40 : 15) && g.nerve > 0.6 && present >= Math.round(0.4 * g.members.length)) {
        if (world.contactT != null) set('flank', `The ${g.name} rally and go out again round the enemy's flank.`);
        else if (!close) set('screen', `The ${g.name} rally and go out in front of their phalanx again.`);
      }
      break;
    default:
      break;
  }
}

// Where a light man should be heading, and at whom he should throw.
export function stepPeltast(world, s, dt) {
  const g = world.lights[s.side];
  const u = world.units[s.side];
  const e = world.units[1 - s.side];
  const eg = world.lights[1 - s.side];
  const rng = world.rng;
  s.stateT += dt;
  s.throwT -= dt;
  const fw = fwdOf(u.heading);
  const rt = rightOf(u.heading);
  const halfW = (u.files / 2) * TUNING.fileSpacing;
  // Each man has his own place across the line, and his own end of it to go round.
  const spread = ((s.id * 0.6180339) % 1) * 2 - 1;
  const behindPost = {
    x: u.anchor.x - fw.x * (u.ranks * TUNING.rankSpacing + 9) + rt.x * spread * halfW,
    y: u.anchor.y - fw.y * (u.ranks * TUNING.rankSpacing + 9) + rt.y * spread * halfW,
  };

  if (s.state === 'fleeing') {
    s.stamina = Math.max(0, s.stamina - TUNING.staminaRun * 0.6 * dt);
    s.running = true;
    s.goal = routeAround(u, s, behindPost);
    s.target = -1;
    if (Math.abs(s.pos.x) > TUNING.fieldHalfW || Math.abs(s.pos.y) > TUNING.fieldHalfH) {
      s.state = 'escaped';
      return;
    }
    shiftNerve(world, s, 0.03 * dt);
    if (dist(s.pos, behindPost) < 4 && s.nerve > 0.5) setLightState(s, 'resting');
    return;
  }

  lightNerve(world, s, dt);
  if (s.nerve < TUNING.nerveFlee) {
    setLightState(s, 'fleeing');
    s.record.fled++;
    g.stats.fled++;
    if (s.fledAt == null) s.fledAt = world.t;
    for (const { o, d } of s.friends) if (o.kind === 'light' && d < 8) shiftNerve(world, o, -0.03, 'panic');
    return;
  }

  // Keep out of the way of hoplites: back off from any that come close.
  const threat = nearestHoplite(world, s, e);
  if (threat.d < LIGHT.keepAway && s.state !== 'retiring') setLightState(s, 'retiring');
  if (s.state === 'retiring') {
    s.running = true;
    const away = threat.o ? norm({ x: s.pos.x - threat.o.pos.x, y: s.pos.y - threat.o.pos.y }) : { x: -fw.x, y: -fw.y };
    s.goal = { x: s.pos.x + away.x * 6, y: s.pos.y + away.y * 6 };
    if (threat.d > LIGHT.safeAgain) setLightState(s, 'skirmishing');
    tryThrow(world, s, eg, e);
    return;
  }
  s.running = false;
  s.stamina = Math.min(s.staminaCap, s.stamina + TUNING.staminaRecover * dt);

  // The group has fallen back: behind the line to rally. A man out of javelins drops back just
  // in front of his own line, out of throwing range, and picks up spent ones.
  const fallen = g.mode === 'fallback' || g.mode === 'broken';
  const empty = s.javelins === 0 || (s.state === 'resting' && s.javelins < LIGHT.javelins - 2);
  if (fallen || empty) {
    if (s.state !== 'resting') setLightState(s, 'resting');
    // Out in front of the line he drops back toward it. Out on the flanks once the lines are
    // locked, he only steps a little further out: hoplites cannot throw back, so only the
    // enemy's light troops can stop him picking up spent javelins there.
    let post = behindPost;
    if (!fallen && world.contactT == null) {
      post = { x: u.anchor.x + fw.x * 5 + rt.x * spread * halfW, y: u.anchor.y + fw.y * 5 + rt.y * spread * halfW };
    } else if (!fallen) {
      post = flankPost(world, s, e, spread < 0 ? -1 : 1, spread, 6) || behindPost;
    }
    s.goal = routeAround(u, s, post);
    s.target = -1;
    const safe = nearestOf(world, s, eg.members, 18, (o) => o.state === 'skirmishing') == null && threat.d > LIGHT.keepAway + 4;
    if (dist(s.pos, post) < 5 && safe) {
      s.refillT += dt;
      // Picking up spent javelins under the enemy's eyes is slow work.
      if (s.refillT > (world.contactT != null && !fallen ? LIGHT.refillFlank : LIGHT.refill) && s.javelins < LIGHT.javelins) {
        s.refillT = 0;
        s.javelins++;
      }
    }
    return;
  }
  if (s.state === 'resting') setLightState(s, 'skirmishing');

  if (g.mode === 'screen') {
    const post = {
      x: u.anchor.x + fw.x * LIGHT.screenAhead + rt.x * spread * (halfW + 4),
      y: u.anchor.y + fw.y * LIGHT.screenAhead + rt.y * spread * (halfW + 4),
    };
    // Facing the enemy's light troops, he waits just out of their reach, in a loose line across
    // the front, and darts in to throw.
    const foes = eg.members.map((id) => world.soldiers[id]).filter((o) => o.state === 'skirmishing' || o.state === 'retiring');
    if (foes.length) {
      const deep = foes.reduce((a, o) => a + (o.pos.x - u.anchor.x) * fw.x + (o.pos.y - u.anchor.y) * fw.y, 0) / foes.length;
      const back = clamp(deep - (LIGHT.range + 4 + ((s.id * 0.381966) % 1) * 3), 6, 45);
      const hold = { x: u.anchor.x + fw.x * back + rt.x * spread * (halfW + 4), y: u.anchor.y + fw.y * back + rt.y * spread * (halfW + 4) };
      if (skirmishWith(world, s, eg, routeAround(u, s, hold))) return;
    }
    // No light troops left in front of him: the hoplites behind them, who cannot throw back, at
    // whatever range he likes.
    const t = nearestOf(world, s, e.members, 80, isFormed);
    s.goal = t ? standOff(s, t, LIGHT.bestRange + ((s.id * 0.3819660) % 1 - 0.5) * 9) : routeAround(u, s, post);
    tryThrow(world, s, eg, e);
    return;
  }
  // Clear of the front: out on the wings of their own line.
  const end = spread < 0 ? -1 : 1;
  if (g.mode === 'clear') {
    const wing = {
      x: u.anchor.x + rt.x * end * (halfW + 7) - fw.x * 2,
      y: u.anchor.y + rt.y * end * (halfW + 7) - fw.y * 2,
    };
    s.goal = routeAround(u, s, wing);
    tryThrow(world, s, eg, e);
    return;
  }
  // Round the ends of the enemy line: out beyond his end and behind it, throwing at his exposed
  // men; if the enemy's light troops are out there too, the same darting game with them first.
  const goal = flankPost(world, s, e, end, spread);
  const station = goal ? routeAround(u, s, goal) : s.pos;
  if (skirmishWith(world, s, eg, station)) return;
  s.goal = station;
  tryThrow(world, s, eg, e);
}

// Against enemy light troops, who can throw back: wait just out of their reach, run in when a
// javelin is ready, throw from the edge of range and run back out while readying the next.
// Returns false when no enemy light troops are near enough to matter.
function skirmishWith(world, s, eg, hold) {
  const foe = nearestOf(world, s, eg.members, LIGHT.range + 14, (o) => o.state === 'skirmishing' || o.state === 'retiring');
  if (!foe) return false;
  const d = dist(s.pos, foe.pos);
  if (s.javelins > 0 && s.throwT <= 0) {
    s.running = true;
    s.goal = standOff(s, foe, LIGHT.range - 3);
    if (d <= LIGHT.range - 1.5) throwJavelin(world, s, foe);
  } else {
    // Back out of his reach, quickly while still inside it.
    s.running = d < LIGHT.range + 2;
    s.goal = hold;
  }
  return true;
}

function setLightState(s, state) {
  s.state = state;
  s.stateT = 0;
}

function norm(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function nearestHoplite(world, s, e) {
  let best = { o: null, d: Infinity };
  for (const id of e.members) {
    const o = world.soldiers[id];
    if (!isFormed(o) && o.state !== 'pursuing') continue;
    const d = dist(o.pos, s.pos);
    if (d < best.d) best = { o, d };
  }
  return best;
}

function nearestOf(world, s, ids, range, ok) {
  let best = null;
  let bd = range;
  for (const id of ids) {
    const o = world.soldiers[id];
    if (isGone(o) || !ok(o)) continue;
    const d = dist(o.pos, s.pos);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

// A point at the given range from the target, on the side he is already on.
function standOff(s, t, range) {
  const v = norm({ x: s.pos.x - t.pos.x, y: s.pos.y - t.pos.y });
  return { x: t.pos.x + v.x * range, y: t.pos.y + v.y * range };
}

// A man going from in front of his own phalanx to behind it (or back) goes round its end, not
// through its ranks.
function routeAround(u, s, goal) {
  const fw = fwdOf(u.heading);
  const rt = rightOf(u.heading);
  const local = (p) => ({ lat: (p.x - u.anchor.x) * rt.x + (p.y - u.anchor.y) * rt.y, dep: (p.x - u.anchor.x) * fw.x + (p.y - u.anchor.y) * fw.y });
  const a = local(s.pos);
  const b = local(goal);
  const halfW = (u.files / 2) * TUNING.fileSpacing + 2.5;
  const depth = u.ranks * TUNING.rankSpacing + 1;
  const crossing = (a.dep > 1 && b.dep < -depth) || (a.dep < -depth && b.dep > 1);
  if (!crossing || Math.abs(a.lat) > halfW) return goal;
  const side = (a.lat + b.lat) >= 0 ? 1 : -1;
  const lat = side * (halfW + 2);
  const dep = a.dep > 0 ? Math.max(1.5, Math.min(a.dep, 4)) : Math.min(-depth, a.dep);
  return { x: u.anchor.x + rt.x * lat + fw.x * dep, y: u.anchor.y + rt.y * lat + fw.y * dep };
}

// Out beyond one end of the enemy line, a little behind his front, where his men's sides and
// backs are turned. Each man takes his own spot so they spread round the end.
function flankPost(world, s, e, end, spread, further = 0) {
  const fw = fwdOf(e.heading);
  const rt = rightOf(e.heading);
  // The enemy's end on the side this man is going round, as the enemy faces.
  let f0 = -1;
  let f1 = -1;
  for (let f = 0; f < e.files; f++) {
    if (!e.grid.some((row) => row[f] >= 0)) continue;
    if (f0 < 0) f0 = f;
    f1 = f;
  }
  if (f0 < 0) return null;
  // Our right is his left: our men going round our right end go round his left end.
  const endFile = end > 0 ? f0 : f1;
  const outward = end > 0 ? -1 : 1;
  const mid = (e.ranks - 1) / 2;
  const p = slotWorldStraight(e, endFile, mid);
  const out = 7 + Math.abs(spread) * 6 + further;
  const backward = 2 + ((s.id * 0.7548776) % 1) * 9;
  return {
    x: p.x + rt.x * outward * out - fw.x * backward,
    y: p.y + rt.y * outward * out - fw.y * backward,
  };
}

function slotWorldStraight(u, f, r) {
  const fw = fwdOf(u.heading);
  const rt = rightOf(u.heading);
  const x = (f - (u.files - 1) / 2) * TUNING.fileSpacing;
  const y = -r * TUNING.rankSpacing;
  return { x: u.anchor.x + rt.x * x + fw.x * y, y: u.anchor.y + rt.y * x + fw.y * y };
}

// A light man's nerve: hoplites coming at him, and friends running, wear it down; out of
// danger it comes back.
function lightNerve(world, s, dt) {
  let fleeing = 0;
  for (const { o, d } of s.friends) if (o.kind === 'light' && o.state === 'fleeing' && d < 8) fleeing++;
  if (fleeing) shiftNerve(world, s, -Math.min(0.06, 0.015 * fleeing) * (1.2 - s.courage) * dt, 'panic');
  if (world.t - s.lastHitT > 6) shiftNerve(world, s, 0.012 * dt);
}

// Pick the best man to throw at, and throw if a javelin is ready.
function tryThrow(world, s, eg, e) {
  if (s.javelins <= 0 || s.throwT > 0) return;
  // Enemy light troops close by come first: they are throwing back. Otherwise the hoplite
  // most exposed to him: side or back turned, close.
  let best = null;
  let bestScore = 0;
  for (const id of eg.members) {
    const o = world.soldiers[id];
    if (!ACTIVE.has(o.state) && o.state !== 'fleeing') continue;
    const d = dist(o.pos, s.pos);
    if (d < LIGHT.minRange || d > LIGHT.range) continue;
    const score = 1.4 * (1 - d / (LIGHT.range + 4));
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  for (const id of e.members) {
    const o = world.soldiers[id];
    if (!isFormed(o) && o.state !== 'fleeing' && o.state !== 'pursuing') continue;
    const d = dist(o.pos, s.pos);
    if (d < LIGHT.minRange || d > LIGHT.range) continue;
    const open = 1.15 - shieldCover(o, s.pos);
    // Men strung out round the end of his own line, backs to the open field, come first.
    const strung = o.slot && e.curl[o.slot.f] > 0.5 ? 0.6 : 0;
    const score = (0.35 + open + strung) * (1 - d / (LIGHT.range + 4));
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  if (best) throwJavelin(world, s, best);
}

export function throwJavelin(world, s, t) {
  const rng = world.rng;
  s.javelins--;
  s.throwT = LIGHT.interval * rng.range(0.8, 1.3) / (0.5 + 0.5 * s.stamina);
  s.stamina = Math.max(0, s.stamina - 0.02);
  s.target = t.id;
  s.facing = Math.atan2(t.pos.y - s.pos.y, t.pos.x - s.pos.x);
  world.marks.push({ t: world.t, kind: 'javelin', x: s.pos.x, y: s.pos.y, x2: t.pos.x, y2: t.pos.y });
  const d = dist(s.pos, t.pos);
  // Being thrown at is frightening, hit or not, and more so from where the shield is not; worst
  // of all for men strung out round the end of an enemy line, with nobody behind them.
  const strung = t.slot && t.kind !== 'light' && world.units[t.unit].curl[t.slot.f] > 0.5;
  const exposed = (1.2 - shieldCover(t, s.pos)) * (strung ? LIGHT.strungFear : 1);
  shiftNerve(world, t, -0.012 * exposed * (1.2 - t.courage), 'missiles');
  for (const { o, d: dd } of t.friends) if (dd < 1.6 && o.kind !== 'light') shiftNerve(world, o, -0.004 * exposed, 'missiles');
  const body = t.kind === 'light' ? world.lights[t.side] : world.units[t.unit];
  body.underFire = (body.underFire || 0) + 1;
  let p = 0.65 * (0.5 + 0.5 * s.skill) * clamp(1.15 - d / LIGHT.range, 0.15, 1);
  if (t.state === 'fleeing') p *= 0.8;
  // A man darting about is harder to hit than one standing in a line.
  if (Math.hypot(t.vel.x, t.vel.y) > 1.5) p *= 0.65;
  if (!rng.chance(p)) return;
  // A shield turned toward the thrower stops most javelins; that is why light troops work round
  // to the sides and backs of men.
  const block = Math.min(0.95, SHIELDS[t.shield].block * 1.6 * t.shieldMul * shieldCover(t, s.pos));
  if (rng.chance(block)) {
    t.record.blocks++;
    // A javelin stuck in a shield makes it heavy and awkward.
    t.shieldMul = Math.max(0.6, t.shieldMul * 0.97);
    return;
  }
  const loc = pickWeighted(rng, WOUND_LOCATIONS.map((w) => [w, w[1]]));
  const protection = loc[2] === 'helmet' ? HELMETS[t.helmet].head : loc[2] === 'armour' ? ARMOUR[t.armour].torso : 0;
  const severity = LIGHT.damage * rng.range(0.4, 1.2) * (1 - protection * rng.range(0.6, 1));
  t.health -= severity;
  t.lastHitT = world.t;
  // Light men have no ranks around them: a friend hit beside them shakes them badly.
  if (t.kind === 'light') {
    for (const { o, d: dd } of t.friends) if (o.kind === 'light' && dd < 8 && o.state !== 'fleeing') shiftNerve(world, o, (t.health <= 0 ? -0.08 : -0.03) * (1.2 - o.courage), 'casualties');
  }
  if (t.health <= 0) killSoldier(world, t, s, loc[0]);
  else woundSoldier(world, t, s, loc[0], severity);
}
