import { SACK, BUILD, ECONOMY, MONTHS, SMITH } from './rules.js';
import { clamp } from '../sim/core.js';
import { logNews, monthOf } from './clock.js';
import { aliveHouseholds } from './economy.js';
import { villageRng, canFight } from './people.js';
import { insideWall } from './public.js';
import { planForge } from './building.js';
import { siteOf } from './land.js';
import { die } from './life.js';
import { kitOf, kitPieces } from './smith.js';

// When a battle for Oinoe itself is lost, the enemy comes to the village. The people choose: flee to
// the hills, and come back to a razed town with what they buried; or hold the walls, losing all
// that lies outside them, and live behind them until the enemy goes home in the autumn to sow its
// own fields, or has lost too many men under the walls to stay.

// ---- what a summons is for ----

const ATHENIAN_DEMES = ['Phyle', 'Dekeleia', 'Aphidna', 'Eleusis', 'Thria', 'Acharnai', 'Eleutherai'];
const BOEOTIAN_DEMES = ['Tanagra', 'Hysiai', 'Erythrai', 'Skolos', 'Oropos', 'Delion'];

export function summonsKind(rng) {
  const r = rng.next();
  if (r < SACK.odds.home) return 'home';
  if (r < SACK.odds.home + SACK.odds.deme) return 'deme';
  if (r < SACK.odds.home + SACK.odds.deme + SACK.odds.raid) return 'raid';
  return 'battle';
}

// Where the army is going, and why, for each kind of summons.
export function summonsAim(v, rng, kind, general) {
  if (kind === 'home') return { place: v.name, reason: `the Boeotians are marching on ${v.name} itself, and he means to meet them before they reach it` };
  if (kind === 'deme') {
    const place = rng.pick(ATHENIAN_DEMES.filter((d) => d !== v.name));
    return { place, reason: `the Boeotians are over the border raiding ${place}, and he means to drive them off before they carry everything away` };
  }
  if (kind === 'raid') {
    const place = rng.pick(BOEOTIAN_DEMES);
    return { place, reason: `he is taking the army over the border to raid the Boeotian lands about ${place}, and every man who goes will have his share of what is carried off` };
  }
  return null;
}

// What a deme like Oinoe has that a raiding army could carry off: its grain, its wood, its wool
// and cloth, its flock. A raid on a Boeotian deme that succeeds takes about this much.
export function plunderOf(v) {
  let kg = 0;
  for (const h of aliveHouseholds(v)) {
    const s = h.stores;
    kg += s.grain + s.wood * v.prices.wood + s.wool * v.prices.wool + s.cloth * v.prices.cloth + h.sheep * ECONOMY.value.sheep;
  }
  return Math.round(kg * SACK.plunder);
}

// ---- the enemy at the gates ----

export function startSack(v, army, why) {
  v.war.sack = { day: v.day, army: Math.max(10, Math.round(army)), why };
  logNews(v, 'alarm', `${why} The Boeotians are coming to ${v.name}, ${v.war.sack.army} of them. Flee to the hills with what you can carry and come back to whatever they leave, or shut the gate and hold the walls until they go home.`, { pause: true });
}

// Your choice, or the people's own if you do not make one in time: they flee.
export function chooseSack(v, choice, lapsed = false) {
  const s = v.war.sack;
  if (!s) return;
  v.war.sack = null;
  const rng = villageRng(v);
  if (choice === 'walls') {
    raze(v, true);
    v.siege = { army: s.army, start: s.army, began: v.day, lost: 0, killed: 0, assaults: 0, next: v.day + rng.int(SACK.every[1] - SACK.every[0]) + SACK.every[0] };
    logNews(v, 'alarm', `The gate is shut. Everything outside the walls is lost: the fields trampled and burned, the flock and the oxen driven off or killed, every house outside burned. ${v.name} holds out behind its walls, ${defenders(v).length} men to man them, until the Boeotians go home.`, { pause: true });
    return;
  }
  raze(v, false);
  logNews(v, 'alarm', `${lapsed ? 'With no word from you the people flee' : 'The people flee'} to the hills with what they can carry, and burying what they can. They come back to a razed town: every house burned, the fields trampled, the flock and the oxen gone${v.smith ? ', the forge broken' : ''}. Each house has a tenth of what it had, dug up from where it was buried, to begin again with.`, { pause: true });
}

