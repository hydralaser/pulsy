import { WAR } from './rules.js';
import { clamp } from '../sim/core.js';
import { hopliteKit } from '../sim/rules.js';
import { villageRng, canFight, ageOf, createPerson } from './people.js';
import { aliveHouseholds, pay } from './economy.js';
import { tie, addGoodwill } from './council.js';
import { die } from './life.js';
import { logNews } from './clock.js';
import { homeOf } from './work.js';
import { freeHouse, headOf } from './family.js';
import { MEN } from './names.js';

// The village and the city. Now and then a general raising men on the border sends to the village
// for its share of a levy. You say what share of the fighting men go; they march, fight in the
// general's line beside the men of the other demes, and come home, or do not. How they bore
// themselves stays with the village: in the city's regard, and among the households.

const GENERALS = ['Tolmides', 'Myronides', 'Hippokrates', 'Lamachos', 'Demosthenes', 'Leokrates', 'Nikostratos', 'Eurymedon'];
const REASONS = [
  'Boeotian raiders have been driving off cattle below Panakton, and he means to catch them before they get home',
  'a Theban column is marching on Eleutherai, and he will meet it in the field',
  'the Boeotians have burned a farmstead over the border, and he is going to answer it',
  'a Boeotian force has crossed Kithairon, and the border demes must turn it back',
  'Tanagra has called out its men, and he will not wait to be attacked',
  'raiders from Boeotia have been seen in the passes, in strength',
];
const DEMES = ['Eleutherai', 'Phyle', 'Panakton', 'Dekeleia', 'Aphidna', 'Eleusis', 'Acharnai', 'Thria'];
const BOEOTIANS = ['Thebans', 'Tanagrans', 'Thespians', 'Haliartians', 'Koroneians', 'Plataians'];
const PLACES = ['Panakton', 'Skourta', 'the Kithairon pass', 'Drymos', 'the Asopos', 'Eleutherai', 'Phyle', 'Hysiai', 'Erythrai', 'the Dryoskephalai road'];
// The tempers of the men who lead the other contingents: how readily each shouts his men on, and
// how readily he holds them back or takes them away.
const TEMPERS = [
  { bold: 0.9, timid: 0.15 },
  { bold: 0.7, timid: 0.3 },
  { bold: 0.45, timid: 0.45 },
  { bold: 0.45, timid: 0.45 },
  { bold: 0.3, timid: 0.65 },
  { bold: 0.15, timid: 0.85 },
];

// How a man died, as the village tells it.
const DEATHS = {
  'killed fighting': 'a spear in the battle against the Boeotians, fighting in the line',
  'killed running': 'wounds taken running from the Boeotians',
  'died of his wounds on the field': 'his wounds, on the field against the Boeotians',
  'died of his wounds': 'his wounds, the night after the battle against the Boeotians',
  'died of his wounds in the days after': 'his wounds, in the days after the battle against the Boeotians',
  'killed where he lay': 'wounds, killed by the Boeotians where he lay on the field',
};

export function initWar(v) {
  if (v.war) return;
  v.war = { next: WAR.first + (v.day - (v.day % 360)), standing: WAR.standing.start, summons: null, campaign: null, history: [] };
}

// The other demes and the Boeotian towns are the same from one battle to the next: the same
// men, much the same quality and kit, led by the same man until he dies. What you know of them is
// only what you have seen them do.
function peopleOf(v, name, rng) {
  const w = v.war;
  w.peoples = w.peoples || {};
  let x = w.peoples[name];
  if (!x) {
    const t = rng.pick(TEMPERS);
    x = w.peoples[name] = {
      leader: { name: rng.pick(MEN), bold: clamp(t.bold + rng.range(-0.08, 0.08), 0, 1), timid: clamp(t.timid + rng.range(-0.08, 0.08), 0, 1) },
      quality: rng.pick(['green', 'regular', 'regular', 'veteran']),
      kit: rng.pick(['poor', 'standard', 'standard', 'well']),
      seen: { battles: 0, steady: 0, provoke: 0, linger: 0, run: 0, ran: 0 },
    };
  }
  return x;
}

