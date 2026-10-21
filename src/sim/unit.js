import { TUNING } from './rules.js';
import { SIDES } from './names.js';
import { fwdOf, rightOf, angleWrap, isFormed, dist, shiftNerve, logEvent } from './core.js';
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
    // The ends of a line that overlaps the enemy wrap round onto his flank: how far each file
    // has gone round (0 straight, 1 fully round), and where it is going.
    curl: new Array(cfg.files).fill(0),
    curlTo: new Array(cfg.files).fill(null),
    // ...and the outermost file of a line being curled round turns its shields to face it:
    // how far it has turned (0 to 1), and to which side (+1 right, -1 left).
    refuse: new Array(cfg.files).fill(0),
    refuseSide: new Array(cfg.files).fill(0),
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
      depth: c.depth, // its own depth in ranks: a contingent could form deeper than the rest of the line
      cells: c.cells || null, // in a line filled file by file, the places that are its own
      unit: idx,
      village: c.village || null, // a village's own men, with a leader of their own
      stance: 'steady',
      // The man who leads it and his temper, if the battle gives it one: how readily he shouts his
      // men on (bold) and how readily he holds them back or takes them away (timid).
      leader: c.leader ? { ...c.leader } : null,
      leaderId: -1, // the man himself, in the line
      heir: c.heir || null, // his son or other natural successor, if he has marched with him
      heirVillageId: c.heirVillageId ?? null,
      heirId: -1,
      firstLeader: c.leader ? c.leader.name : null,
      leaders: [], // who led it, in turn, as men fell
      you: !!c.you, // led by the player, who decides for them
      stanceT: { steady: 0, provoke: 0, linger: 0, run: 0 },
      stanceAt: 0,
      heldUntil: 0,
      members: [],
      nerve: 1,
      stamina: 1,
      present: 0,
      running: 0,
    })),
    fileOwner: cfg.fileOwner || cfg.contingents.flatMap((c, index) => new Array(c.file1 - c.file0).fill(index)),
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
  let x = (f - (u.files - 1) / 2) * TUNING.fileSpacing;
  let y = -r * TUNING.rankSpacing;
  // A curled file stands down the enemy's flank: its front man beside the enemy's end, its
  // ranks trailing away outward.
  const fi = Math.max(0, Math.min(u.files - 1, Math.round(f)));
  const k = u.curl[fi];
  const to = u.curlTo[fi];
  if (k > 0 && to) {
    x += (to.x - to.fx * r * TUNING.rankSpacing - x) * k;
    y += (to.y - to.fy * r * TUNING.rankSpacing - y) * k;
  }
  return { x: u.anchor.x + rt.x * x + fw.x * y, y: u.anchor.y + rt.y * x + fw.y * y };
}

// Which way the men of file f face: the line's way, or turned in toward the enemy's flank.
export function headingAt(u, f) {
  const fi = Math.max(0, Math.min(u.files - 1, Math.round(f)));
  const k = u.curl[fi];
  const to = u.curlTo[fi];
  if (!(k > 0) || !to) return u.heading;
  const rt = rightOf(u.heading);
  const fw = fwdOf(u.heading);
  const inward = Math.atan2(rt.y * to.fx + fw.y * to.fy, rt.x * to.fx + fw.x * to.fy);
  return angleWrap(u.heading + k * angleWrap(inward - u.heading));
}

// Which way a man faces: his file's way, or the line's if he is out of it. In a file refusing
// its flank, the men turn outward where they stand, the front man half way.
export function facingOf(u, s) {
  if (!s.slot) return u.heading;
  const f = s.slot.f;
  const k = u.refuse[f];
  if (k > 0) {
    const rt = rightOf(u.heading);
    const out = Math.atan2(u.refuseSide[f] * rt.y, u.refuseSide[f] * rt.x);
    return angleWrap(u.heading + k * (s.slot.r === 0 ? 0.5 : 1) * angleWrap(out - u.heading));
  }
  return headingAt(u, f);
}

// The two men either side of a man along the way he faces: in his rank, or, once his file has
// turned to refuse the flank, the men in front of and behind him in his file.
export function sideNeighbours(world, u, s) {
  const { f, r } = s.slot;
  return u.refuse[f] > 0.5 && r > 0
    ? [occupant(world, u, f, r - 1), occupant(world, u, f, r + 1)]
    : [occupant(world, u, f - 1, r), occupant(world, u, f + 1, r)];
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

// How many ranks deep file f stands: its contingent's depth.
export function depthAt(u, f) {
  return u.contingents[u.fileOwner[f]].depth;
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
  const ranks = [...Array(c.depth).keys()];
  let order = ranks;
  if (preset === 'rear') order = [...ranks].reverse();
  if (preset === 'xenophon') order = c.depth > 1 ? [0, c.depth - 1, ...ranks.slice(1, -1)] : ranks;
  // A contingent sharing files with its neighbours: its own places, the best men to the ranks the
  // placement wants them in, from the middle of its block outward.
  if (c.cells) {
    const mid = (c.file0 + c.file1 - 1) / 2;
    return [...c.cells].sort((a, b) => order.indexOf(a.r) - order.indexOf(b.r) || Math.abs(a.f - mid) - Math.abs(b.f - mid) || b.f - a.f);
  }
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
      for (const f of files) if (r < depthAt(u, f) && u.grid[r][f] === -1) return { f, r };
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
