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
    // The contingents standing side by side in this phalanx, left to right, each holding a block
    // of files: [{ index, name, quality, kit, file0, file1, members, leaderId, mode, ... }].
    contingents: cfg.contingents.map((c, index) => ({
      index,
      name: c.name,
      quality: c.quality,
      kit: c.kit,
      origins: c.origins,
      file0: c.file0,
      file1: c.file1,
      members: [],
      leaderId: -1,
      secondId: -1,
      // Each contingent answers to its own leader: its orders, its charge and its ground are its
      // own, and it can fall out of step with the contingents beside it.
      ai: cfg.lead !== index,
      mode: 'formed', // formed | withdrawing | out (withdrawn off the field) | pursuing | routed
      order: 'hold',
      shift: 0, // how far this contingent stands forward of the side's line
      // A contingent that has left the line to take an enemy in the flank stands on its own
      // ground and faces its own way: { x, y, heading } of the middle of its front rank.
      frame: null,
      flank: null, // { target: enemy contingent index, phase: 'moving' | 'closing' }
      idleT: 0, // how long it has had nobody in front of it
      loathLogged: false,
      ground: 0, // how far it has moved forward since the start
      speed: 0,
      cohesion: 1,
      charging: false,
      counterCharge: false,
      bracing: false,
      reacted: false,
      followedCharge: false,
      surgeCallT: 0,
      surgeCooldown: 8,
      haltCallT: 0,
      haltCooldown: 0,
      lastHaltT: null,
      yielding: false,
      yieldT: 0,
      yieldLogT: null,
      followT: 0,
      withdrawReason: null,
      withdrawNote: null,
      heldOnLogged: false,
      flankLogged: false,
      inContact: false,
      contacted: false,
      d: Infinity, // distance to the enemy front facing it
      facing: -1, // the enemy contingent facing it
      impactT: null,
      aiT: 0.1 * index,
      pursuitT: 0,
      pursued: false,
      history: [], // what it was doing, half-second by half-second, for word to travel down the line
      heard: [null, null], // what its commander last heard of the contingents to his left and right
      routT: null,
      routNote: null,
      outT: null,
      nerve: 1,
      stamina: 1,
      present: 0,
      running: 0,
      wavering: 0,
    })),
    lead: cfg.lead ?? -1, // the contingent the player leads
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
    ai: (cfg.lead ?? -1) < 0, // no contingent on this side is the player's
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
  const c = u.contingents[u.fileOwner[Math.max(0, Math.min(u.files - 1, Math.round(f)))]];
  if (c && c.frame) {
    const fw = fwdOf(c.frame.heading);
    const rt = rightOf(c.frame.heading);
    const x = (f - (c.file0 + c.file1 - 1) / 2) * TUNING.fileSpacing;
    const y = -r * TUNING.rankSpacing;
    return { x: c.frame.x + rt.x * x + fw.x * y, y: c.frame.y + rt.y * x + fw.y * y };
  }
  const fw = fwdOf(u.heading);
  const rt = rightOf(u.heading);
  const x = (f - (u.files - 1) / 2) * TUNING.fileSpacing;
  const y = -r * TUNING.rankSpacing + (c ? c.shift : 0);
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

// The way a contingent faces: the line's, or its own once it has left the line.
export function headingOf(u, c) {
  return c.frame ? c.frame.heading : u.heading;
}

// The middle of a contingent's front rank.
export function frontCentre(u, c) {
  return c.frame ? { x: c.frame.x, y: c.frame.y } : slotWorld(u, (c.file0 + c.file1 - 1) / 2, 0);
}

// Where c would have to stand, and which way face, to take enemy contingent ec in the flank:
// beside whichever end of ec has no friends next to it. Null if both ends are covered.
export function flankGoal(u, c, e, ec) {
  const T = TUNING;
  const ert = rightOf(e.heading);
  const mid = (e.ranks - 1) / 2;
  const open = (k) => {
    const n = e.contingents[k];
    return !n || n.mode === 'routed' || n.mode === 'out' || n.mode === 'pursuing' || !!n.frame;
  };
  const ends = [];
  if (open(ec.index - 1)) ends.push({ p: slotWorld(e, ec.file0, mid), out: { x: -ert.x, y: -ert.y } });
  if (open(ec.index + 1)) ends.push({ p: slotWorld(e, ec.file1 - 1, mid), out: { x: ert.x, y: ert.y } });
  const here = frontCentre(u, c);
  let best = null;
  for (const { p, out } of ends) {
    const stand = T.gap + 0.4;
    const goal = { x: p.x + out.x * stand, y: p.y + out.y * stand, heading: Math.atan2(-out.y, -out.x) };
    goal.dist = dist(here, goal);
    if (!best || goal.dist < best.dist) best = goal;
  }
  return best;
}