// What you have seen of a contingent and its leader, in a few words.
export function knownOf(v, name) {
  const x = v.war.peoples && v.war.peoples[name];
  if (!x || !x.seen.battles) return '';
  const s = x.seen;
  const all = s.steady + s.provoke + s.linger + s.run || 1;
  const bits = [];
  if (s.provoke / all > 0.35) bits.push(`${x.leader.name} is always shouting his men on`);
  else if (s.provoke / all > 0.12) bits.push(`${x.leader.name} will shout his men on`);
  if (s.linger / all > 0.3) bits.push('they hang back and leave the fighting to others');
  else if (s.linger / all > 0.1) bits.push('they hang back when it gets hard');
  if (s.ran) bits.push(s.ran > 1 ? `they have run ${s.ran} times` : 'they have run before');
  if (!bits.length) bits.push('they stood their ground');
  return `${name} (${s.battles} battle${s.battles > 1 ? 's' : ''} with you): ${bits.join('; ')}.`;
}

// Whether someone is away with the army.
export const isAway = (p) => !!p.away;

// The men a household can send: of fighting age, fit to march, and armed. The leading man goes
// first from his own house; after him the young go before the old, as the levy took them.
export function fightersOf(v, h) {
  return h.members.map((id) => v.people[id])
    .filter((p) => canFight(v, p) && p.health >= WAR.fit && !p.away && p.weapon)
    .sort((a, b) => (b.player ? 1 : 0) - (a.player ? 1 : 0) || b.born - a.born);
}

// Who goes for a given share: each household's whole men, and the households owing part of a man
// clubbed together, closest ties first, one of them sending a man for the group and the others
// paying him. A group owing less than half a man between them is let off.
export function planLevy(v, share) {
  const rows = aliveHouseholds(v).map((h) => {
    const men = fightersOf(v, h);
    const owe = share * men.length;
    let whole = Math.floor(owe + 1e-9);
    let frac = owe - whole;
    // The leading man goes himself if anyone goes at all.
    if (h.player && share > 0 && men.length && whole === 0) {
      whole = 1;
      frac = 0;
    }
    return { h: h.id, men, owe, whole, frac };
  });
  // Households owing part of a man, in a chain from each to the one it is closest to.
  const open = rows.filter((r) => r.frac > 0.01).sort((a, b) => b.frac - a.frac || a.h - b.h);
  const chain = [];
  while (open.length) {
    const last = chain[chain.length - 1];
    let best = 0;
    if (last) {
      let bestTie = -Infinity;
      open.forEach((r, i) => {
        const t = tie(v, last.h, r.h);
        if (t > bestTie + 1e-9) {
          bestTie = t;
          best = i;
        }
      });
    }
    chain.push(open.splice(best, 1)[0]);
  }
  // Down the chain, a man's worth at a time; a household whose part runs over is in two groups.
  const groups = [];
  let g = null;
  for (const r of chain) {
    let left = r.frac;
    while (left > 1e-6) {
      if (!g) {
        g = { sum: 0, members: [] };
        groups.push(g);
      }
      const part = Math.min(left, 1 - g.sum);
      g.members.push({ h: r.h, frac: part });
      g.sum += part;
      left -= part;
      if (g.sum > 0.999) g = null;
    }
  }
  // In each group the house with most men to spare sends one; the others pay it for him.
  const spare = new Map(rows.map((r) => [r.h, r.men.length - r.whole]));
  const sent = new Map(rows.map((r) => [r.h, r.whole]));
  for (const x of groups) {
    x.sends = x.sum >= 0.5;
    const sender = [...x.members].sort((a, b) => spare.get(b.h) - spare.get(a.h) || b.frac - a.frac)[0];
    x.sender = spare.get(sender.h) > 0 ? sender.h : -1;
    if (x.sender < 0) x.sends = false;
    if (!x.sends) x.sender = -1;
    // Those let off pay the common granary for the man they did not send.
    for (const m of x.members) m.pays = !x.sends || m.h !== x.sender ? Math.round(m.frac * WAR.shareCost) : 0;
    x.toCommon = !x.sends;
    if (!x.sends) continue;
    spare.set(x.sender, spare.get(x.sender) - 1);
    sent.set(x.sender, sent.get(x.sender) + 1);
  }
  const men = [];
  for (const r of rows) for (let i = 0; i < sent.get(r.h); i++) men.push(r.men[i].id);
  const hoplites = men.filter((id) => v.people[id].shield === 'aspis').length;
  return { share, men, hoplites, lights: men.length - hoplites, groups, rows: rows.map(({ h, men: m, owe }) => ({ h, fighters: m.length, owe, sends: sent.get(h) })) };
}

