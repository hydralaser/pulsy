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
    give: new Array(cfg.files).fill(0), // how far each file's front man has been driven back (negative: pressed forward)
    members: [],
    // The contingents of the phalanx: the men of a tribe or a city fall into the line together,
    // each contingent holding a block of files, left to right. The phalanx still fights as one
    // body under one commander; a contingent only decides where a man stands, and with whom.
    contingents: cfg.contingents.map((c, index) => ({
      index,
      name: c.name,
      quality: c.quality,
      kit: c.kit,
      origins: c.origins,
      file0: c.file0,
      file1: c.file1,
      members: [],
      nerve: 1,
      stamina: 1,
      present: 0,
      running: 0,
    })),
    fileOwner: cfg.contingents.flatMap((c, index) => new Array(c.file1 - c.file0).fill(index)),
    anchor: { ...anchor }, // centre of the front rank
    heading,
    turn: 0,
    order: 'hold',
    mode: 'formed', // formed | withdrawing | routed | pursuing
    cohesion: 1, // how well the men keep their places: lost by running, regained standing still
    charging: false,
    counterCharge: false,
    bracing: false,
    reacted: false,
    routDistance: null,
    ai: cfg.ai !== false,
    leaderId: -1,
    secondId: -1,
    surgeCallT: 0,
    haltCallT: 0,
    yielding: false, // giving ground in order, refusing the fight
    yieldT: 0,
    haltCooldown: 0,
    momentum: 0, // recent success: kills raise it, losses lower it
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

export function contingentOf(world, s) {
  return world.units[s.unit].contingents[s.contingent];
}

// A contingent's files, from the middle of its block outward.
function filesFromCentre(c) {
  const mid = (c.file0 + c.file1 - 1) / 2;
  const files = [];
  for (let f = c.file0; f < c.file1; f++) files.push(f);
  return files.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || b - a);
}

function slotOrder(u, c, preset) {
  const ranks = [...Array(u.ranks).keys()];
  let order = ranks;
  if (preset === 'rear') order = [...ranks].reverse();
  if (preset === 'xenophon') order = u.ranks > 1 ? [0, u.ranks - 1, ...ranks.slice(1, -1)] : ranks;
  const files = filesFromCentre(c);
  return order.flatMap((r) => files.map((f) => ({ f, r })));
}

// Put the unit's men into slots according to a placement preset, each contingent in its block.
export function arrange(world, u, preset) {
  for (const row of u.grid) row.fill(-1);
  for (const c of u.contingents) {
    const men = c.members.map((id) => world.soldiers[id]);
    const sorted = preset === 'random' ? world.rng.shuffle([...men]) : [...men].sort((a, b) => quality(b) - quality(a));
    const slots = slotOrder(u, c, preset);
    sorted.forEach((s, i) => {
      const { f, r } = slots[i];
      placeInSlot(u, s, f, r);
      s.startRank = r;
      const p = slotWorld(u, f, r);
      s.pos = { ...p };
      s.prev = { ...p };
      s.lag = { ...p };
      s.facing = u.heading;
    });
  }
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
    s.startRank = s.slot.r;
    const p = slotWorld(u, s.slot.f, s.slot.r);
    s.pos = { ...p };
    s.prev = { ...p };
    s.lag = { ...p };
  }
}

// The commander is the most respected man in the phalanx.
export function chooseLeaders(world, u) {
  const all = u.members.map((id) => world.soldiers[id]).filter(isFormed).sort((a, b) => b.reputation - a.reputation);
  u.leaderId = all[0] ? all[0].id : -1;
  u.secondId = all[1] ? all[1].id : -1;
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
  if (u.mode === 'routed') {
    // In a rout nobody is taking command any more.
    u.leaderId = -1;
    u.secondId = -1;
    return;
  }
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
  // Losing a leader is a blow; losing his successor moments later adds less on top.
  const repeat = u.leaderShockT != null && world.t - u.leaderShockT < 20 ? 0.3 : 1;
  u.leaderShockT = world.t;
  for (const id of u.members) {
    const s = world.soldiers[id];
    if (!isFormed(s)) continue;
    const near = dist(s.pos, lost.pos) < 6;
    shiftNerve(world, s, (near ? -0.18 : -0.06) * repeat, 'leader');
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
  // Keep the front rank whole by borrowing a rear man from the deepest nearby file: from his
  // own contingent if it has men to spare, from the files beside it if not.
  const deepest = (f, g0, g1) => {
    let best = -1;
    let bestDepth = 1;
    let bestGap = 99;
    for (let g = g0; g < g1; g++) {
      const d = fileDepth(u, g);
      const gap = Math.abs(g - f);
      if (d > bestDepth || (d === bestDepth && d >= 2 && gap < bestGap)) {
        best = g;
        bestDepth = d;
        bestGap = gap;
      }
    }
    return best;
  };
  for (let f = 0; f < u.files; f++) {
    if (u.grid[0][f] !== -1 || fileDepth(u, f) > 0) continue;
    const c = u.contingents[u.fileOwner[f]];
    let best = deepest(f, c.file0, c.file1);
    if (best < 0) best = deepest(f, 0, u.files);
    if (best < 0) continue;
    for (let r = u.ranks - 1; r > 0; r--) {
      const s = occupant(world, u, best, r);
      if (!s) continue;
      if (MOVABLE.has(s.state)) placeInSlot(u, s, f, 0);
      break;
    }
  }
}

// The rearmost empty slot, for men coming back to the unit: among his own contingent's files
// if there is room, anywhere in the line if not.
export function rearSlot(u, cIndex) {
  const c = u.contingents[cIndex];
  const own = c ? filesFromCentre(c) : [];
  for (const files of [own, filesFromCentre({ file0: 0, file1: u.files })]) {
    for (let r = u.ranks - 1; r >= 0; r--) {
      for (const f of files) if (u.grid[r][f] === -1) return { f, r };
    }
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
