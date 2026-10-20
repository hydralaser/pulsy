// Sends villages to war with no graphics: each runs to its first summons, sends a share of its
// men, fights the battle with the AI and the given stance for its own contingent, and takes home
// what happened. Prints how each went.
// Usage: node tools/campaign.js [villages] [share] [stance: steady|provoke|run]
import { createVillage, stepVillage } from '../src/village/village.js';
import { answerSummons, battleSetup, applyBattle } from '../src/village/war.js';
import { createBattle, startBattle, stepBattle, runToEnd } from '../src/sim/world.js';
import { applyInput } from '../src/sim/record.js';

const [n = 10, share = 0.3, stance = 'steady'] = process.argv.slice(2);
const tally = {};
let sent = 0;
let dead = 0;
let commands = 0;
for (let i = 0; i < Number(n); i++) {
  const v = createVillage(100 + i, 'Philon');
  while (!v.war.summons) stepVillage(v, 24);
  answerSummons(v, Number(share));
  while (v.war.campaign && v.war.campaign.stage !== 'battle') stepVillage(v, 24);
  if (!v.war.campaign) continue;
  const { config, campaign } = battleSetup(v);
  const w = createBattle(config);
  startBattle(w);
  if (stance !== 'steady' && campaign.contingent != null) {
    // Run once the lines have met; shout them on from the start.
    while (!w.result && (stance === 'run' ? w.firstContactT == null || w.t < w.firstContactT + 10 : w.t < 1)) stepBattle(w);
    if (!w.result) applyInput(w, { type: 'stance', unit: 0, contingent: campaign.contingent, stance });
  }
  runToEnd(w, 30);
  const out = applyBattle(v, w.result);
  const mine = w.result.villagers;
  sent += mine.length;
  dead += out.dead.length;
  if (campaign.role === 'commander') commands++;
  tally[out.conduct] = (tally[out.conduct] || 0) + 1;
  console.log(`${String(100 + i).padStart(4)} ${campaign.role.padEnd(9)} ${String(mine.length).padStart(2)} sent ${String(out.dead.length).padStart(2)} dead ${String(out.hurt.length).padStart(2)} hurt  ${out.conduct.padEnd(12)} ${w.result.headline}`);
  for (const sd of w.result.sides) for (const x of sd.contingents) if (x.leaders && x.leaders.length > 1) console.log(`      ${x.name}: led by ${x.leaders.join(' then ')}${x.leaderLost ? ` (${x.leaderLost.name} ${x.leaderLost.fate})` : ''}`);
  const shares = (x) => {
    const t = Object.values(x.stanceT).reduce((p, q) => p + q, 0) || 1;
    return ['provoke', 'linger', 'run'].map((k) => (x.stanceT[k] ? `${k[0]}${Math.round((100 * x.stanceT[k]) / t)}` : '')).filter(Boolean).join('/') || 'steady';
  };
  console.log('      ' + w.result.sides.map((sd) => sd.contingents.map((x) => `${x.name}${x.leader ? `(${x.leader.bold.toFixed(1)}/${x.leader.timid.toFixed(1)})` : ''}:${shares(x)}`).join(' ')).join(' | ') + (out.praised ? '  PRAISED' : '') + (out.hero ? `  HERO ${out.hero.name}` : ''));
}
console.log(`\n${sent} men sent, ${dead} killed (${Math.round((100 * dead) / Math.max(1, sent))}%). Commanded ${commands} times. Conduct: ${JSON.stringify(tally)}`);
