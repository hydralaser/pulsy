import { DEMES_SIM, LIFE } from './rules.js';
import { clamp } from '../sim/core.js';
import { villageRng } from './people.js';

// The neighbours: the other Athenian border demes, and the Boeotian peoples whose contingents you
// meet in the field, each a village or a countryside much like yours, lived in only lightly: so many
// men, women and children, its grain, its flock, its fields. They grow and shrink, bury their dead,
// marry their sons and daughters, and suffer what war does to them: men killed in battle and in
// defending their homes, fields burned, stores broken into, people carried off. A people whose men
// are fewer sends fewer to the next battle.

export const ATHENIAN = ['Eleutherai', 'Phyle', 'Panakton', 'Dekeleia', 'Aphidna', 'Eleusis', 'Acharnai', 'Thria'];
export const BOEOTIAN = { Thebans: 'Thebes', Tanagrans: 'Tanagra', Thespians: 'Thespiai', Haliartians: 'Haliartos', Koroneians: 'Koroneia', Plataians: 'Plataia' };

function makeDeme(rng, name, side) {
  const S = DEMES_SIM;
  const pop = Math.round(side === 'athens' ? rng.range(S.size.athens[0], S.size.athens[1]) : rng.range(S.size.boeotia[0], S.size.boeotia[1]));
  const men = Math.round(pop * 0.25);
  const women = Math.round(pop * 0.25);
  return {
    name,
    town: side === 'boeotia' ? BOEOTIAN[name] : name,
    side,
    men, // of fighting age
    women, // grown
    boys: Math.round(pop * 0.17),
    girls: Math.round(pop * 0.17),
    old: Math.round(pop * 0.16),
    unwedMen: Math.round(men * 0.2),
    unwedWomen: Math.round(women * 0.12),
    slaves: 0, // taken in raids: they work and eat, but neither marry nor fight
    grain: pop * S.grainEach,
    sheep: Math.round(pop * 1.5),
    burned: false,
    base: men, // what it could put in the field at the start: its strength is measured against this
    news: [],
    year: { born: 0, died: 0 }, // last year's births and deaths
  };
}

export function initNeighbours(v) {
  if (v.demes) return;
  const rng = villageRng(v);
  v.demes = {};
  for (const n of ATHENIAN) if (n !== v.name) v.demes[n] = makeDeme(rng, n, 'athens');
  for (const n of Object.keys(BOEOTIAN)) v.demes[n] = makeDeme(rng, n, 'boeotia');
}

export function demeOf(v, name) {
  initNeighbours(v);
  return v.demes[name] || null;
}

export const peopleOfDeme = (d) => d.men + d.women + d.boys + d.girls + d.old + (d.slaves || 0);

// A deme or people that can still be marched on: it has men left to meet an army.
export const standing = (d) => d && d.men >= DEMES_SIM.standing;

// How many it can send to the field now, against what it could at the start.
export function strengthOf(v, name) {
  const d = demeOf(v, name);
  return d ? clamp(d.men / Math.max(1, d.base), 0.3, 1.5) : 1;
}

function note(v, d, text) {
  d.news.unshift({ day: v.day, text });
  d.news.length = Math.min(d.news.length, 6);
}

// Men lost: killed in the field, or at home defending it.
export function killMen(v, d, n, how) {
  const k = Math.min(d.men, Math.max(0, Math.round(n)));
  d.men -= k;
  // The unmarried among them in their share; the rest leave widows.
  const unwed = Math.round(k * (d.unwedMen / Math.max(1, d.men + k)));
  d.unwedMen = Math.max(0, d.unwedMen - unwed);
  d.unwedWomen += Math.round((k - unwed) * 0.3); // widows young enough to marry again
  if (k && how) note(v, d, `${k} men killed ${how}.`);
  return k;
}