// Each day: a summons comes, goes unanswered, or the army marches and the men come home.
export function warDay(v) {
  initWar(v);
  const w = v.war;
  const rng = villageRng(v);
  if (!w.summons && !w.campaign && v.day >= w.next) {
    const fighters = aliveHouseholds(v).reduce((a, h) => a + fightersOf(v, h).length, 0);
    if (fighters) {
      w.summons = { day: v.day, general: rng.pick(GENERALS), reason: rng.pick(REASONS), place: rng.pick(PLACES), seed: 1 + rng.int(99999) };
      logNews(v, 'alarm', `A rider from the strategos ${w.summons.general}: ${w.summons.reason}. He calls on ${v.name} for its share of men.`, { pause: true });
    } else w.next = v.day + 30;
  }
  if (w.summons && v.day - w.summons.day >= WAR.answer) answerSummons(v, 0, true);
  if (w.fine && v.day - w.fine.day >= WAR.fineAnswer) answerFine(v, false, true);
  // A village that defies the city long enough, the city deals with: it sends men in the night for
  // its leading man, to put one of its own in his place.
  if (v.day % 30 === 0 && (w.defiance || 0) >= 2 && rng.chance(Math.min(0.8, WAR.plotChance * (w.defiance - 1)))) plot(v, rng);
  const c = w.campaign;
  if (c && c.stage === 'marching' && v.day >= c.battleDay) {
    c.stage = 'battle';
    logNews(v, 'alarm', `The army is drawn up facing the Boeotians. Your men are in the line.`, { pause: true });
  }
  if (c && c.stage === 'home' && v.day >= c.homeDay) {
    for (const id of c.men) {
      const p = v.people[id];
      if (!p.alive) continue;
      p.away = null;
      p.state = 'home';
      p.pos = homeOf(v, p);
    }
    const back = c.men.filter((id) => v.people[id].alive).length;
    logNews(v, 'season', `The men who marched with ${c.general} are home: ${back} of the ${c.men.length} who went.`, { pause: true });
    w.campaign = null;
  }
}

// The city's fine for refusing a levy: paid from the common granary (and from your own stores for
// what it lacks), or refused. Silence is refusal.
export function answerFine(v, payIt, lapsed = false) {
  const w = v.war;
  const f = w.fine;
  if (!f) return;
  w.fine = null;
  if (payIt) {
    const common = Math.min(v.common.grain, f.kg);
    v.common.grain -= common;
    const mine = v.households.find((h) => h.player);
    if (f.kg - common > 0 && mine) mine.stores.grain = Math.max(0, mine.stores.grain - (f.kg - common));
    w.defiance = Math.max(0, (w.defiance || 0) - 1);
    logNews(v, 'season', `The fine of ${f.kg} kg is paid to the city${common < f.kg ? `, ${Math.round(f.kg - common)} kg of it from your own stores` : ''}.`);
    return;
  }
  w.defiance = (w.defiance || 0) + 1;
  w.standing = clamp(w.standing - 0.1, 0, 1);
  logNews(v, 'alarm', `${lapsed ? 'The fine goes unpaid' : 'You refuse to pay the fine'}. The city's men leave with hard words${w.defiance >= 2 ? `, and men in ${v.name} say the city will not put up with you much longer` : ''}.`, { pause: true });
}