// The nearest enemy contingent still in the line that c could take in the flank.
export function flankTarget(u, c, e) {
  let best = null;
  for (const ec of e.contingents) {
    if ((ec.mode !== 'formed' && ec.mode !== 'withdrawing') || ec.frame || ec.present === 0) continue;
    const goal = flankGoal(u, c, e, ec);
    if (goal && goal.dist < TUNING.flankRange && (!best || goal.dist < best.goal.dist)) best = { ec, goal };
  }
  return best;
}

// What to call a contingent in the log: its own name, or the side's when it is the whole line.
export function nameOf(u, c) {
  return u.contingents.length > 1 ? c.name : u.short;
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

// The overall commander is the most respected man in the phalanx; each contingent also has
// its own leader, who passes his orders on to his men.
export function chooseLeaders(world, u) {
  const byRep = (ids) => ids.map((id) => world.soldiers[id]).filter(isFormed).sort((a, b) => b.reputation - a.reputation);
  const all = byRep(u.members);
  u.leaderId = all[0] ? all[0].id : -1;
  u.secondId = all[1] ? all[1].id : -1;
  for (const c of u.contingents) chooseContingentLeader(world, c);
}

function chooseContingentLeader(world, c) {
  const men = c.members.map((id) => world.soldiers[id]).filter(isFormed).sort((a, b) => b.reputation - a.reputation);
  c.leaderId = men[0] ? men[0].id : -1;
  c.secondId = men[1] ? men[1].id : -1;
}

// A contingent that loses its own leader is shaken and its second takes over.
function handleContingentLeaderLoss(world, u, c, lost, how) {
  if (lost.id === c.secondId) {
    const men = c.members.map((id) => world.soldiers[id]).filter((s) => isFormed(s) && s.id !== c.leaderId && s.id !== lost.id);
    men.sort((a, b) => b.reputation - a.reputation);
    c.secondId = men[0] ? men[0].id : -1;
    return;
  }
  if (lost.id !== c.leaderId || c.mode === 'routed' || u.mode === 'routed') return;
  // When the player's own man falls, his second takes the contingent over.
  const wasYou = !c.ai;
  c.ai = true;
  const second = c.secondId >= 0 ? world.soldiers[c.secondId] : null;
  if (second && isFormed(second)) {
    c.leaderId = second.id;
    const men = c.members.map((id) => world.soldiers[id]).filter((s) => isFormed(s) && s.id !== second.id);
    men.sort((a, b) => b.reputation - a.reputation);
    c.secondId = men[0] ? men[0].id : -1;
  } else {
    chooseContingentLeader(world, c);
  }
  if (wasYou) {
    const heir = c.leaderId >= 0 ? world.soldiers[c.leaderId] : null;
    logEvent(world, 'leader', `You ${how === 'fled' ? 'have fled' : 'have fallen'}. ` + (heir ? `${heir.name}, your second, takes the ${nameOf(u, c)} over.` : `Nobody takes the ${nameOf(u, c)} over.`), { unit: u.id });
  }
  if (lost.id === u.leaderId) return; // the overall commander's loss is felt by everyone below
  for (const id of c.members) {
    const s = world.soldiers[id];
    if (!isFormed(s)) continue;
    shiftNerve(world, s, dist(s.pos, lost.pos) < 6 ? -0.12 : -0.04, 'leader');
  }
  if (u.contingents.length > 1 && !wasYou) {
    const heir = c.leaderId >= 0 ? world.soldiers[c.leaderId] : null;
    logEvent(world, 'leader', `${lost.name}, who led the ${c.name}, ${how === 'fled' ? 'has fled' : 'has fallen'}.` + (heir ? ` ${heir.name} takes them over.` : ''), { unit: u.id });
  }
}

// The man who took over is told apart from the man who fell; the unit takes the shock.
export function handleLeaderLoss(world, u, lost, how) {
  const c = u.contingents[lost.contingent];
  if (c) handleContingentLeaderLoss(world, u, c, lost, how);
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
  // Keep the front rank whole by borrowing a rear man from the deepest nearby file of the
  // same contingent. A contingent that has broken leaves its files empty: a hole in the line.
  for (let f = 0; f < u.files; f++) {
    if (u.grid[0][f] !== -1 || fileDepth(u, f) > 0) continue;
    const c = u.contingents[u.fileOwner[f]];
    if (c.mode === 'routed') continue;
    let best = -1;
    let bestDepth = 1;
    let bestGap = 99;
    for (let g = c.file0; g < c.file1; g++) {
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

// The rearmost empty slot in a man's own contingent, for men coming back to the unit.
export function rearSlot(u, cIndex) {
  const c = u.contingents[cIndex];
  if (!c || c.mode === 'routed') return null;
  const files = filesFromCentre(c);
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