// Each year, as the harvest comes in: births and deaths, the young growing up and marrying, the
// harvest itself, which is poor where the fields were burned, and the flock. Births and deaths go by
// the same rules as Oinoe's own: a wife under forty has a child as often as one in Oinoe does, and a
// child, a grown man or woman and an old one die as often as they do there.
export function neighboursYear(v) {
  initNeighbours(v);
  const S = DEMES_SIM;
  const rng = villageRng(v);
  for (const d of Object.values(v.demes)) {
    d.slaves = d.slaves || 0;
    const hungry = d.burned || d.grain < peopleOfDeme(d) * 150;
    const round = (x) => Math.floor(x) + (rng.next() < x - Math.floor(x) ? 1 : 0);
    const before = peopleOfDeme(d);
    const wives = Math.max(0, d.women - d.unwedWomen) * S.youngWives;
    // As in Oinoe: a wife under forty conceives at LIFE.birthChance a year, but not while she has a
    // baby at the breast.
    const born = round(wives * (1 / (1 / LIFE.birthChance + S.nursing)) * (hungry ? S.hungryBirths : 1));
    const boys = round(born * 0.51);
    // Deaths, harder in a hungry year.
    const dead = (n, r) => Math.min(n, round(n * r * (hungry ? S.hungryDeaths : 1)));
    d.boys -= dead(d.boys, S.childDeath);
    d.girls -= dead(d.girls, S.childDeath);
    d.old -= dead(d.old, S.oldDeath);
    d.slaves -= dead(d.slaves, S.adultDeath);
    const menDead = dead(d.men, S.adultDeath);
    killMen(v, d, menDead, null);
    d.women -= dead(d.women, S.adultDeath);
    d.year = { born, died: before - peopleOfDeme(d) };
    d.boys += boys;
    d.girls += born - boys;
    // Growing up and growing old.
    const grownBoys = round(d.boys / 16);
    const grownGirls = round(d.girls / 16);
    d.boys -= grownBoys;
    d.girls -= grownGirls;
    d.men += grownBoys;
    d.women += grownGirls;
    d.unwedMen += grownBoys;
    d.unwedWomen += grownGirls;
    const aged = round(d.men / 40);
    d.men -= aged;
    d.old += aged + round(d.women / 40);
    d.women -= round(d.women / 40);
    // Marrying among themselves.
    const wed = Math.min(round(d.unwedMen * 0.5), round(d.unwedWomen * 0.6));
    d.unwedMen -= wed;
    d.unwedWomen -= wed;
    d.unwedMen = clamp(d.unwedMen, 0, d.men);
    d.unwedWomen = clamp(d.unwedWomen, 0, d.women);
    // The harvest: what they eat of last year's, and what this year's brings in.
    const pop = peopleOfDeme(d);
    d.grain = Math.max(0, d.grain - pop * 290) + pop * S.grainEach * (d.burned ? 0.35 : rng.range(0.85, 1.15));
    d.sheep = Math.round(Math.min(pop * 2, d.sheep * 1.12));
    if (d.burned) note(v, d, 'A hungry year after its fields were burned.');
    d.burned = false;
  }
}

// ---- marrying between demes ----

// A girl of Oinoe marrying into an Athenian deme: there must be a man there to marry her.
export function takeGroom(v, rng) {
  initNeighbours(v);
  const ds = Object.values(v.demes).filter((d) => d.side === 'athens' && d.unwedMen > 0);
  if (!ds.length) return null;
  const d = rng.pick(ds);
  d.unwedMen--;
  d.women++;
  return d.name;
}

// A bride for a man of Oinoe, from a deme with a girl to marry.
export function takeBride(v, rng) {
  initNeighbours(v);
  const ds = Object.values(v.demes).filter((d) => d.side === 'athens' && d.unwedWomen > 0);
  if (!ds.length) return null;
  const d = rng.pick(ds);
  d.unwedWomen--;
  d.women--;
  return d.name;
}

// ---- war on the demes ----

// A raid that is won: their men killed defending their homes, their fields burned, their flock driven
// off; and, now and then, the deme itself broken into and its stores carried off. What the army
// takes, the raiders share out by the men each place sent.
export function raidDeme(v, rng, name, broke, share) {
  const d = demeOf(v, name);
  if (!d) return null;
  const S = DEMES_SIM;
  const fell = killMen(v, d, d.men * rng.range(S.defence[0], S.defence[1]) * (broke ? 2 : 1), 'defending their homes');
  d.burned = true;
  const sheep = Math.round(d.sheep * rng.range(0.2, 0.4));
  d.sheep -= sheep;
  let grain = 0;
  if (broke) {
    grain = Math.round(d.grain * S.stores);
    d.grain -= grain;
  }
  note(v, d, broke ? 'Raided from Attica: its fields burned, its flock driven off, the village itself broken into and its stores carried off.' : 'Raided from Attica: its fields burned and its flock driven off.');
  return { fell, sheep, grain, yours: { sheep: Math.round(sheep * share), grain: Math.round(grain * share) } };
}

// The Boeotians raiding an Athenian deme, and our army beaten off or never come: the same, done to
// us. If they break in, each people in their army takes what it will of those left, as its own
// leading man decides. The takers are the peoples in their army, each with its share of it.
export function raidedBy(v, rng, name, takers) {
  const d = demeOf(v, name);
  if (!d) return;
  const S = DEMES_SIM;
  killMen(v, d, d.men * rng.range(S.defence[0], S.defence[1]), 'defending their homes');
  d.burned = true;
  d.sheep = Math.round(d.sheep * rng.range(0.6, 0.8));
  if (rng.chance(S.breach)) {
    d.grain = Math.round(d.grain * (1 - S.stores));
    note(v, d, 'Raided by the Boeotians and broken into: its fields burned and its stores carried off.');
    const took = takenBy(v, rng, d, [...(takers || [])].sort((x, y) => y.share - x.share));
    return took;
  }
  note(v, d, 'Raided by the Boeotians: its fields burned and its flock driven off.');
  return null;
}

// ---- captives ----

// What the men of a deme that broke into another may take of those left: their share of the army's.
export function captivesOf(left, share) {
  return { women: Math.round(left.women * DEMES_SIM.taken * share), men: Math.round(left.men * DEMES_SIM.taken * share * 0.5) };
}