// Men from the city come for the leading man in the night. Whether they get him is his own
// courage and skill, and how far the village is behind him: households that like him warn him
// and stand by him.
function plot(v, rng) {
  const w = v.war;
  const mine = v.households.find((h) => h.player);
  const me = mine ? headOf(v, mine) : null;
  if (!me || !me.alive) return;
  const hs = aliveHouseholds(v).filter((h) => !h.player);
  const goodwill = hs.reduce((a, h) => a + (h.goodwill ?? 0.6), 0) / Math.max(1, hs.length);
  const safe = 0.2 + 0.4 * goodwill + 0.15 * (me.skill || 0.3) + 0.1 * (me.courage || 0.5);
  w.plots = (w.plots || 0) + 1;
  if (rng.chance(safe)) {
    // A man of his house may die keeping them off.
    const guards = mine.members.map((id) => v.people[id]).filter((p) => p.alive && p !== me && canFight(v, p));
    const fallen = guards.length && rng.chance(0.3) ? rng.pick(guards) : null;
    if (fallen) die(v, fallen, `a knife in the dark, keeping the city's men off ${me.name}`);
    logNews(v, 'alarm', `Men sent from the city came for you in the night${goodwill > 0.6 ? ', but the village had warned you' : ''}, and were driven off.${fallen ? ` ${fallen.name} was killed holding them at the door.` : ''} They will come again while you defy the city.`, { pause: true });
    return;
  }
  replaceLeader(v, rng, me, mine);
}

// The city's man takes your place: he moves into the great house with his family, and you play
// on as him. Your old house goes on as an ordinary household, with no love for him.
function replaceLeader(v, rng, me, old) {
  const w = v.war;
  old.player = false;
  die(v, me, 'the knives of men sent from the city in the night');
  me.player = false;
  for (const id of old.members) v.people[id].player = false;
  const id = v.households.length;
  const great = v.land.houses.findIndex((x) => x.great);
  const h = { id, house: great, assign: { m: null, f: null }, members: [], wealth: 0.9, cloth: 0, player: true, head: -1, name: '', armoury: [], sheep: 0, stores: { grain: 3000, wood: 600, wool: 10, cloth: 6, stone: 0 }, goodwill: 1, ordered: { m: false, f: false }, plan: null };
  v.households.push(h);
  const add = (opts) => {
    const p = createPerson(v, rng, { household: id, ...opts });
    h.members.push(p.id);
    const hs = v.land.houses[great];
    p.pos = { x: hs.x + rng.range(-3, 3), y: hs.y + rng.range(-3, 3) };
    return p;
  };
  const man = add({ sex: 'm', age: 38 + rng.int(10) });
  Object.assign(man, hopliteKit(rng, man.veteran, 'well'));
  man.player = true;
  man.reputation = Math.max(man.reputation, 0.5);
  const wife = add({ sex: 'f', age: 28 + rng.int(8) });
  man.spouse = wife.id;
  wife.spouse = man.id;
  for (let i = 0; i < 1 + rng.int(3); i++) add({ sex: rng.chance(0.5) ? 'm' : 'f', age: 2 + rng.int(10), father: man.id, mother: wife.id });
  h.head = man.id;
  h.name = man.name;
  // Your widow and sons move out of the great house.
  const free = freeHouse(v);
  old.house = free >= 0 ? free : old.house;
  for (const pid of old.members) v.people[pid].homeAt = null;
  old.goodwill = 0.05;
  for (const o of aliveHouseholds(v)) if (o !== h && o !== old) addGoodwill(v, o, -0.1);
  v.petitions = (v.petitions || []).filter((p) => p.house !== old.id);
  w.defiance = 0;
  w.standing = 0.6;
  w.replaced = (w.replaced || 0) + 1;
  logNews(v, 'alarm', `${me.name} is dead, killed in the night by men sent from the city. The city puts its own man in his place: ${man.name} of Athens moves into the great house with his family. You are ${man.name} now, and ${v.name} does not love you.`, { pause: true });
}

