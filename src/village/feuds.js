import { DEME_TRADE } from './rules.js';
import { aliveHouseholds } from './economy.js';
import { lifeStage, villageRng, ageYears } from './people.js';
import { logNews } from './clock.js';
import { die } from './life.js';
import { addGoodwill } from './council.js';
import { ATHENIAN, BOEOTIAN, demeOf, standing, regardWord } from './neighbours.js';

// Quarrels with the other demes and the Boeotians, brought to you as demarch. They reach into the
// demes' own lives: their oil and wine on the Athens market, their flocks, their daughters and
// ours, their grain in a hungry year. Handled badly, or handled with a cudgel, they leave bad blood,
// and a deme with bad blood toward Oinoe does something about it (see incident below).

const feudPick = (rng, list) => (list.length ? list[rng.int(list.length)] : null);
const feudMembers = (v, h) => h.members.map((id) => v.people[id]).filter((p) => p.alive);
const athenian = (v) => ATHENIAN.filter((n) => n !== v.name).map((n) => demeOf(v, n)).filter(standing);
const boeotian = (v) => Object.keys(BOEOTIAN).map((n) => demeOf(v, n)).filter(standing);
const town = (d) => d.town;
const chance = (v, p) => villageRng(v).chance(p);
const oinoeHas = (v, kind) => v.land.fields.some((f) => f.kind === kind);
const regard = (v, c) => (demeOf(v, c.deme) || {}).regard ?? DEME_TRADE.regard;
const sheepHouses = (v) => aliveHouseholds(v).filter((h) => h.sheep > 0);

// Sheep taken from Oinoe's houses, the biggest flocks first.
function takeSheep(v, n) {
  let left = n;
  for (const h of [...sheepHouses(v)].sort((a, b) => b.sheep - a.sheep)) {
    const k = Math.min(h.sheep, Math.ceil(left / 2));
    h.sheep -= k;
    v.flock.head = Math.max(0, v.flock.head - k);
    left -= k;
    if (left <= 0) break;
  }
  return n - Math.max(0, left);
}

// Sheep brought back, to the houses that have flocks.
function giveSheep(v, n) {
  const hs = sheepHouses(v).length ? sheepHouses(v) : aliveHouseholds(v);
  for (let i = 0; i < n; i++) {
    const h = hs[i % hs.length];
    h.sheep++;
    v.flock.head++;
  }
}

const feudQ = (key, title, need, text, options, lapse) => ({ key, title, need, text, options, lapse });

