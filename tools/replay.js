// Replays a battle record copied from the page ("Copy battle record") and prints an account of
// the battle: setup, the player's orders, the log, a timeline of both sides, and why it ended.
// Usage: node tools/replay.js record.json
import { readFileSync } from 'node:fs';
import { SIM_VERSION } from '../src/sim/rules.js';
import { replay } from '../src/sim/record.js';
import { SIDES } from '../src/sim/names.js';
import { normaliseSide } from '../src/sim/world.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node tools/replay.js record.json');
  process.exit(1);
}
const record = JSON.parse(readFileSync(path, 'utf8'));
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);

let timeline = record.timeline;
let events = record.events;
let result = record.result;

console.log(`Battle record from ${record.pulsy}, seed ${record.config.seed}, taken at ${clock(record.step * 0.05)}.`);
if (record.pulsy === SIM_VERSION) {
  const world = replay(record);
  const replayed = world.events.map((e) => [Math.round(e.t * 10) / 10, e.kind, e.text]);
  const same = JSON.stringify(replayed) === JSON.stringify(record.events);
  console.log(same
    ? 'Replayed exactly: every event matches the record.'
    : 'WARNING: the replay drifted from the record; trust the recorded timeline over the replay.');
  if (same) {
    timeline = world.timeline;
    events = replayed;
    result = world.result;
  }
} else {
  console.log(`The simulation has changed since (now ${SIM_VERSION}), so this is the recorded account, not a replay.`);
}

console.log('\nSETUP');
record.config.sides.map(normaliseSide).forEach((s, i) => {
  const men = s.contingents.reduce((a, c) => a + c.count, 0);
  console.log(`  ${SIDES[i].name}: ${men} men, ${s.depth} deep, placement "${s.placement}", ${s.ai === false ? 'commanded by the player' : 'commanded by the AI'}`);
  if (s.lights && s.lights.count) console.log(`    with ${s.lights.count} ${s.lights.quality || 'regular'} peltasts`);
  if (s.contingents.length > 1) {
    for (const c of s.contingents) console.log(`    ${c.name}: ${c.count} men, ${c.quality}, ${c.kit} kit`);
  }
});
const swaps = record.inputs.filter((x) => x.type === 'swap');
if (swaps.length) console.log(`  ${swaps.length} men swapped places before the battle.`);

const orders = record.inputs.filter((x) => x.type !== 'swap');
if (orders.length) {
  console.log('\nPLAYER ORDERS');
  for (const o of orders) {
    const what = o.type === 'turn' ? (o.value ? `wheel ${o.value < 0 ? 'left' : 'right'}` : 'stop wheeling') : o.name;
    console.log(`  ${clock(o.step * 0.05)}  ${what}`);
  }
}

console.log('\nLOG (deaths summarised)');
let deaths = 0;
for (const [t, kind, text] of events) {
  if (kind === 'death') {
    deaths++;
    continue;
  }
  if (deaths) {
    console.log(`         (${deaths} killed)`);
    deaths = 0;
  }
  console.log(`  ${clock(t)}  ${text}`);
}
if (deaths) console.log(`         (${deaths} killed)`);

// Each contingent's nerve and men in line, when a side has more than one.
const contingentsOf = (u) => (u.contingents && u.contingents.length > 1
  ? ' [' + u.contingents.map((c) => `${c.name} ${pct(c.nerve).trim()} ${c.inLine}`).join(', ') + ']'
  : '');
console.log('\nTIMELINE (every 10 s; nerve / stamina / cohesion, men in line, dead, wounded, running, eagerness of the rear, spent front-rank men)');
const names = SIDES.map((s) => s.short.slice(0, 4));
timeline.forEach((snap, i) => {
  if (i % 2 && i !== timeline.length - 1) return;
  const parts = snap.units.map((u, k) => {
    const state = u.mode !== 'formed' ? u.mode : u.yielding ? 'yielding' : u.order;
    return `${names[k]} ${pct(u.nerve)}/${pct(u.stamina)}/${pct(u.cohesion)} line ${String(u.inLine).padStart(2)} dead ${String(u.dead).padStart(2)} wnd ${String(u.wounded).padStart(2)} run ${String(u.running).padStart(2)} eager ${pct(u.rearEager)} spent ${u.frontSpent} ${state}${contingentsOf(u)}`;
  });
  console.log(`  ${clock(snap.t)} gap ${String(snap.gap).padStart(5)}m ${snap.pulse ? 'FIGHT' : '     '} | ${parts.join(' | ')}`);
});

if (result) {
  console.log(`\nRESULT: ${result.headline}`);
  if (result.why) console.log(`WHY: ${result.why}`);
} else {
  console.log('\nThe battle was still going when the record was taken.');
}
const last = timeline[timeline.length - 1];
if (last) {
  console.log('\nWHAT WORE EACH SIDE DOWN (nerve lost per man, whole battle)');
  last.units.forEach((u, k) => {
    const top = Object.entries(u.causes).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}`).join(', ');
    console.log(`  ${SIDES[k].short}: ${top}`);
  });
}