// Your answer: a share of the fighting men, or none. Silence counts as none.
export function answerSummons(v, share, lapsed = false) {
  const w = v.war;
  const s = w.summons;
  if (!s) return null;
  w.summons = null;
  const rng = villageRng(v);
  w.next = v.day + Math.round(rng.range(WAR.every[0], WAR.every[1]));
  const plan = planLevy(v, share);
  // Those let off pay the common granary whether or not anyone goes.
  for (const g of plan.groups) for (const m of g.members) if (m.pays) pay(v, m.h, g.sends ? g.sender : -1, m.pays, g.sends ? 'a man for the levy' : 'the levy');
  if (!plan.men.length) {
    w.standing = clamp(w.standing + WAR.standing.none, 0, 1);
    // A deme already in bad odour is fined for it, and may refuse to pay.
    const fine = w.standing < 0.3 && !w.fine;
    if (fine) w.fine = { day: v.day, kg: WAR.fine, general: s.general };
    logNews(v, 'alarm', `${lapsed ? 'No answer goes back' : 'You send word that no one will come'}. ${s.general} marches without the men of ${v.name}, and the city will hear of it.${fine ? ` The city fines the deme ${WAR.fine} kg of barley.` : ''}`, { pause: fine });
    w.history.push({ day: v.day, general: s.general, sent: 0 });
    return plan;
  }
  w.standing = clamp(w.standing + (share >= 0.3 ? WAR.standing.many : share < 0.2 ? WAR.standing.few : 0), 0, 1);
  for (const id of plan.men) {
    const p = v.people[id];
    p.away = { war: true };
    p.state = 'away';
    p.task = null;
    p.goal = null;
  }
  const fighters = plan.rows.reduce((a, r) => a + r.fighters, 0);
  w.campaign = { stage: 'marching', general: s.general, reason: s.reason, place: s.place || 'Panakton', seed: s.seed, share, fighters, men: plan.men, groups: plan.groups, leftDay: v.day, battleDay: v.day + WAR.march };
  const names = plan.men.map((id) => v.people[id].name);
  logNews(v, 'season', `${plan.men.length} men march out to join ${s.general}: ${names.join(', ')}.`, { pause: false });
  return plan;
}

// The battle the village's men are going to: the general's line of the border demes, with the
// men of the village as one contingent in it, and the light-armed among them with the peltasts.
export function battleSetup(v) {
  const c = v.war.campaign;
  const rng = villageRng({ rngState: c.seed });
  const men = c.men.map((id) => v.people[id]).filter((p) => p.alive);
  const spec = (p, light) => ({
    villageId: p.id,
    name: p.name,
    origin: v.name,
    age: ageOf(v, p),
    courage: p.courage,
    skill: p.skill,
    reputation: p.reputation,
    veteran: p.veteran,
    battles: p.battles,
    weapon: light ? 'akontia' : p.weapon,
    shield: light ? 'pelte' : p.shield,
    armour: light ? 'none' : p.armour,
    helmet: p.helmet,
    greaves: light ? 'none' : p.greaves,
    epithet: p.epithet || null,
    player: !!p.player,
  });
  const hoplites = men.filter((p) => p.shield === 'aspis').map((p) => spec(p, false));
  const lights = men.filter((p) => p.shield !== 'aspis').map((p) => spec(p, true));
  // The men of the other border demes, a contingent each, villages much like yours that sent what
  // their own leading men thought fit.
  const demes = DEMES.filter((d) => d !== v.name);
  const allies = [];
  const nAllies = 3 + rng.int(3);
  for (let i = 0; i < nAllies; i++) {
    const name = demes.splice(rng.int(demes.length), 1)[0];
    const count = Math.max(3, Math.round((c.fighters || 24) * rng.range(0.12, 0.4)));
    const x = peopleOf(v, name, rng);
    allies.push({ name, count, quality: x.quality, kit: x.kit, leader: x.leader });
  }
  const contingents = [...allies];
  let mine = null;
  if (hoplites.length) {
    mine = rng.int(contingents.length + 1);
    contingents.splice(mine, 0, { name: v.name, count: hoplites.length, quality: 'regular', kit: 'standard', village: v.name, men: hoplites, you: true });
  }
  const ours = contingents.reduce((a, x) => a + x.count, 0);
  // The Boeotians, about as many, in two or three contingents of their towns.
  const theirs = Math.max(12, Math.round(ours * rng.range(0.8, 1.25)));
  const towns = [...BOEOTIANS];
  const nTowns = theirs > 36 ? 3 : 2;
  const enemy = [];
  for (let i = 0; i < nTowns; i++) {
    const name = towns.splice(rng.int(towns.length), 1)[0];
    const x = peopleOf(v, name, rng);
    enemy.push({ name, count: Math.round(theirs / nTowns), quality: x.quality, kit: x.kit, leader: x.leader });
  }
  // You command the line if your men are its largest contingent; otherwise you lead only them.
  const commander = mine != null && contingents.every((x, k) => k === mine || x.count < hoplites.length);
  const config = {
    seed: c.seed,
    sides: [
      {
        depth: 4,
        placement: 'xenophon',
        ai: !commander,
        command: commander ? 'phalanx' : 'ai',
        lights: { count: Math.round(ours * rng.range(0.2, 0.4)) + lights.length, quality: 'regular', men: lights },
        cavalry: rng.chance(0.5) ? [{ name: 'Hippeis', count: 4 + rng.int(5), quality: 'regular', wing: 'right' }] : [],
        contingents,
      },
      {
        depth: 4 + rng.int(3),
        placement: 'random',
        ai: true,
        lights: { count: Math.round(theirs * rng.range(0.2, 0.45)), quality: 'regular' },
        cavalry: rng.chance(0.7) ? [{ name: 'Boeotian horse', count: 4 + rng.int(7), quality: rng.pick(['regular', 'veteran']), wing: 'right' }] : [],
        contingents: enemy,
      },
    ],
  };
  const brief = [
    `${c.general}' army is drawn up: ${contingents.map((x) => `${x.count} of ${x.name}`).join(', ')}, with ${config.sides[0].lights.count} light troops${config.sides[0].cavalry.length ? ` and ${config.sides[0].cavalry[0].count} horsemen` : ''}. Facing them are about ${theirs} Boeotian hoplites${config.sides[1].cavalry.length ? ' and their horse' : ''}.`,
    mine == null ? `None of your men carry the hoplite shield; all ${lights.length} are with the light troops, and you can only watch.`
      : commander ? `Your ${hoplites.length} men are the largest contingent in the line, and the general gives you the command of the whole phalanx.`
        : `Your ${hoplites.length} men stand together in the line, ${mine === 0 ? 'on the left' : mine === contingents.length - 1 ? 'on the right, the place of honour' : 'in the centre'}. You lead them, not the line: hold them steady, shout them on, hang back, or tell them to run. Each of the other contingents has its own leader deciding the same for his men.`,
    lights.length && mine != null ? `${lights.length} more of your men, without the hoplite shield, are out with the light troops.` : '',
    ...allies.map((x) => knownOf(v, x.name)).filter(Boolean),
    ...enemy.map((x) => knownOf(v, x.name)).filter(Boolean),
    'Men shouted on into the fight learn more from it than men held back. Men who do well are noticed.',
    'Men who run from a winning fight, or start a rout, shame the village. Men who stand when all the rest have gone pay for it in blood.',
  ].filter(Boolean);
  const names = {};
  for (const p of men) names[p.id] = p.name;
  const title = `The battle at ${c.place || 'the border'}: ${c.general}' army, with the men of ${v.name}`;
  return { config, campaign: { contingent: mine, role: commander ? 'commander' : 'leader', village: v.name, title, brief, names } };
}