// Burned and carried off: the whole town if the people fled, or what lies outside the walls if they
// held them. Each house burned is to be built again on its own plot, from what the house has left.
function raze(v, holding) {
  const lost = (p) => !holding || !insideWall(v, p);
  for (const h of aliveHouseholds(v)) {
    const hs = v.land.houses[h.house];
    if (!hs || !lost(hs)) continue;
    for (const k of Object.keys(h.stores)) h.stores[k] *= SACK.keep;
    if (hs.built) {
      hs.built = false;
      hs.razed = v.day;
      rebuild(v, h);
    }
  }
  // Empty houses burn with the rest.
  for (const hs of v.land.houses) if (hs.built && lost(hs) && !aliveHouseholds(v).some((h) => v.land.houses[h.house] === hs)) {
    hs.built = false;
    hs.razed = v.day;
  }
  // New houses going up outside the walls are burned too, and begin again.
  for (const x of v.projects || []) if (x.kind === 'house' && lost(v.land.houses[x.plot])) Object.assign(x.done, { work: 0, stone: 0, wood: 0 });
  if (!holding) v.common.grain *= SACK.keep;
  // The fields lie outside the walls: what was ploughed, sown or growing is trampled and burned.
  for (const f of v.land.fields) Object.assign(f, { state: 'stubble', ploughed: 0, sown: 0, weeded: 0, reaped: 0, crop: 0, ripeDays: 0 });
  // The flock and the oxen, out on the hills and in the fold, are driven off or killed, and the
  // carts burned.
  for (const h of v.households) h.sheep = 0;
  v.flock.head = 0;
  v.flock.ewes = 0;
  v.yokes = [];
  v.cartOwners = [];
  // The forge, outside the gate unless a wall has been built round it, is broken.
  if (v.smith && lost(SMITH.site) && !v.smith.ruined) {
    v.smith.ruined = true;
    v.smith.iron *= SACK.keep;
    v.smith.bronze *= SACK.keep;
    planForge(v, v.smith.house, v.smith.man);
  }
  if (v.tower) v.tower = null;
}

// A house burned is built again where it stood, by its own house, from its own stores.
function rebuild(v, h) {
  if ((v.projects || []).some((x) => x.kind === 'house' && x.plot === h.house)) return;
  const x = { id: v.nextProjectId++, kind: 'house', plot: h.house, sponsor: h.id, needs: { ...BUILD.house }, done: { work: 0, stone: 0, wood: 0 }, started: v.day, name: `the house of ${h.name}, rebuilt` };
  v.projects.push(x);
  if (!h.player) h.plan = { kind: 'build', half: 'm', since: v.day, project: x.id };
}

// ---- the siege ----

// The men who can stand on the wall, and what they are worth there.
export function defenders(v) {
  return v.people.filter((p) => p.alive && !p.away && canFight(v, p) && p.health > 0.3);
}

function strength(v) {
  return defenders(v).reduce((a, p) => {
    const kit = kitPieces(p).length ? kitPieces(p).reduce((b, k) => b + kitOf(p)[k], 0) / kitPieces(p).length : 0.5;
    return a + (0.5 + (p.skill ?? 0.4)) * (0.5 + (p.courage ?? 0.5)) * (0.6 + 0.4 * kit) * p.health;
  }, 0);
}

// Each day of the siege: now and then the enemy tries the walls. A man on the wall is worth ten
// below it; an army that loses enough men gives up, and in the autumn every army goes home to sow.
export function siegeDay(v) {
  const s = v.siege;
  if (!s) return;
  const rng = villageRng(v);
  if (monthOf(v) === 0 && v.day - s.began >= 5) return lift(v, `It is ${MONTHS[0].name}, and the Boeotians go home to sow their own fields.`);
  if (v.day < s.next) return;
  s.next = v.day + SACK.every[0] + rng.int(SACK.every[1] - SACK.every[0]);
  s.assaults++;
  const men = defenders(v);
  const eff = strength(v);
  // Too few on the wall to hold it even ten to one: it is carried.
  if (s.army > SACK.advantage * eff) {
    const killed = men.filter(() => rng.chance(SACK.carried));
    for (const p of killed) die(v, p, 'the fall of the walls');
    raze(v, false);
    v.siege = null;
    logNews(v, 'alarm', `The Boeotians carried the wall: too few men were left to hold it. ${killed.length ? `${killed.map((p) => p.name).join(', ')} ${killed.length > 1 ? 'were' : 'was'} killed on it. ` : ''}The town is sacked and burned; the people who got away come back to ruins.`, { pause: true });
    return;
  }
  const theirs = Math.min(s.army, Math.round(eff * rng.range(SACK.losses[0], SACK.losses[1])));
  const ours = Math.min(men.length, Math.floor(theirs / SACK.advantage + rng.next()));
  s.army -= theirs;
  s.lost += theirs;
  const fallen = [...men].sort(() => rng.next() - 0.5).slice(0, ours);
  for (const p of fallen) die(v, p, 'an assault on the walls');
  s.killed += fallen.length;
  logNews(v, 'alarm', `The Boeotians try the walls and are thrown back, losing ${theirs} men.${fallen.length ? ` ${fallen.map((p) => p.name).join(', ')} ${fallen.length > 1 ? 'are' : 'is'} killed on the wall.` : ' None of the defenders falls.'}`, { pause: true });
  if (s.lost >= SACK.leave * s.start) lift(v, `Having lost ${s.lost} men under the walls, the Boeotians give it up and march home.`);
}

function lift(v, text) {
  const s = v.siege;
  v.siege = null;
  for (const h of aliveHouseholds(v)) if (!h.player) h.goodwill = clamp((h.goodwill ?? 0.6) + 0.05, 0, 1);
  logNews(v, 'alarm', `${text} The siege is over${s.killed ? `, at the cost of ${s.killed} of ${v.name}'s men` : ''}. The fields and the houses outside the walls are to be made again.`, { pause: true });
}

// While the enemy is at the walls nobody goes out of them.
export function blockedBySiege(v, site) {
  if (!v.siege || !site) return false;
  if (site.kind === 'farm') return true;
  const s = siteOf(v, site);
  return !s || !insideWall(v, s);
}
