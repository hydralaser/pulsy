// Runs many seeded battles with no graphics and prints how they went.
// Usage: node tools/headless.js [battles] [blueFiles] [redFiles] [bluePlacement] [redPlacement]
import { createBattle, runToEnd, DEFAULT_CONFIG } from '../src/sim/world.js';

const [n = 100, bf, rf, bp, rp] = process.argv.slice(2);
const N = Number(n);

function run(sideOverrides) {
  const rows = [];
  for (let i = 0; i < N; i++) {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    cfg.seed = 1000 + i;
    cfg.sides.forEach((s, k) => Object.assign(s, sideOverrides[k]));
    const world = createBattle(cfg);
    const r = runToEnd(world);
    rows.push({ r, world });
  }
  return rows;
}

function pct(x) { return (100 * x).toFixed(0) + '%'; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function summarise(label, rows) {
  const types = {};
  const wins = [0, 0];
  for (const { r } of rows) {
    types[r.type] = (types[r.type] || 0) + 1;
    if (r.winner >= 0) wins[r.winner]++;
  }
  const decided = rows.filter(({ r }) => r.contactAt != null);
  const dur = decided.map(({ r }) => r.duration);
  const pulses = decided.map(({ r }) => r.pulses);
  const loserFight = [], loserPursuit = [], winnerDead = [];
  for (const { r } of rows) {
    if (r.type !== 'rout') continue;
    const L = r.sides[r.loser], W = r.sides[r.winner];
    loserFight.push(L.killedFight / L.start);
    loserPursuit.push(L.killedPursuit / L.start);
    winnerDead.push((W.killedFight + W.killedPursuit) / W.start);
  }
  dur.sort((a, b) => a - b);
  console.log(`\n== ${label} (${rows.length} battles)`);
  console.log(`endings: ${Object.entries(types).map(([k, v]) => `${k} ${pct(v / rows.length)}`).join(', ')}`);
  console.log(`wins: Athenians ${wins[0]}, Boeotians ${wins[1]}`);
  console.log(`contact to decision: median ${dur[Math.floor(dur.length / 2)]?.toFixed(0)}s, 10-90% ${dur[Math.floor(dur.length * 0.1)]?.toFixed(0)}-${dur[Math.floor(dur.length * 0.9)]?.toFixed(0)}s`);
  console.log(`surges per battle: mean ${mean(pulses).toFixed(1)}, min ${Math.min(...pulses)}, max ${Math.max(...pulses)}`);
  console.log(`in routs, loser dead: ${pct(mean(loserFight))} in the fight + ${pct(mean(loserPursuit))} in pursuit; winner dead ${pct(mean(winnerDead))}`);
  const charged = rows.filter(({ r }) => r.charges.some((c) => !c.counter)).length;
  const countered = rows.filter(({ r }) => r.charges.some((c) => c.counter)).length;
  console.log(`charges: ${pct(charged / rows.length)} of battles, counter-charged ${pct(countered / Math.max(1, charged))} of those`);
  const early = rows.filter(({ r }) => r.beforeContact && r.type === 'rout');
  if (early.length) {
    const front = early.reduce((a, { r }) => a + r.sides[r.loser].deadFront, 0);
    const rear = early.reduce((a, { r }) => a + r.sides[r.loser].deadRear, 0);
    const dists = early.map(({ r }) => Math.round(r.routDistance)).sort((a, b) => a - b);
    console.log(`broke before contact: ${pct(early.length / rows.length)} (at ${dists.join(', ')} m); their dead from the front rank ${front}, rear rank ${rear}`);
  } else {
    console.log('broke before contact: none');
  }
  const other = rows.filter(({ r }) => r.type !== 'rout').map(({ r }) => (r.sides[0].killedFight + r.sides[1].killedFight) / (r.sides[0].start + r.sides[1].start));
  console.log(`in withdrawals and standoffs, dead per side: ${pct(mean(other))}`);
}

summarise('default', run([{ ...(bf && { files: Number(bf) }), ...(bp && { placement: bp }) }, { ...(rf && { files: Number(rf) }), ...(rp && { placement: rp }) }]));
