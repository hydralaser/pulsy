import { WAR } from './rules.js';
import { clamp } from '../sim/core.js';
import { villageRng, canFight, ageOf } from './people.js';
import { aliveHouseholds, pay } from './economy.js';
import { tie, addGoodwill } from './council.js';
import { die } from './life.js';
import { logNews } from './clock.js';
import { homeOf } from './work.js';

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
    for (const m of x.members) m.pays = x.sends && m.h !== x.sender ? Math.round(m.frac * WAR.shareCost) : 0;
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
      w.summons = { day: v.day, general: rng.pick(GENERALS), reason: rng.pick(REASONS), seed: 1 + rng.int(99999) };
      logNews(v, 'alarm', `A rider from the strategos ${w.summons.general}: ${w.summons.reason}. He calls on ${v.name} for its share of men.`, { pause: true });
    } else w.next = v.day + 30;
  }
  if (w.summons && v.day - w.summons.day >= WAR.answer) answerSummons(v, 0, true);
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

// Your answer: a share of the fighting men, or none. Silence counts as none.
export function answerSummons(v, share, lapsed = false) {
  const w = v.war;
  const s = w.summons;
  if (!s) return null;
  w.summons = null;
  const rng = villageRng(v);
  w.next = v.day + Math.round(rng.range(WAR.every[0], WAR.every[1]));
  const plan = planLevy(v, share);
  if (!plan.men.length) {
    w.standing = clamp(w.standing + WAR.standing.none, 0, 1);
    // A deme already in bad odour is fined for it.
    let fined = 0;
    if (w.standing < 0.3) {
      fined = Math.min(v.common.grain, WAR.fine);
      v.common.grain -= fined;
    }
    logNews(v, 'alarm', `${lapsed ? 'No answer goes back' : 'You send word that no one will come'}. ${s.general} marches without the men of ${v.name}, and the city will hear of it.${fined ? ` The deme is fined ${Math.round(fined)} kg of barley from the common granary.` : ''}`);
    w.history.push({ day: v.day, general: s.general, sent: 0 });
    return plan;
  }
  w.standing = clamp(w.standing + (share >= 0.3 ? WAR.standing.many : share < 0.2 ? WAR.standing.few : 0), 0, 1);
  // Those who clubbed together pay the man who goes for them.
  for (const g of plan.groups) {
    if (!g.sends) continue;
    for (const m of g.members) if (m.pays) pay(v, m.h, g.sender, m.pays, 'a man for the levy');
  }
  for (const id of plan.men) {
    const p = v.people[id];
    p.away = { war: true };
    p.state = 'away';
    p.task = null;
    p.goal = null;
  }
  const fighters = plan.rows.reduce((a, r) => a + r.fighters, 0);
  w.campaign = { stage: 'marching', general: s.general, reason: s.reason, seed: s.seed, share, fighters, men: plan.men, groups: plan.groups, leftDay: v.day, battleDay: v.day + WAR.march };
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
    allies.push({ name, count, quality: rng.pick(['green', 'regular', 'regular', 'veteran']), kit: rng.pick(['poor', 'standard', 'standard', 'well']) });
  }
  const contingents = [...allies];
  let mine = null;
  if (hoplites.length) {
    mine = rng.int(contingents.length + 1);
    contingents.splice(mine, 0, { name: v.name, count: hoplites.length, quality: 'regular', kit: 'standard', village: v.name, men: hoplites });
  }
  const ours = contingents.reduce((a, x) => a + x.count, 0);
  // The Boeotians, about as many, in two or three contingents of their towns.
  const theirs = Math.max(12, Math.round(ours * rng.range(0.8, 1.25)));
  const towns = [...BOEOTIANS];
  const nTowns = theirs > 36 ? 3 : 2;
  const enemy = [];
  for (let i = 0; i < nTowns; i++) {
    const name = towns.splice(rng.int(towns.length), 1)[0];
    enemy.push({ name, count: Math.round(theirs / nTowns), quality: rng.pick(['green', 'regular', 'regular', 'veteran']), kit: rng.pick(['poor', 'standard', 'standard', 'well']) });
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
        : `Your ${hoplites.length} men stand together in the line, ${mine === 0 ? 'on the left' : mine === contingents.length - 1 ? 'on the right, the place of honour' : 'in the centre'}. You lead them, not the line: hold them steady, shout them on, or tell them to run.`,
    lights.length && mine != null ? `${lights.length} more of your men, without the hoplite shield, are out with the light troops.` : '',
    'Men who run from a winning fight, or start a rout, shame the village. Men who stand when all the rest have gone pay for it in blood.',
  ].filter(Boolean);
  const names = {};
  for (const p of men) names[p.id] = p.name;
  const title = `${c.general}' army against the Boeotians, with the men of ${v.name}`;
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
    p.skill = clamp((p.skill || 0.3) + 0.02, 0, 0.98);
    p.reputation = clamp((p.reputation || 0) + 0.03 * m.kills + 0.02 * m.downed + (honour ? 0.04 : 0) - (m.fled ? 0.08 : 0) - (shame ? 0.04 : 0), 0, 1);
    if (!p.veteran && p.battles >= 5 && p.courage > 0.45) p.veteran = true;
    // A man who ran may have thrown his shield away to run the faster: the worst disgrace there is.
    if (m.fled && p.shield === 'aspis' && rng.chance(WAR.shieldLoss)) {
      p.shield = 'none';
      p.reputation = clamp(p.reputation - 0.1, 0, 1);
      shields.push(p);
    }
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
  logNews(v, 'alarm', `${verdict}${dead.length ? ` Dead: ${names(dead)}.` : ' None of your men were killed.'}${hurt.length ? ` Wounded: ${names(hurt)}.` : ''}${shields.length ? ` ${names(shields)} came home without ${shields.length > 1 ? 'their shields' : 'his shield'}.` : ''}${booty ? ` The village's share of the spoils, ${booty} kg, goes to the common granary.` : ''}`, { pause: true });
  w.history.push({ day: v.day, general: c.general, sent: c.men.length, dead: dead.length, conduct, won, lost });
  c.stage = 'home';
  c.homeDay = v.day + WAR.home;
  c.conduct = conduct;
  return { conduct, dead, hurt, shields, booty };
}

export function standingWord(s) {
  return s > 0.8 ? 'honoured' : s > 0.6 ? 'well thought of' : s > 0.4 ? 'unremarkable' : s > 0.25 ? 'doubted' : 'in disgrace';
}
