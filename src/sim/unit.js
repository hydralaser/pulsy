import { TUNING } from './rules.js';
import { SIDES } from './names.js';
import { fwdOf, rightOf, isFormed, dist, shiftNerve, logEvent } from './core.js';
import { quality } from './soldier.js';

export const PLACEMENTS = {
  xenophon: 'Best front and rear',
  front: 'Best in front',
  rear: 'Best at the back',
  random: 'Random',
};

export function createUnit(idx, side, cfg, anchor, heading) {
  const roster = SIDES[side];
  return {
    id: idx,
    side,
    name: roster.name,
    short: roster.short,
    adjective: roster.adjective,
    files: cfg.files,
    ranks: cfg.ranks,
    grid: Array.from({ length: cfg.ranks }, () => new Array(cfg.files).fill(-1)),
    members: [],
    anchor: { ...anchor }, // centre of the front rank
    heading,
    turn: 0,
    order: 'hold',
    mode: 'formed', // formed | withdrawing | routed | pursuing
    ai: cfg.ai !== false,
    leaderId: -1,
    secondId: -1,
    surgeCallT: 0,
    surgeCooldown: 8,
    nerve: 1,
    stamina: 1,
    present: 0,
    running: 0,
    causes: {},
    sinceBlow: 0,
    inContact: false,
    aiT: 0,
    upkeepT: 0,
    pursuitT: 0,
    pursued: false,
    followT: 0,
    withdrawReason: null,
    decisionT: null,
    routT: null,
    stats: { killed: 0, killedPursuit: 0, wounds: 0, fled: 0 },
  };
}

export function slotWorld(u, f, r) {
  const fw = fwdOf(u.heading);
  const rt = rightOf(u.heading);
  const x = (f - (u.files - 1) / 2) * TUNING.fileSpacing;
  const y = -r * TUNING.rankSpacing;
  return { x: u.anchor.x + rt.x * x + fw.x * y, y: u.anchor.y + rt.y * x + fw.y * y };
}

export function occupant(world, u, f, r) {
  if (r < 0 || r >= u.ranks || f < 0 || f >= u.files) return null;
  const id = u.grid[r][f];
  return id < 0 ? null : world.soldiers[id];
}

export function placeInSlot(u, s, f, r) {
  if (s.slot && u.grid[s.slot.r][s.slot.f] === s.id) u.grid[s.slot.r][s.slot.f] = -1;
  u.grid[r][f] = s.id;
  s.slot = { f, r };
}

export function vacateSlot(u, s) {
  if (!s.slot) return;
  if (u.grid[s.slot.r][s.slot.f] === s.id) u.grid[s.slot.r][s.slot.f] = -1;
  s.slot = null;
}

export function fileDepth(u, f) {
  let n = 0;
  for (let r = 0; r < u.ranks; r++) if (u.grid[r][f] >= 0) n++;
  return n;
}

// Signed distance from my front rank to the enemy's front rank, along my facing.
export function frontDistance(u, e) {
  const fw = fwdOf(u.heading);
  return (e.anchor.x - u.anchor.x) * fw.x + (e.anchor.y - u.anchor.y) * fw.y;
}

function filesFromCentre(u) {
  const c = (u.files - 1) / 2;
  return [...Array(u.files).keys()].sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || b - a);
}

function slotOrder(u, preset) {
  const ranks = [...Array(u.ranks).keys()];
  let order = ranks;
  if (preset === 'rear') order = [...ranks].reverse();
  if (preset === 'xenophon') order = u.ranks > 1 ? [0, u.ranks - 1, ...ranks.slice(1, -1)] : ranks;
  const files = filesFromCentre(u);
  return order.flatMap((r) => files.map((f) => ({ f, r })));
}

// Put the unit's men into slots according to a placement preset.
export function arrange(world, u, preset) {
  for (const row of u.grid) row.fill(-1);
  const men = u.members.map((id) => world.soldiers[id]);
  const sorted = preset === 'random' ? world.rng.shuffle([...men]) : [...men].sort((a, b) => quality(b) - quality(a));
  const slots = slotOrder(u, preset);
  sorted.forEach((s, i) => {
    const { f, r } = slots[i];
    placeInSlot(u, s, f, r);
    const p = slotWorld(u, f, r);
    s.pos = { ...p };
    s.prev = { ...p };
    s.facing = u.heading;
  });
  chooseLeaders(world, u);
}