export const OUTSIDE = [
  feudQ('oil-undercut', 'Oil sold under ours', (v, r) => {
    if (!oinoeHas(v, 'olives')) return null;
    const d = feudPick(r, athenian(v).filter((x) => x.olives > 0.5 && !x.undercut));
    if (!d) return null;
    d.undercut = { good: 'oil', until: v.day + 360 };
    return { deme: d.name };
  }, (v, c) => `The men of ${c.deme} are selling their oil to the dealers at Piraeus below the going price, to take the trade, and the dealer who buys Oinoe's oil now offers a fifth less. They are ${regardWord(regard(v, c))} toward Oinoe.`,
  (v, c) => [
    { label: 'Sell under them in turn', hint: 'the Athens price falls for everyone', fx: (E) => { const d = E.deme(c.deme); d.undercut = null; v.market.oil = Math.max(DEME_TRADE.priceRange[0], (v.market.oil || 1) * 0.88); E.regard(c.deme, -0.1); E.say('Both demes sell cheap; the dealers do well out of it, and the price of oil in Athens falls.'); } },
    { label: 'Go to their demarch and agree a price', hint: `more likely the better they think of you; a gift of 100 kg from the granary`, fx: (E) => { E.spend(100, `gifts to the demarch of ${c.deme}`); if (chance(v, regard(v, c))) { E.deme(c.deme).undercut = null; E.regard(c.deme, 0.08); E.say(`${c.deme} agrees: neither sells under the other.`); } else { E.regard(c.deme, -0.05); E.say(`${c.deme} takes the gifts and goes on selling cheap.`); } } },
    { label: 'Complain to the market officials in Athens', hint: 'more likely the better the city thinks of Oinoe', fx: (E) => { if (chance(v, v.war ? v.war.standing : 0.5)) { E.deme(c.deme).undercut = null; E.regard(c.deme, -0.15); E.feud(c.deme, 0.1); E.say(`The officials fine ${c.deme} for selling under the market. They will not forget who complained.`); } else { E.standing(-0.02); E.regard(c.deme, -0.08); E.say('The officials have better things to do.'); } } },
    { label: 'Send the young men to wreck their press', hint: 'bad blood; the city will hear', fx: (E) => { const d = E.deme(c.deme); d.undercut = null; d.olives *= 0.75; E.regard(c.deme, -0.35); E.feud(c.deme, 0.55); E.standing(-0.05); E.say(`The press at ${c.deme} is smashed and a quarter of its olives cut. ${c.deme} will want its own back.`); } },
  ],
  (E, c) => E.say(`${c.deme} goes on selling under Oinoe through the year.`)),

  feudQ('wine-passed-off', 'Their wine sold as ours', (v, r) => {
    if (!oinoeHas(v, 'vines')) return null;
    const d = feudPick(r, athenian(v).filter((x) => x.vines > 0.5 && !x.undercut));
    if (!d) return null;
    d.undercut = { good: 'wine', until: v.day + 360 };
    return { deme: d.name };
  }, (v, c) => `Thin wine is going to the Athens taverns in jars stamped as from Oinoe, cheaper than ours. The carters say it comes from ${c.deme}. Our dealer pays less, and says our name for wine is going sour.`,
  (v, c) => [
    { label: 'A seal for Oinoe\'s jars, paid from the granary', hint: '80 kg from the granary', fx: (E) => { E.spend(80, 'a deme seal and stamps for the jars'); E.deme(c.deme).undercut = null; E.say('Oinoe\'s jars carry the deme\'s seal; the dealers pay for the name again.'); } },
    { label: 'Have it out with their demarch', hint: 'more likely the better they think of you', fx: (E) => { if (chance(v, regard(v, c))) { E.deme(c.deme).undercut = null; E.regard(c.deme, 0.03); E.say(`${c.deme} owns to it and stops.`); } else { E.regard(c.deme, -0.1); E.feud(c.deme, 0.1); E.say(`${c.deme} denies everything, loudly.`); } } },
    { label: 'Break their jars on the road to Athens', hint: 'bad blood; the city will hear', fx: (E) => { E.deme(c.deme).undercut = null; E.regard(c.deme, -0.3); E.feud(c.deme, 0.45); E.standing(-0.04); E.say(`Three cartloads of ${c.deme}'s wine run into the dust of the road.`); } },
  ],
  (E, c) => E.say(`The false Oinoe wine goes on selling.`)),

  feudQ('daughter-wronged', 'Our daughter mistreated', (v, r) => {
    const w = feudPick(r, v.people.filter((p) => p.gone && ATHENIAN.includes(p.gone) && v.day - p.diedOn < 3 * 360 && p.father >= 0 && v.people[p.father] && v.households[v.people[p.father].household] && feudMembers(v, v.households[v.people[p.father].household]).length));
    if (!w) return null;
    const A = v.households[v.people[w.father].household];
    return { deme: w.gone, w: w.id, A: A.id };
  }, (v, c) => `${v.people[c.w].name}, whom ${v.households[c.A].player ? 'your house' : `the house of ${v.households[c.A].name}`} married into ${c.deme}, has sent word by a carter that her husband beats her and his mother starves her, and begs to be brought home. Her family want the deme to act.`,
  (v, c) => [
    { label: 'Demand her back, with her dowry', hint: 'more likely the better they think of you', favours: c.A, fx: (E) => { const w = v.people[c.w]; if (chance(v, regard(v, c) + 0.2)) { w.alive = true; w.gone = null; w.cause = null; w.spouse = -1; w.household = c.A; v.households[c.A].members.push(w.id); const d = E.deme(c.deme); if (d) d.women = Math.max(0, d.women - 1); v.households[c.A].stores.grain += 60; E.gw(c.A, 0.08); E.regard(c.deme, -0.12); E.say(`${w.name} comes home, with her dowry.`); } else { E.gw(c.A, -0.04); E.regard(c.deme, -0.15); E.feud(c.deme, 0.15); E.say(`${c.deme} will not give her up: she is their son's wife.`); } } },
    { label: 'Send gifts, and a warning from the demarch', hint: '50 kg from her family', fx: (E) => { v.households[c.A].stores.grain = Math.max(0, v.households[c.A].stores.grain - 50); E.regard(c.deme, 0.04); E.gw(c.A, 0.02); E.say(`The gifts are taken; word comes that she is treated better.`); } },
    { label: 'Her brothers go and settle it', hint: 'bad blood', fx: (E) => { E.gw(c.A, 0.06); E.regard(c.deme, -0.25); E.feud(c.deme, 0.4); E.say(`Her brothers beat her husband in his own courtyard. ${c.deme} is in uproar.`); } },
    { label: 'She belongs to their house now', fx: (E) => { E.gw(c.A, -0.1); E.say('Her family will not forgive the deme for it.'); } },
  ],
  (E, c) => { E.gw(c.A, -0.08); E.say('Nobody goes for her.'); }),

  feudQ('flock-trespass', 'Their flock on our hills', (v, r) => {
    if (v.flock.head < 20) return null;
    const d = feudPick(r, [...athenian(v), ...boeotian(v)].filter((x) => x.sheep > 100));
    return d && { deme: d.name, boeotian: d.side === 'boeotia' };
  }, (v, c) => `${c.boeotian ? `Herders of the ${c.deme}, from ${town(demeOf(v, c.deme))}, have` : `The herders of ${c.deme} have`} been bringing their flocks onto the hills where Oinoe's sheep graze, and there is not grass for both. Our herders want to drive them off.`,
  (v, c) => [
    { label: 'Seize a dozen of their sheep as the price of the grass', hint: 'bad blood', fx: (E) => { const d = E.deme(c.deme); const n = Math.min(12, d.sheep); d.sheep -= n; giveSheep(v, n); E.regard(c.deme, -0.2); E.feud(c.deme, c.boeotian ? 0.45 : 0.3); E.say(`Oinoe's herders drive off ${n} of their sheep.`); } },
    { label: 'Ask a grazing fee', hint: 'more likely the better they think of you', fx: (E) => { if (chance(v, regard(v, c))) { v.common.grain += 80; E.say(`${c.deme} pays 80 kg of barley a year for the grass.`); } else { E.regard(c.deme, -0.08); E.say(`${c.deme} laughs at the idea.`); } } },
    { label: 'Share the hills', fx: (E) => { E.regard(c.deme, 0.08); v.flock.ewes = Math.max(0, v.flock.ewes - 5); E.all(-0.01); E.say('The hills are shared; Oinoe\'s flock goes a little hungrier.'); } },
  ],
  (E, c, v) => { v.flock.ewes = Math.max(0, v.flock.ewes - 8); E.say('The other flock stays on the hills; Oinoe\'s ewes go hungry, and fewer lambs will come.'); }),

  feudQ('border-stones', 'The border stones', (v, r) => {
    const f = feudPick(r, v.land.fields.filter((x) => x.owner >= 0 && x.dist > 800 && v.households[x.owner]));
    const d = feudPick(r, athenian(v));
    return f && d && { deme: d.name, f: f.id, A: f.owner };
  }, (v, c) => `${c.deme} says the stones marking the border between the two demes have stood wrong since the old war, and that ${v.land.fields[c.f].name}, ${v.households[c.A].player ? 'your house\'s' : `the house of ${v.households[c.A].name}'s`} field at the far edge, is theirs.`,
  (v, c) => [
    { label: 'Take it to the courts in Athens', hint: '15 drachmae from the granary; more likely the better the city thinks of Oinoe', fx: (E) => { E.spend(150, 'the court fees'); if (chance(v, 0.3 + (v.war ? v.war.standing : 0.5) * 0.6)) { E.regard(c.deme, -0.1); E.gw(c.A, 0.04); E.say('The court finds for Oinoe: the stones stand.'); } else { v.households[c.A].stores.grain = Math.max(0, v.households[c.A].stores.grain - 150); E.gw(c.A, -0.06); E.say(`The court finds for ${c.deme}: the house pays them for the land it has worked, and keeps it on sufferance.`); } } },
    { label: 'Walk the bounds together with both demes\' old men', hint: 'more likely the better they think of you', fx: (E) => { if (chance(v, regard(v, c))) { E.regard(c.deme, 0.06); E.say('The old men agree where the stones stood.'); } else { E.regard(c.deme, -0.06); E.feud(c.deme, 0.1); E.say('The old men come to blows over a stone.'); } } },
    { label: 'Pull up their new stones', hint: 'bad blood', fx: (E) => { E.regard(c.deme, -0.2); E.feud(c.deme, 0.3); E.say(`Oinoe's men throw ${c.deme}'s new stones into the gully.`); } },
  ]),

  feudQ('festival-brawl', 'A man of ours beaten at their festival', (v, r) => {
    const cands = aliveHouseholds(v).flatMap((h) => feudMembers(v, h).filter((p) => p.sex === 'm' && !p.slave && !p.player && lifeStage(v, p) === 'adult').map((p) => [h, p]));
    const got = feudPick(r, cands);
    const d = feudPick(r, athenian(v));
    if (!got || !d) return null;
    const [A, p] = got;
    p.health = Math.max(0.15, p.health - 0.4);
    return { deme: d.name, A: A.id, p: p.id };
  }, (v, c) => `${v.people[c.p].name} of ${v.households[c.A].player ? 'your house' : `the house of ${v.households[c.A].name}`} went to the festival at ${c.deme} and was carried home: their young men set on him over a girl, and he may not walk again. His family want blood or blood-money.`,
  (v, c) => [
    { label: 'Prosecute in Athens for the wounding', hint: 'more likely the better the city thinks of Oinoe', favours: c.A, fx: (E) => { if (chance(v, 0.3 + (v.war ? v.war.standing : 0.5) * 0.6)) { v.households[c.A].stores.coin = (v.households[c.A].stores.coin || 0) + 30; E.gw(c.A, 0.06); E.regard(c.deme, -0.12); E.say(`The court awards ${v.people[c.p].name}'s house thirty drachmae from ${c.deme}.`); } else { E.gw(c.A, -0.04); E.say('The witnesses from the festival all saw it differently.'); } } },
    { label: 'Ask blood-money of their demarch', hint: 'more likely the better they think of you', fx: (E) => { if (chance(v, regard(v, c))) { v.households[c.A].stores.grain += 150; E.gw(c.A, 0.04); E.regard(c.deme, 0.02); E.say(`${c.deme} pays 150 kg of barley to the house.`); } else { E.regard(c.deme, -0.08); E.feud(c.deme, 0.1); E.gw(c.A, -0.03); E.say(`${c.deme} says he started it.`); } } },
    { label: 'Let his kin take revenge', hint: 'blood for blood', fx: (E) => { const d = E.deme(c.deme); if (d) d.men = Math.max(0, d.men - 1); E.gw(c.A, 0.06); E.regard(c.deme, -0.35); E.feud(c.deme, 0.6); E.standing(-0.05); E.say(`A man of ${c.deme} is found dead on the road. Everyone knows why.`); } },
  ],
  (E, c) => { E.gw(c.A, -0.08); E.say('Nothing is done for him.'); }),

  feudQ('rustlers', 'Boeotians took our sheep', (v, r) => {
    if (v.flock.head < 15) return null;
    const d = feudPick(r, boeotian(v));
    if (!d) return null;
    const n = takeSheep(v, 6 + r.int(10));
    d.sheep += n;
    return { deme: d.name, n };
  }, (v, c) => `Boeotians of the ${c.deme} came over the hills before dawn and drove off ${c.n} of Oinoe's sheep. The herders followed the tracks to the border.`,
  (v, c) => [
    { label: 'Go over the border and take back twice as many', hint: 'a fight; bad blood', fx: (E) => { const rng = villageRng(v); const d = E.deme(c.deme); const n = Math.min(d.sheep, c.n * 2); d.sheep -= n; giveSheep(v, n); E.feud(c.deme, 0.5); E.regard(c.deme, -0.2); E.all(0.02); const men = aliveHouseholds(v).flatMap((h) => feudMembers(v, h)).filter((p) => p.sex === 'm' && !p.slave && !p.player && lifeStage(v, p) === 'adult'); if (rng.chance(0.35) && men.length) { const p = men[rng.int(men.length)]; if (rng.chance(0.4)) { die(v, p, `the raid over the border for the sheep`); E.say(`${p.name} was killed in the fight.`); } else { p.health = Math.max(0.2, p.health - 0.35); E.say(`${p.name} was wounded.`); } } E.say(`Oinoe's young men come back with ${n} sheep.`); } },
    { label: 'Report it to the general', hint: 'the city may do something', fx: (E) => { if (chance(v, 0.3)) { giveSheep(v, c.n); E.say('A patrol from Panakton brings the sheep back.'); } else E.say('The general has a war to fight.'); } },
    { label: 'Watch the border better; let them go', fx: (E) => { E.all(-0.02); E.say('The houses that lost sheep grumble that the demarch does nothing.'); } },
  ]),

  feudQ('hungry-deme', 'A hungry deme asks for grain', (v, r) => {
    const d = feudPick(r, athenian(v).filter((x) => x.burned || x.grain < (x.men + x.women + x.boys + x.girls + x.old) * 200));
    if (!d || v.common.grain < 200) return null;
    return { deme: d.name, kg: Math.min(600, Math.round(v.common.grain * 0.4 / 10) * 10) };
  }, (v, c) => `${c.deme}'s fields were burned and its people are hungry. Its demarch has come to ask Oinoe for barley from the common granary: ${c.kg} kg, to be paid back at the next harvest, or bought now with what coin they have.`,
  (v, c) => [
    { label: 'Lend it, to be paid back with a fifth', hint: `${c.kg} kg from the granary`, fx: (E) => { E.spend(c.kg, `the loan to ${c.deme}`); const d = E.deme(c.deme); d.grain += c.kg; d.owes = (d.owes || 0) + c.kg * 1.2; E.regard(c.deme, 0.15); } },
    { label: 'Sell it at the hungry-time price', hint: `${Math.round(c.kg * 0.25)} drachmae`, fx: (E) => { E.spend(c.kg, `the sale to ${c.deme}`); E.deme(c.deme).grain += c.kg; const rich = [...aliveHouseholds(v)].sort((a, b) => b.wealth - a.wealth); const per = Math.round(c.kg * 0.25 / Math.max(1, rich.length)); for (const h of rich) h.stores.coin = (h.stores.coin || 0) + per; E.regard(c.deme, -0.05); E.say(`The coin is shared among the houses: ${per} drachmae each.`); } },
    { label: 'Give it, as neighbours should', hint: `${c.kg} kg from the granary`, fx: (E) => { E.spend(c.kg, `a gift to ${c.deme}`); E.deme(c.deme).grain += c.kg; E.regard(c.deme, 0.3); E.all(-0.01); } },
    { label: 'Oinoe has none to spare', fx: (E) => { E.regard(c.deme, -0.15); } },
  ],
  (E, c) => { E.regard(c.deme, -0.12); E.say(`${c.deme}'s demarch goes home empty-handed.`); }),

  feudQ('runaway-across', 'A slave run to another deme', (v, r) => {
    const cands = aliveHouseholds(v).flatMap((h) => feudMembers(v, h).filter((p) => p.slave).map((p) => [h, p]));
    const got = feudPick(r, cands);
    const d = feudPick(r, athenian(v));
    if (!got || !d) return null;
    const [A, p] = got;
    // He is gone already.
    A.members = A.members.filter((id) => id !== p.id);
    p.alive = false;
    p.gone = d.name;
    p.cause = `ran away to ${d.name}`;
    p.diedOn = v.day;
    return { deme: d.name, A: A.id, p: p.id };
  }, (v, c) => `${v.people[c.p].name}, a slave of ${v.households[c.A].player ? 'your house' : `the house of ${v.households[c.A].name}`}, has run off and is working for a man in ${c.deme}, who says he came to him free and will not give him up.`,
  (v, c) => [
    { label: 'Demand him back', hint: 'more likely the better they think of you', favours: c.A, fx: (E) => { const p = v.people[c.p]; if (chance(v, regard(v, c) + 0.1)) { p.alive = true; p.gone = null; p.cause = null; p.household = c.A; v.households[c.A].members.push(p.id); E.gw(c.A, 0.04); E.regard(c.deme, -0.05); E.say(`${p.name} is brought back.`); } else { E.gw(c.A, -0.04); E.regard(c.deme, -0.1); E.say(`${c.deme} will not give him up.`); } } },
    { label: 'Ask his price instead', hint: 'more likely the better they think of you', fx: (E) => { if (chance(v, regard(v, c))) { v.households[c.A].stores.coin = (v.households[c.A].stores.coin || 0) + 60; E.say(`The man in ${c.deme} pays sixty drachmae for him.`); } else { E.regard(c.deme, -0.05); E.say('He will not pay for what came to him free.'); } } },
    { label: 'Fetch him by force', hint: 'bad blood', fx: (E) => { const p = v.people[c.p]; p.alive = true; p.gone = null; p.cause = null; p.household = c.A; v.households[c.A].members.push(p.id); E.regard(c.deme, -0.25); E.feud(c.deme, 0.35); E.standing(-0.03); E.say(`${p.name} is dragged back in the night. ${c.deme} calls it kidnapping.`); } },
  ],
  (E, c) => { E.gw(c.A, -0.04); }),

  feudQ('enemy-trade', 'Boeotians offer to buy', (v, r) => {
    const d = feudPick(r, boeotian(v).filter((x) => x.burned || x.grain < (x.men + x.women + x.boys + x.girls + x.old) * 250));
    if (!d || v.common.grain < 300) return null;
    return { deme: d.name, kg: 300 };
  }, (v, c) => `Men of the ${c.deme}, hungry after their fields were burned, come quietly over the hills offering silver for barley: 300 kg from the common granary at twice the price in Athens. Trading with the enemy in a war is treason if the city hears of it.`,
  (v, c) => [
    { label: 'Sell, quietly', hint: 'coin; the city may hear', fx: (E) => { E.spend(c.kg, 'the sale over the border'); E.deme(c.deme).grain += c.kg; const hs = aliveHouseholds(v); const per = Math.round(c.kg * 0.25 / Math.max(1, hs.length)); for (const h of hs) h.stores.coin = (h.stores.coin || 0) + per; E.regard(c.deme, 0.25); E.feud(c.deme, -0.3); E.say(`Every house has ${per} drachmae from it, and the ${c.deme} think better of Oinoe.`); if (chance(v, 0.3)) { E.standing(-0.15); E.say('The city hears of it. Oinoe is in disgrace.'); } } },
    { label: 'Turn them away', fx: (E) => { E.regard(c.deme, -0.05); } },
    { label: 'Seize them and send them to the general', hint: 'honour with the city; bad blood over the border', fx: (E) => { E.standing(0.05); E.feud(c.deme, 0.3); E.regard(c.deme, -0.2); E.say(`The general thanks Oinoe. The ${c.deme} will remember.`); } },
  ]),
];