// Who is left to be carried off from a deme broken into, as the takers choose in turn: the young
// women, whom the first to choose take as brides; the other women; and the men.
export function captivePool(d) {
  const left = survivors(d);
  const young = Math.round(left.women * DEMES_SIM.young);
  return { left, young, women: left.women, men: left.men };
}

// What a deme needs: brides, if it has more unmarried men than girls of its own to marry them;
// hands, if it has fewer men (and slaves) than it had to work its fields.
export function needsOf(d) {
  const brides = Math.max(0, d.unwedMen - d.unwedWomen);
  return {
    brides,
    bride: d.unwedMen > 0 ? clamp(brides / Math.max(4, d.unwedMen), 0, 1) : 0,
    work: clamp(DEMES_SIM.workNeed + 2 * (d.base - d.men - (d.slaves || 0)) / Math.max(1, d.base), 0, 1),
  };
}

// What a deme's leading man decides to do with the people of a village his men broke into: what
// his deme needs above all, brides or hands, and then his temper, a bold man taking slaves more
// readily, a careful one more often leaving them.
function chooseFor(v, rng, taker) {
  const x = v.war && v.war.peoples && v.war.peoples[taker.name];
  const bold = x && x.leader ? x.leader.bold : 0.5;
  const n = needsOf(taker);
  const w = {
    none: 0.1 + 0.4 * (1 - bold) * (1 - Math.max(n.bride, n.work)),
    slaves: 0.05 + 0.25 * bold + 0.6 * n.work,
    brides: n.brides ? 0.05 + 0.7 * n.bride : 0,
    both: n.brides ? 0.05 + 0.2 * bold + 0.6 * Math.min(n.bride, n.work) : 0,
  };
  let r = rng.next() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, p] of Object.entries(w)) if ((r -= p) < 0) return k;
  return 'none';
}

// The demes or peoples of a victorious army choose in turn, those that brought the most men first,
// each what it may by its share of the army, from those still left: brides for the unmarried men it
// has no girls for, from the young women while any are left, and slaves.
export function takenBy(v, rng, victim, takers, pool = captivePool(victim)) {
  const out = [];
  for (const t of takers) {
    const taker = demeOf(v, t.name);
    if (!taker || taker === victim) continue;
    const choice = chooseFor(v, rng, taker);
    const can = captivesOf(pool.left, t.share);
    let brides = 0;
    let women = 0;
    let men = 0;
    if (choice === 'brides' || choice === 'both') brides = Math.min(can.women, needsOf(taker).brides, pool.young);
    if (choice === 'slaves' || choice === 'both') {
      women = Math.min(can.women - brides, pool.women - brides);
      men = Math.min(can.men, pool.men);
    }
    takeFrom(pool, brides, women, men);
    carryOff(victim, brides + women, men);
    taker.women += brides;
    taker.unwedMen -= brides;
    taker.slaves = (taker.slaves || 0) + women + men;
    const who = taker.side === 'boeotia' ? `The ${taker.name}` : `The men of ${taker.name}`;
    const text = brides + women + men
      ? `${who} took ${[brides && `${brides} as brides`, women && `${women} women as slaves`, men && `${men} men as slaves`].filter(Boolean).join(', ')}.`
      : `${who} took no one.`;
    if (brides + women + men) note(v, taker, `Came back from ${victim.town} with ${[brides && `${brides} brides`, women + men && `${women + men} slaves`].filter(Boolean).join(' and ')}.`);
    out.push({ name: taker.name, choice, brides, slaves: women + men, text });
  }
  noteTaken(v, victim, out);
  return out;
}

// Taken from what is left: brides from the young women, slaves from the other women first.
export function takeFrom(pool, brides, women, men) {
  pool.young = Math.max(0, pool.young - brides - Math.max(0, women - (pool.women - pool.young - brides)));
  pool.women = Math.max(0, pool.women - brides - women);
  pool.men = Math.max(0, pool.men - men);
}

// Of the deme broken into: who carried off how many of its people.
export function noteTaken(v, d, took) {
  const by = took.filter((t) => t.brides + t.slaves);
  if (by.length) note(v, d, `Carried off: ${by.map((t) => `${t.brides + t.slaves} by ${(demeOf(v, t.name) || {}).side === 'boeotia' ? 'the ' : ''}${t.name}`).join(', ')}.`);
}

// Men killed in a battle in the field, contingent by contingent, are gone from their demes.
export function battleLosses(v, result) {
  for (const side of result.sides || []) {
    for (const c of side.contingents || []) {
      if (c.village) continue;
      const d = demeOf(v, c.name);
      const k = (c.killedFight || 0) + (c.killedPursuit || 0) + (c.diedOfWounds || 0);
      if (d && k) killMen(v, d, k, 'in the battle');
    }
  }
}

// Who is left in a deme that was broken into, for you to choose what to do with them.
export function survivors(d) {
  return { men: d.men, women: d.women, children: d.boys + d.girls, old: d.old };
}

// Taking people from a deme: gone from it.
export function carryOff(d, women, men) {
  d.women = Math.max(0, d.women - women);
  d.unwedWomen = Math.min(d.unwedWomen, d.women);
  d.men = Math.max(0, d.men - men);
  d.unwedMen = Math.min(d.unwedMen, d.men);
}