// What the battle did to the village: the dead, the wounded, the marks they carry, the shields
// thrown away, the name each man made, and how the village bore itself.
export function applyBattle(v, result) {
  const w = v.war;
  const c = w.campaign;
  if (!c || c.stage !== 'battle') return null;
  const rng = villageRng(v);
  const won = result.winner === 0;
  const lost = result.loser === 0;
  const side = result.sides[0];
  const k = side.contingents.findIndex((x) => x.village === v.name);
  const mine = k >= 0 ? side.contingents[k] : null;
  // How the village's contingent bore itself, beside the rest of the line. When a whole line goes
  // it goes at once; what counts is who had gone before that.
  const decided = result.decidedAt ?? Infinity;
  const early = (result.breaks || []).filter((b) => b.unit === 0 && b.t < decided - 0.5).sort((a, b) => a.t - b.t);
  const ranEarly = mine && mine.ranAt != null && mine.ranAt < decided - 0.5;
  let conduct = lost ? 'beaten' : 'steady';
  if (mine && won && (mine.ranAt != null || mine.brokeAt != null)) conduct = 'fledWon';
  else if (mine && lost && ((early.length && early[0].contingent === k) || (ranEarly && (!early.length || mine.ranAt <= early[0].t + 0.5)))) conduct = 'startedRout';
  else if (mine && lost && early.length && !early.some((b) => b.contingent === k) && !ranEarly) conduct = 'heldLast';
  else if (won) conduct = 'won';
  if (WAR.standing[conduct]) w.standing = clamp(w.standing + WAR.standing[conduct], 0, 1);
  const honour = conduct === 'won' || conduct === 'heldLast';
  const shame = conduct === 'fledWon' || conduct === 'startedRout';

  // What you saw of the others: who shouted his men on, who hung back, who ran.
  const fallen = [];
  for (const sd of result.sides) {
    for (const x of sd.contingents) {
      const known = w.peoples && w.peoples[x.name];
      if (!known || x.village) continue;
      known.seen.battles++;
      for (const st of ['steady', 'provoke', 'linger', 'run']) known.seen[st] += (x.stanceT && x.stanceT[st]) || 0;
      if ((x.brokeAt != null && x.brokeAt < decided - 0.5) || (x.ranAt != null && x.ranAt < decided - 0.5)) known.seen.ran++;
      // A leader killed is succeeded by the man who took over from him on the field.
      if (x.leaderLost && x.leaderLost.dead && x.leader && x.leader.name !== known.leader.name) {
        fallen.push(`${known.leader.name}, who led the men of ${x.name}, ${x.leaderLost.fate === 'killed' ? 'was killed' : 'died of his wounds'}; ${x.leader.name} leads them now`);
        known.leader = { name: x.leader.name, bold: x.leader.bold, timid: x.leader.timid };
      }
    }
  }
  // How much of the fight your men were shouted into, or held back from.
  const st = (mine && mine.stanceT) || {};
  const total = (st.steady || 0) + (st.provoke || 0) + (st.linger || 0) + (st.run || 0) || 1;
  const provoked = (st.provoke || 0) / total;
  const hung = (st.linger || 0) / total;
  // Your men as a body: did they kill more than their share in the line?
  const lineKills = side.contingents.reduce((a, x) => a + (x.kills || 0), 0);
  const lineMen = side.contingents.reduce((a, x) => a + x.start, 0);
  const praised = mine && !shame && mine.kills >= 2 && mine.kills / mine.start > 1.5 * (lineKills / Math.max(1, lineMen));
  // The man of the day: the best fighter on the field, if he is yours.
  const best = [...(result.villagers || [])].filter((m) => !m.dead && !m.fled).sort((a, b) => (b.kills + b.downed) - (a.kills + a.downed))[0];
  const topOfField = result.heroes && result.heroes[0];
  const hero = best && best.kills + best.downed >= 3 && topOfField && topOfField.kills + topOfField.downed <= best.kills + best.downed && !lost ? v.people[best.villageId] : null;
  const named = !hero && best && best.kills + best.downed >= 2 && !shame ? v.people[best.villageId] : null;

  const dead = [];
  const hurt = [];
  const shields = [];
  for (const m of result.villagers || []) {
    const p = v.people[m.villageId];
    if (!p || !p.alive) continue;
    p.battles = (p.battles || 0) + 1;
    if (m.dead) {
      dead.push(p);
      const h = v.households[p.household];
      const kit = h.armoury ? h.armoury.length : 0;
      p.away = null;
      die(v, p, DEATHS[m.fate] || 'wounds taken in the battle against the Boeotians');
      // On a lost field the enemy strip the dead; only the field's holders bring the armour home.
      if (!won && h.armoury && h.armoury.length > kit) h.armoury.pop();
      addGoodwill(v, h, -(honour ? WAR.griefHonoured : WAR.grief));
      continue;
    }
    for (const x of m.wounds) {
      p.wounds.push({ day: v.day, grade: x.grade, text: x.text });
      if (x.mark) p.marks.push(x.mark);
    }
    const worst = m.wounds.reduce((a, x) => Math.max(a, x.grade), 0);
    if (worst) {
      hurt.push(p);
      p.health = clamp(p.health - 0.12 * worst - 0.04 * (m.wounds.length - 1), 0.2, 1);
    }
    // What he learned: more for being shouted into the thick of it, less for hanging back.
    const inLine = m.contingent != null;
    const exp = 1 + (inLine ? 2 * provoked - 0.6 * hung : 0) + Math.min(1, (m.fought || 0) / 40) + 0.2 * Math.min(5, m.surges || 0);
    p.skill = clamp((p.skill || 0.3) + 0.012 * Math.max(0.3, exp) * (1.1 - (p.skill || 0.3)), 0, 0.98);
    if (!m.fled) p.courage = clamp((p.courage || 0.5) + (inLine ? 0.02 * provoked : 0) + 0.004 * Math.min(5, m.surges || 0), 0, 0.98);
    else p.courage = clamp((p.courage || 0.5) - 0.02, 0.05, 0.98);
    p.reputation = clamp((p.reputation || 0) + 0.03 * m.kills + 0.02 * m.downed + (honour ? 0.04 : 0) - (m.fled ? 0.08 : 0) - (shame ? 0.04 : 0), 0, 1);
    if (!p.veteran && p.battles >= 5 && p.courage > 0.45) p.veteran = true;
    // A man who ran may have thrown his shield away to run the faster: the worst disgrace there is.
    if (m.fled && p.shield === 'aspis' && rng.chance(WAR.shieldLoss)) {
      p.shield = 'none';
      p.reputation = clamp(p.reputation - 0.1, 0, 1);
      shields.push(p);
    }
  }
  // Praise for the village's men, and a name for the best of them.
  let praise = '';
  if (praised) {
    w.standing = clamp(w.standing + 0.06, 0, 1);
    for (const m of result.villagers || []) if (m.contingent != null && !m.dead) v.people[m.villageId].reputation = clamp(v.people[m.villageId].reputation + 0.03, 0, 1);
    praise += ` ${c.general} praises the men of ${v.name} before the army: they killed ${mine.kills} of the enemy, more than their share.`;
  }
  if (hero && hero.alive) {
    hero.epithet = `the hero of ${c.place || 'the border'}`;
    hero.reputation = clamp(hero.reputation + 0.25, 0, 1);
    w.standing = clamp(w.standing + 0.08, 0, 1);
    addGoodwill(v, v.households[hero.household], 0.1);
    for (const h of aliveHouseholds(v)) addGoodwill(v, h, 0.03);
    praise += ` No man on the field did more than ${hero.name}, who killed or struck down ${best.kills + best.downed}. They are calling him ${hero.epithet}.`;
  } else if (named && named.alive) {
    named.reputation = clamp(named.reputation + 0.08, 0, 1);
    praise += ` ${named.name} is spoken of for what he did in the line.`;
  }

  // Spoils after a victory, to the common granary.
  let booty = 0;
  if (won) {
    booty = Math.round(WAR.booty * c.men.length * (0.5 + w.standing));
    v.common.grain += booty;
  }
  for (const h of aliveHouseholds(v)) addGoodwill(v, h, shame ? -WAR.shame : honour ? WAR.pride : 0);

  const names = (list) => list.map((p) => p.name).join(', ');
  const verdict = {
    fledWon: `The line won, but the men of ${v.name} ran from it. It will be talked about in the city.`,
    startedRout: `The men of ${v.name} were the first to run, and the line went after them. The city will not forget it.`,
    heldLast: `Others in the line ran, but the men of ${v.name} stood to the last.${dead.length ? ' They paid for it, and' : ''} the city will remember it.`.replace('. the', '. The'),
    won: `The Boeotians were beaten, and the men of ${v.name} did their part.`,
    beaten: `The line was beaten, and the men of ${v.name} went with the rest.`,
    steady: `Neither side won the day.`,
  }[conduct];
  logNews(v, 'alarm', `${verdict}${dead.length ? ` Dead: ${names(dead)}.` : ' None of your men were killed.'}${hurt.length ? ` Wounded: ${names(hurt)}.` : ''}${shields.length ? ` ${names(shields)} came home without ${shields.length > 1 ? 'their shields' : 'his shield'}.` : ''}${booty ? ` The village's share of the spoils, ${booty} kg, goes to the common granary.` : ''}${praise}${fallen.length ? ` ${fallen.join('. ')}.` : ''}`, { pause: true });
  w.history.push({ day: v.day, general: c.general, sent: c.men.length, dead: dead.length, conduct, won, lost });
  c.stage = 'home';
  c.homeDay = v.day + WAR.home;
  c.conduct = conduct;
  return { conduct, dead, hurt, shields, booty, praised, hero: hero && hero.alive ? hero : null };
}

export function standingWord(s) {
  return s > 0.8 ? 'honoured' : s > 0.6 ? 'well thought of' : s > 0.4 ? 'unremarkable' : s > 0.25 ? 'doubted' : 'in disgrace';
}