// Something done to Oinoe by a deme with bad blood toward it.
export function incident(v, rng, d) {
  const hs = aliveHouseholds(v);
  const men = hs.flatMap((h) => feudMembers(v, h)).filter((p) => p.sex === 'm' && !p.slave && !p.player && lifeStage(v, p) === 'adult' && !p.away);
  const by = d.side === 'boeotia' ? `Boeotians of the ${d.name}` : `Men of ${d.name}`;
  const roll = rng.next();
  let text = null;
  if (roll < 0.3 && v.flock.head > 5) {
    const n = takeSheep(v, 4 + rng.int(d.side === 'boeotia' ? 12 : 6));
    d.sheep += n;
    text = `${by} drove off ${n} of Oinoe's sheep in the night.`;
  } else if (roll < 0.5) {
    const f = rng.pick(v.land.fields.filter((x) => x.owner >= 0 && (x.kind || x.state === 'sown')) || []);
    if (f && f.kind === 'vines') {
      f.planted = Math.max(f.planted ?? v.day, v.day - 360 * 2);
      text = `${by} cut down the vines on ${f.name} in the night. They will grow again from the stocks, in a year or two.`;
    } else if (f && f.kind === 'olives') {
      if (f.state === 'ripe') f.crop *= 0.3;
      text = `${by} stripped and broke the olive trees on ${f.name}.`;
    } else if (f) {
      f.crop = 0;
      if (f.state === 'sown') f.quality = 0.2;
      text = `${by} trampled and fired the young barley on ${f.name}.`;
    }
    if (f && v.households[f.owner]) addGoodwill(v, v.households[f.owner], -0.03);
  } else if (men.length) {
    const p = men[rng.int(men.length)];
    if (d.feud > 0.6 && rng.chance(0.35)) {
      die(v, p, `an ambush by men of ${d.name}`);
      text = `${p.name} was ambushed on the road by ${by.replace(/^Men/, 'men')} and killed.`;
    } else {
      p.health = Math.max(0.15, p.health - 0.35);
      text = `${p.name} was set on by ${by.replace(/^Men/, 'men')} on the road and badly beaten.`;
    }
    addGoodwill(v, v.households[p.household], -0.04);
  }
  if (!text) return;
  // Bad blood breeds bad blood.
  d.feud = Math.min(1, d.feud + 0.05);
  logNews(v, 'alarm', `${text} The bad blood between Oinoe and ${d.name} grows.`, { pause: true });
}