export function swapMen(world, u, a, b) {
  const sa = a.slot;
  const sb = b.slot;
  u.grid[sa.r][sa.f] = b.id;
  u.grid[sb.r][sb.f] = a.id;
  a.slot = sb;
  b.slot = sa;
  for (const s of [a, b]) {
    const p = slotWorld(u, s.slot.f, s.slot.r);
    s.pos = { ...p };
    s.prev = { ...p };
  }
}

export function chooseLeaders(world, u) {
  const candidates = u.members.map((id) => world.soldiers[id]).filter(isFormed).sort((a, b) => b.reputation - a.reputation);
  u.leaderId = candidates[0] ? candidates[0].id : -1;
  u.secondId = candidates[1] ? candidates[1].id : -1;
}

// The man who took over is told apart from the man who fell; the unit takes the shock.
export function handleLeaderLoss(world, u, lost, how) {
  if (lost.id === u.secondId) {
    const others = u.members.map((id) => world.soldiers[id])
      .filter((s) => isFormed(s) && s.id !== u.leaderId && s.id !== lost.id)
      .sort((a, b) => b.reputation - a.reputation);
    u.secondId = others[0] ? others[0].id : -1;
    return;
  }
  if (lost.id !== u.leaderId) return;
  const second = u.secondId >= 0 ? world.soldiers[u.secondId] : null;
  if (second && isFormed(second)) {
    u.leaderId = second.id;
    const others = u.members.map((id) => world.soldiers[id])
      .filter((s) => isFormed(s) && s.id !== second.id)
      .sort((a, b) => b.reputation - a.reputation);
    u.secondId = others[0] ? others[0].id : -1;
  } else {
    chooseLeaders(world, u);
  }
  const heir = u.leaderId >= 0 ? world.soldiers[u.leaderId] : null;
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (!isFormed(s)) continue;
    const near = dist(s.pos, lost.pos) < 6;
    shiftNerve(world, s, near ? -0.2 : -0.1, 'leader');
  }
  const verb = how === 'fled' ? 'has fled' : 'has fallen';
  logEvent(world, 'leader', `${u.adjective} leader ${lost.name} ${verb}.` + (heir ? ` ${heir.name} takes command.` : ' Nobody takes command.'), { unit: u.id });
}

const MOVABLE = new Set(['inRank', 'wavering', 'returning']);

// Losses close forward: the man behind steps into the gap, so files shorten from the back.
export function closeRanks(world, u) {
  for (let r = 0; r < u.ranks - 1; r++) {
    for (let f = 0; f < u.files; f++) {
      if (u.grid[r][f] !== -1) continue;
      for (let r2 = r + 1; r2 < u.ranks; r2++) {
        const s = occupant(world, u, f, r2);
        if (!s) continue;
        if (MOVABLE.has(s.state)) placeInSlot(u, s, f, r);
        break;
      }
    }
  }
  // Keep the front rank whole by borrowing a rear man from the deepest nearby file.
  for (let f = 0; f < u.files; f++) {
    if (u.grid[0][f] !== -1 || fileDepth(u, f) > 0) continue;
    let best = -1;
    let bestDepth = 1;
    let bestGap = 99;
    for (let g = 0; g < u.files; g++) {
      const d = fileDepth(u, g);
      const gap = Math.abs(g - f);
      if (d > bestDepth || (d === bestDepth && d >= 2 && gap < bestGap)) {
        best = g;
        bestDepth = d;
        bestGap = gap;
      }
    }
    if (best < 0) continue;
    for (let r = u.ranks - 1; r > 0; r--) {
      const s = occupant(world, u, best, r);
      if (!s) continue;
      if (MOVABLE.has(s.state)) placeInSlot(u, s, f, 0);
      break;
    }
  }
}

// The rearmost empty slot, for men coming back to the unit.
export function rearSlot(u) {
  const files = filesFromCentre(u);
  for (let r = u.ranks - 1; r >= 0; r--) {
    for (const f of files) if (u.grid[r][f] === -1) return { f, r };
  }
  return null;
}

// The man at the back of a file: the file-closer who keeps the men in front from running.
export function fileCloser(world, u, f) {
  for (let r = u.ranks - 1; r >= 0; r--) {
    const s = occupant(world, u, f, r);
    if (s) return s;
  }
  return null;
}
