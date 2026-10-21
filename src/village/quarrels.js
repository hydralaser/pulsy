import { aliveHouseholds } from './economy.js';
import { lifeStage, ageYears } from './people.js';
import { headOf } from './family.js';
import { monthOf } from './clock.js';
import { tie } from './council.js';

// The village's own quarrels, a hundred of them, each brought to you by the houses it is between.
// Each finds, in the village as it is, the houses and people it could be about, or does not come up:
// sheep in the barley needs a house with sheep beside another's sown field; a debt denied needs a
// debt. What you rule moves barley, coin and beasts between them, and their regard for you and for
// each other.

// ---- finding who a quarrel is between ----

const alive = (v, id) => v.people[id] && v.people[id].alive;
const members = (v, h) => h.members.map((id) => v.people[id]).filter((p) => p.alive);
const adultMen = (v, h) => members(v, h).filter((p) => p.sex === 'm' && !p.slave && lifeStage(v, p) === 'adult');
const manOf = (v, h) => {
  const head = headOf(v, h);
  return head && head.alive && !head.slave ? head : adultMen(v, h)[0] || members(v, h)[0];
};
const others = (v) => aliveHouseholds(v).filter((h) => !h.player && adultMen(v, h).length);
const mine = (v) => v.households.find((h) => h.player && members(v, h).length);
const pick = (rng, list) => (list.length ? list[rng.int(list.length)] : null);
const year = (v) => Math.floor(v.day / 360);

function pair(v, rng, okA = () => true, okB = () => true) {
  const A = pick(rng, others(v).filter((h) => okA(h)));
  if (!A) return null;
  const B = pick(rng, others(v).filter((h) => h !== A && okB(h, A)));
  if (!B) return null;
  return { A: A.id, B: B.id, a: manOf(v, A).id, b: manOf(v, B).id };
}

// Yours against another house.
function withMine(v, rng, okB = () => true) {
  const A = mine(v);
  const B = pick(rng, others(v).filter((h) => okB(h, A)));
  if (!A || !B) return null;
  return { A: A.id, B: B.id, a: manOf(v, A).id, b: manOf(v, B).id };
}

// Two fields side by side with different owners.
function nearFields(v, rng, okA = () => true, okB = () => true, mineToo = false) {
  const fs = v.land.fields.filter((f) => f.owner >= 0 && v.households[f.owner] && (mineToo || !v.households[f.owner].player));
  const pairs = [];
  for (const f of fs) {
    if (!okA(f)) continue;
    for (const g of fs) if (g.owner !== f.owner && okB(g) && Math.hypot(f.x - g.x, f.y - g.y) < 200) pairs.push([f, g]);
  }
  const p = pick(rng, pairs);
  if (!p) return null;
  const [f, g] = p;
  const A = v.households[f.owner];
  const B = v.households[g.owner];
  if (!adultMen(v, A).length || !adultMen(v, B).length) return null;
  return { A: A.id, B: B.id, a: manOf(v, A).id, b: manOf(v, B).id, f: f.id, g: g.id };
}

function debtPair(v, rng, min = 40) {
  const d = pick(rng, (v.debts || []).filter((x) => x.kg >= min && v.households[x.from] && v.households[x.to] && !v.households[x.from].player && !v.households[x.to].player && adultMen(v, v.households[x.from]).length && adultMen(v, v.households[x.to]).length));
  if (!d) return null;
  // A is owed, B owes.
  const A = v.households[d.to];
  const B = v.households[d.from];
  return { A: A.id, B: B.id, a: manOf(v, A).id, b: manOf(v, B).id, kg: Math.round(d.kg) };
}

// A house with someone in it the quarrel is about.
function withPerson(v, rng, pred, okB = () => true) {
  const cands = [];
  for (const h of others(v)) for (const p of members(v, h)) if (pred(p, h)) cands.push([h, p]);
  const got = pick(rng, cands);
  if (!got) return null;
  const [A, p] = got;
  const B = pick(rng, others(v).filter((h) => h !== A && okB(h, A, p)));
  if (!B) return null;
  return { A: A.id, B: B.id, a: manOf(v, A).id, b: manOf(v, B).id, p: p.id };
}

const has = (v, h, k) => v.land.fields.some((f) => f.owner === h.id && f.kind === k);
const orchard = (v, h) => v.land.fields.some((f) => f.owner === h.id && f.kind);
const sown = (f) => !f.kind && (f.state === 'sown' || f.state === 'ripe');
const ofAge = (lo, hi) => (v, p) => ageYears(v, p) >= lo && ageYears(v, p) < hi;
const kgOf = (rng, lo, hi) => Math.round((lo + rng.int(hi - lo + 1)) / 5) * 5;
const yoked = (v, h) => v.yokes.some((y) => y.owner === h.id);

// ---- words ----

const N = (v, id) => (v.households[id].player ? 'your house' : `the house of ${v.households[id].name}`);
const Nc = (v, id) => (v.households[id].player ? 'Your house' : `The house of ${v.households[id].name}`);
const P = (v, id) => v.people[id].name;
const F = (v, id) => v.land.fields[id].name;

// ---- the usual rulings ----

// For one side: the other pays, the winner is pleased, the loser not, and they like each other less.
function rule(c, who, kg, label, more, hint) {
  const win = who === 'A' ? c.A : c.B;
  const lose = who === 'A' ? c.B : c.A;
  return {
    label,
    hint: hint || (kg ? `${kg} kg of barley` : ''),
    favours: win,
    fx: (E) => {
      if (kg) E.grain(lose, win, kg);
      E.gw(win, 0.04);
      E.gw(lose, -0.06);
      E.tie(win, lose, -0.05);
      if (more) more(E);
    },
  };
}

// Halves: something for the one who brought it, and the peace kept.
function quarrelSplit(c, kg, label, more, payer = 'B') {
  const from = payer === 'B' ? c.B : c.A;
  const to = payer === 'B' ? c.A : c.B;
  return {
    label,
    hint: kg ? `${Math.round(kg / 2)} kg of barley` : '',
    fx: (E) => {
      if (kg) E.grain(from, to, kg / 2);
      E.gw(c.A, 0.01);
      E.gw(c.B, 0.01);
      E.tie(c.A, c.B, 0.04);
      if (more) more(E);
    },
  };
}

// Sent away to settle it themselves, or to arbitrators.
function dismiss(c, label, more) {
  return {
    label,
    hint: 'neither pleased',
    fx: (E) => {
      E.gw(c.A, -0.03);
      E.gw(c.B, -0.03);
      if (more) more(E);
    },
  };
}

// A fine to the common granary on the one at fault, and the matter closed.
function fine(c, who, kg, label, more) {
  const id = who === 'A' ? c.A : c.B;
  return {
    label,
    hint: `${kg} kg to the common granary`,
    fx: (E) => {
      E.fine(id, kg);
      E.gw(id, -0.04);
      E.all(0.01);
      if (more) more(E);
    },
  };
}

const q = (key, title, need, text, options, lapse) => ({ key, title, need, text, options, lapse });

// ---- the hundred ----

export const INTERNAL = [
  // ---- land and boundaries ----
  q('stone-moved', 'A boundary stone moved', (v, r) => {
    const c = nearFields(v, r);
    return c && { ...c, kg: kgOf(r, 40, 120) };
  }, (v, c) => `${P(v, c.a)} swears the boundary stone between ${F(v, c.f)} and ${F(v, c.g)} has crept a full furrow onto his land since the spring, and that ${P(v, c.b)} moved it by night. ${P(v, c.b)} says the stone stands where his grandfather set it.`,
  (v, c) => [rule(c, 'A', c.kg, 'The stone goes back; he pays for the land he took'), rule(c, 'B', 0, 'The stone stays where it is'), quarrelSplit(c, 0, 'Walk the bounds with the old men and set it between the two', (E) => E.all(0.01))]),

  q('furrow-over', 'Ploughed over the line', (v, r) => {
    const c = nearFields(v, r, (f) => !f.kind, (g) => !g.kind);
    return c && { ...c, kg: kgOf(r, 30, 90) };
  }, (v, c) => `${P(v, c.b)}'s ploughman turned his oxen on ${P(v, c.a)}'s side of the headland and ploughed and sowed a strip of ${F(v, c.f)}. ${P(v, c.a)} wants the crop off it.`,
  (v, c) => [rule(c, 'A', c.kg, 'The crop of the strip is his'), quarrelSplit(c, c.kg, 'Share the strip\'s crop this year, and mark the headland'), dismiss(c, 'A ploughman\'s slip; let them settle it')]),

  q('path-across', 'A path through the barley', (v, r) => {
    const c = nearFields(v, r, sown);
    return c && { ...c, kg: kgOf(r, 20, 60) };
  }, (v, c) => `The house of ${v.households[c.B].name} drives its beasts across ${F(v, c.f)} to reach its own land, trampling a path through ${P(v, c.a)}'s barley. They say the path was there before the field was.`,
  (v, c) => [rule(c, 'A', c.kg, 'No path: they go round, and pay for the trampling'), rule(c, 'B', 0, 'An old path is a right of way'), quarrelSplit(c, 0, 'A path along the edge, and they keep to it', (E) => E.tie(c.A, c.B, 0.03))]),

  q('stones-thrown', 'Stones cleared onto a neighbour', (v, r) => nearFields(v, r), (v, c) => `${P(v, c.b)} has been clearing stones from ${F(v, c.g)} and piling them along the edge of ${P(v, c.a)}'s ${F(v, c.f)}, where they spill into the furrows.`,
  (v, c) => [rule(c, 'A', 30, 'He carries them off, and pays for the trouble'), quarrelSplit(c, 0, 'Build them into a wall on the line, both houses at it'), dismiss(c, 'Stones are stones; let them sort it out')]),

  q('fig-boundary', 'Whose figs?', (v, r) => {
    const c = nearFields(v, r);
    return c && { ...c, kg: kgOf(r, 20, 50) };
  }, (v, c) => `A fig tree stands on the line between ${F(v, c.f)} and ${F(v, c.g)}. ${P(v, c.a)} has always picked it; this year ${P(v, c.b)}'s sons stripped it first, and say its roots are on their side.`,
  (v, c) => [rule(c, 'A', c.kg, 'The tree is his; they pay for the figs'), rule(c, 'B', 0, 'The roots decide: it is theirs'), quarrelSplit(c, 0, 'Each picks the branches over his own land')]),

  q('terrace-slip', 'A terrace wall fallen', (v, r) => {
    const c = nearFields(v, r);
    return c && { ...c, kg: kgOf(r, 40, 100) };
  }, (v, c) => `The rains brought down ${P(v, c.b)}'s terrace wall above ${F(v, c.f)}, and a cartload of his soil and stones now lies on ${P(v, c.a)}'s land. Each says the other should clear it and rebuild.`,
  (v, c) => [rule(c, 'A', c.kg, 'His wall, his soil, his work'), quarrelSplit(c, c.kg, 'They rebuild it together'), dismiss(c, 'The rain did it; nobody pays')]),

  q('ditch-floods', 'The ditch that floods', (v, r) => {
    const c = nearFields(v, r);
    return c && { ...c, kg: kgOf(r, 30, 90) };
  }, (v, c) => `${P(v, c.b)} cut a ditch to drain ${F(v, c.g)}, and now the winter water runs onto ${F(v, c.f)} and lies there. ${P(v, c.a)} wants it filled in.`,
  (v, c) => [rule(c, 'A', c.kg, 'Fill it in and pay for the drowned seed'), rule(c, 'B', 0, 'A man may drain his own land'), quarrelSplit(c, 0, 'Carry the ditch on to the stream, both houses digging')]),

  q('olive-shade', 'Olives shading the barley', (v, r) => {
    const c = nearFields(v, r, (f) => !f.kind, (g) => !!g.kind);
    return c && { ...c, kg: kgOf(r, 20, 60) };
  }, (v, c) => `${P(v, c.b)}'s ${v.land.fields[c.g].kind} on ${F(v, c.g)} overhang the edge of ${F(v, c.f)}, and ${P(v, c.a)} says nothing ripens in their shade. He wants the branches lopped.`,
  (v, c) => [rule(c, 'A', c.kg, 'Lop the branches over the line'), rule(c, 'B', 0, 'Trees are worth more than a strip of barley'), quarrelSplit(c, c.kg, 'Leave the trees; he pays a little each year for the shade')]),

  q('stubble-fire', 'A stubble fire spread', (v, r) => {
    if (monthOf(v) < 7 || monthOf(v) > 10) return null;
    const c = nearFields(v, r);
    return c && { ...c, kg: kgOf(r, 60, 160) };
  }, (v, c) => `${P(v, c.b)} burned the stubble on ${F(v, c.g)} on a windy day, and the fire ran into ${P(v, c.a)}'s sheaves still waiting to be carried.`,
  (v, c) => [rule(c, 'A', c.kg, 'He pays for every sheaf burned'), quarrelSplit(c, c.kg, 'The wind shares the blame: half'), fine(c, 'B', 40, 'A fine for burning in the wind, to the granary')]),

  q('lent-field', 'A field lent long ago', (v, r) => {
    const c = nearFields(v, r);
    return c && { ...c, kg: kgOf(r, 50, 150) };
  }, (v, c) => `${P(v, c.b)} says his father lent ${F(v, c.f)} to ${P(v, c.a)}'s father for a few seasons, a generation ago, and it was never given back. ${P(v, c.a)} has worked it all his life.`,
  (v, c) => [rule(c, 'A', 0, 'Who works the land holds it'), rule(c, 'B', c.kg, 'A lending is a lending: a rent from now on, in barley'), quarrelSplit(c, c.kg, 'One payment, and the matter closed for good')]),

  // ---- beasts ----
  q('sheep-barley', 'Sheep in the barley', (v, r) => {
    const c = nearFields(v, r, sown, () => true);
    if (!c || !v.households[c.B].sheep) return null;
    return { ...c, kg: kgOf(r, 40, 140) };
  }, (v, c) => `${P(v, c.b)}'s sheep broke into ${F(v, c.f)} and grazed a good part of ${P(v, c.a)}'s young barley before anyone drove them out.`,
  (v, c) => [rule(c, 'A', c.kg, 'He pays for the barley eaten'), (() => ({ label: 'He hands over a sheep for each strip eaten', favours: c.A, hint: 'sheep', fx: (E) => { E.sheep(c.B, c.A, Math.max(1, Math.round(c.kg / 40))); E.gw(c.A, 0.03); E.gw(c.B, -0.04); } }))(), quarrelSplit(c, c.kg, 'His herder\'s fault and the broken fence: half')]),

  q('sheep-vines', 'Sheep among the vines', (v, r) => {
    const c = nearFields(v, r, (f) => !!f.kind, () => true);
    if (!c || !v.households[c.B].sheep) return null;
    return { ...c, kg: kgOf(r, 60, 180) };
  }, (v, c) => `${P(v, c.b)}'s flock got in among ${P(v, c.a)}'s ${v.land.fields[c.f].kind} on ${F(v, c.f)} and browsed the young shoots. A vine browsed in spring bears nothing that year.`,
  (v, c) => [rule(c, 'A', c.kg, 'He pays the value of the lost crop'), quarrelSplit(c, c.kg, 'Half, and a hedge on the line'), fine(c, 'B', 50, 'A fine to the granary, and a herder who watches')]),

  q('dog-lamb', 'The dog and the lambs', (v, r) => pair(v, r, (h) => h.sheep > 0, (h) => h.sheep > 0), (v, c) => `${P(v, c.b)}'s dog got among ${P(v, c.a)}'s ewes and killed two lambs. ${P(v, c.a)} wants the dog killed and the lambs paid for.`,
  (v, c) => [{ label: 'Two lambs for two lambs, and the dog chained', favours: c.A, hint: '2 sheep', fx: (E) => { E.sheep(c.B, c.A, 2); E.gw(c.A, 0.04); E.gw(c.B, -0.04); } }, rule(c, 'A', 60, 'Pay for the lambs, and the dog killed', (E) => E.tie(c.A, c.B, -0.05)), quarrelSplit(c, 40, 'Pay for one; the ewes were straying too')]),

  q('lambs-whose', 'Whose lambs?', (v, r) => pair(v, r, (h) => h.sheep > 2, (h) => h.sheep > 2), (v, c) => `The flocks of ${N(v, c.A)} and ${N(v, c.B)} were folded together over the winter, and now both claim the same five lambs.`,
  (v, c) => [{ label: 'The ewes they suck from decide it', hint: 'the truth will out', fx: (E) => { E.sheep(c.B, c.A, 2); E.gw(c.A, 0.02); E.tie(c.A, c.B, 0.02); } }, { label: 'Split them, three and two', fx: (E) => { E.sheep(c.A, c.B, 1); E.tie(c.A, c.B, 0.03); } }, dismiss(c, 'Let the herders swear to it before the shrine')]),

  q('herder-unpaid', 'A herder unpaid', (v, r) => pair(v, r, (h) => h.sheep > 10), (v, c) => `${P(v, c.b)} kept ${P(v, c.a)}'s sheep with the flock on the hills all spring and says he was promised a lamb in ten and a share of the cheese. ${P(v, c.a)} says he was paid in barley like everyone.`,
  (v, c) => [{ label: 'A lamb in ten, as he says', favours: c.B, hint: 'sheep', fx: (E) => { E.sheep(c.A, c.B, Math.max(1, Math.round(v.households[c.A].sheep / 10))); E.gw(c.B, 0.04); E.gw(c.A, -0.04); } }, rule(c, 'A', 0, 'Barley like everyone: he was paid'), quarrelSplit(c, 40, 'A little more barley, and no lambs', undefined, 'A')]),

  q('sick-sheep', 'A sick ewe sold', (v, r) => pair(v, r, (h) => h.sheep > 0, (h) => h.sheep > 0), (v, c) => `${P(v, c.a)} bought three ewes from ${P(v, c.b)} at the shearing; two have since died of the rot, and he says ${P(v, c.b)} knew they were sick when he sold them.`,
  (v, c) => [rule(c, 'A', 80, 'He takes back the price of the dead ones'), rule(c, 'B', 0, 'A buyer looks before he buys'), quarrelSplit(c, 80, 'The price of one')]),

  q('stray-lost', 'Sheep lost by a herder', (v, r) => pair(v, r, (h) => h.sheep > 0, (h) => h.sheep > 5), (v, c) => `The herder ${P(v, c.b)} sent out with the common flock came back four short of ${P(v, c.a)}'s sheep. Wolves, he says; ${P(v, c.a)} says drink.`,
  (v, c) => [{ label: 'The herder\'s house makes them good', favours: c.A, hint: '4 sheep', fx: (E) => { E.sheep(c.B, c.A, 4); E.gw(c.A, 0.03); E.gw(c.B, -0.05); } }, rule(c, 'B', 0, 'Wolves are wolves'), quarrelSplit(c, 80, 'Half their price')]),

  q('wool-weight', 'Short weight at the shearing', (v, r) => pair(v, r, (h) => h.sheep > 3), (v, c) => `${P(v, c.a)} says the wool ${P(v, c.b)} sheared for him on shares was weighed short, and the difference is in ${P(v, c.b)}'s storeroom.`,
  (v, c) => [{ label: 'Weigh it again, and he hands back the difference', favours: c.A, fx: (E) => { E.goods(c.B, c.A, 'wool', 3); E.gw(c.A, 0.03); E.gw(c.B, -0.04); } }, rule(c, 'B', 0, 'The weighing was witnessed'), dismiss(c, 'Over a few kilos of wool?')]),

  q('ox-lamed', 'An ox lamed on loan', (v, r) => pair(v, r, (h) => yoked(v, h), (h) => !yoked(v, h)), (v, c) => `${P(v, c.b)} hired ${P(v, c.a)}'s oxen for his ploughing and brought one back lame. An ox is worth a year's barley to a small house.`,
  (v, c) => [rule(c, 'A', 150, 'He pays for the ox\'s keep until it is sound, and the lost work'), quarrelSplit(c, 150, 'Half: the ground was stony and the beast old'), rule(c, 'B', 0, 'Oxen go lame; that is the owner\'s risk in hiring')]),

  q('ox-hire', 'Hire for the oxen', (v, r) => pair(v, r, (h) => yoked(v, h), (h) => !yoked(v, h)), (v, c) => `${P(v, c.a)} says ${P(v, c.b)} kept his yoke three days past what was agreed and paid for one.`,
  (v, c) => [rule(c, 'A', 9, 'He pays for the days he kept them'), rule(c, 'B', 0, 'Nobody else wanted them those days'), quarrelSplit(c, 9, 'Half for the extra days')]),

  q('cart-broken', 'A cart brought back broken', (v, r) => pair(v, r, (h) => v.cartOwners.includes(h.id)), (v, c) => `${P(v, c.b)} borrowed ${P(v, c.a)}'s cart to bring stone down from the quarry, and an axle is cracked.`,
  (v, c) => [rule(c, 'A', 60, 'He pays the wheelwright'), quarrelSplit(c, 60, 'Half: the axle was old'), dismiss(c, 'Friends lend; friends mend')]),

  q('dog-bite', 'A child bitten', (v, r) => withPerson(v, r, (p) => lifeStage(v, p) === 'child', (h) => true), (v, c) => `A dog belonging to ${N(v, c.B)} bit ${P(v, c.p)}, a child of ${N(v, c.A)}, at the well. The wound is healing, but the mother wants the dog dead.`,
  (v, c) => [rule(c, 'A', 40, 'The dog killed, and something for the child'), quarrelSplit(c, 20, 'The dog kept tied, and a gift to the child'), rule(c, 'B', 0, 'The child was teasing it')]),

  q('goats-planting', 'Goats in the young olives', (v, r) => {
    const c = nearFields(v, r, (f) => f.kind === 'olives' || f.state === 'planting', () => true);
    if (!c || !v.households[c.B].sheep) return null;
    return c;
  }, (v, c) => `${P(v, c.b)}'s goats have been at the young trees on ${F(v, c.f)}, stripping the bark. A ring-barked olive is dead.`,
  (v, c) => [rule(c, 'A', 120, 'He pays for the trees, and keeps his goats off'), fine(c, 'B', 60, 'A fine, and the goats penned'), quarrelSplit(c, 120, 'Half: the planting was not fenced')]),

  // ---- debts and dealings ----
  q('loan-denied', 'A loan denied', (v, r) => debtPair(v, r, 40), (v, c) => `${P(v, c.a)} says ${N(v, c.B)} owes him ${c.kg} kg of barley lent in a bad year, and will not pay. ${P(v, c.b)} says it was paid long ago, in work.`,
  (v, c) => [rule(c, 'A', c.kg, 'Pay what is owed'), { label: 'The work counts for half; the rest stands', fx: (E) => { E.forgive(c.B, c.A, 0.5); E.tie(c.A, c.B, 0.02); } }, { label: 'It was paid in work: the debt is cleared', favours: c.B, fx: (E) => { E.forgive(c.B, c.A, 1); E.gw(c.A, -0.07); E.gw(c.B, 0.05); } }]),

  q('loan-gift', 'A gift or a loan?', (v, r) => debtPair(v, r, 30), (v, c) => `${P(v, c.b)} says the ${c.kg} kg ${P(v, c.a)} gave him when his children were hungry was a gift between friends. ${P(v, c.a)} says no man gives that much.`,
  (v, c) => [{ label: 'A loan, to be repaid', favours: c.A, fx: (E) => { E.gw(c.A, 0.03); E.gw(c.B, -0.04); } }, { label: 'A gift: nothing is owed', favours: c.B, fx: (E) => { E.forgive(c.B, c.A, 1); E.gw(c.A, -0.06); E.gw(c.B, 0.05); E.all(0.01); } }, { label: 'Half a gift', fx: (E) => { E.forgive(c.B, c.A, 0.5); } }]),

  q('pay-in-sheep', 'Paid in sheep', (v, r) => {
    const c = debtPair(v, r, 60);
    return c && v.households[c.B].sheep > 2 ? c : null;
  }, (v, c) => `${N(v, c.B)} cannot pay ${P(v, c.a)} the ${c.kg} kg it owes in barley, and offers sheep instead. ${P(v, c.a)} wants barley, not mouths to feed.`,
  (v, c) => [{ label: 'Sheep it is, at the price in Athens', fx: (E) => { const n = Math.min(v.households[c.B].sheep, Math.round(c.kg / 40)); E.sheep(c.B, c.A, n); E.forgive(c.B, c.A, Math.min(1, (n * 40) / c.kg)); } }, rule(c, 'A', 0, 'Barley was lent; barley is owed'), dismiss(c, 'Let them agree a price between them')]),

  q('surety', 'The surety will not pay', (v, r) => {
    const c = debtPair(v, r, 50);
    if (!c) return null;
    const C = pick(r, others(v).filter((h) => h.id !== c.A && h.id !== c.B));
    return C && { ...c, C: C.id };
  }, (v, c) => `${N(v, c.C)} stood surety for ${N(v, c.B)}'s debt of ${c.kg} kg to ${P(v, c.a)}. ${N(v, c.B)} cannot pay, and the surety says he only promised to see it paid "if he could".`,
  (v, c) => [{ label: 'A surety is a surety: he pays', favours: c.A, fx: (E) => { E.grain(c.C, c.A, c.kg / 2); E.forgive(c.B, c.A, 0.5); E.gw(c.C, -0.06); E.gw(c.A, 0.03); E.tie(c.C, c.B, -0.1); } }, rule(c, 'B', 0, 'The debt is the debtor\'s'), { label: 'Debtor and surety pay half each', fx: (E) => { E.grain(c.C, c.A, c.kg / 4); E.grain(c.B, c.A, c.kg / 4); E.forgive(c.B, c.A, 0.5); } }]),

  q('dead-debt', 'A dead man\'s debt', (v, r) => debtPair(v, r, 40), (v, c) => `${P(v, c.b)} says the debt of ${c.kg} kg was his late father's, and died with him. ${P(v, c.a)} says the land came down to the son, and the debt with it.`,
  (v, c) => [rule(c, 'A', c.kg, 'The estate carries its debts'), { label: 'It died with the father', favours: c.B, fx: (E) => { E.forgive(c.B, c.A, 1); E.gw(c.A, -0.07); } }, { label: 'The son pays half, over time', fx: (E) => { E.forgive(c.B, c.A, 0.5); } }]),

  q('plough-kept', 'A plough not returned', (v, r) => pair(v, r), (v, c) => `${P(v, c.a)} lent his plough and mattock to ${P(v, c.b)} at sowing, and has not seen them since. ${P(v, c.b)} says he returned them; ${P(v, c.a)} says the plough by his door is not his.`,
  (v, c) => [rule(c, 'A', 25, 'Return it, or pay its price'), dismiss(c, 'Let them look harder'), quarrelSplit(c, 25, 'Half its price, and a better memory next time')]),

  q('oil-spilled', 'A borrowed jar broken', (v, r) => pair(v, r), (v, c) => `A jar of oil ${P(v, c.a)} lent to ${N(v, c.B)} for a funeral came back broken and empty.`,
  (v, c) => [rule(c, 'A', 35, 'The oil and the jar, paid for'), quarrelSplit(c, 35, 'The oil, not the jar'), dismiss(c, 'A gift for a funeral is not reckoned')]),

  q('wages-harvest', 'Harvest wages withheld', (v, r) => pair(v, r, (h) => h.wealth > 0.5, (h) => h.wealth < 0.5), (v, c) => `${P(v, c.b)} reaped for ${N(v, c.A)} for six days and says he was given half the barley promised. ${P(v, c.a)} says he cut slowly and left half the ears standing.`,
  (v, c) => [rule(c, 'B', 25, 'Pay him what was promised'), rule(c, 'A', 0, 'Pay is for work done'), quarrelSplit(c, 25, 'Something more, not all', undefined, 'A')]),

  q('false-measure', 'A false measure', (v, r) => pair(v, r), (v, c) => `${P(v, c.a)} bought barley from ${N(v, c.B)} and says the measure they used holds a tenth less than the deme's. He has brought the measure with him.`,
  (v, c) => [fine(c, 'B', 60, 'Check it against the deme\'s: a fine, and the difference repaid', (E) => E.grain(c.B, c.A, 20)), rule(c, 'B', 0, 'The measures agree well enough'), dismiss(c, 'Let every house bring its measures to be checked')]),

  q('bad-coin', 'A plated drachma', (v, r) => pair(v, r, (h) => (h.stores.coin || 0) > 5), (v, c) => `${P(v, c.b)} paid ${P(v, c.a)} for a goat with drachmae, and one of them was bronze under a skin of silver. ${P(v, c.b)} says he took it in Athens in good faith.`,
  (v, c) => [{ label: 'He makes it good', favours: c.A, fx: (E) => { E.coin(c.B, c.A, 2); E.gw(c.A, 0.02); } }, dismiss(c, 'Good faith: the loss lies where it fell'), { label: 'Make it good, and keep the false coin from going round', fx: (E) => { E.coin(c.B, c.A, 2); E.all(0.01); } }]),

  q('moth-cloth', 'Cloth sold moth-eaten', (v, r) => pair(v, r, () => true, (h) => h.stores.cloth > 2), (v, c) => `${N(v, c.A)} bought cloth from ${N(v, c.B)} for a wedding; when they unrolled it, it was eaten through.`,
  (v, c) => [rule(c, 'A', 30, 'The price back'), { label: 'Sound cloth in its place', fx: (E) => { E.goods(c.B, c.A, 'cloth', 2); E.tie(c.A, c.B, 0.02); } }, rule(c, 'B', 0, 'It was sound when it left their house')]),

  q('vinegar', 'Wine turned to vinegar', (v, r) => pair(v, r, () => true, (h) => (h.stores.wine || 0) > 20), (v, c) => `${P(v, c.a)} bought two jars of wine from ${N(v, c.B)} for the festival; opened, it was vinegar.`,
  (v, c) => [rule(c, 'A', 40, 'The price back'), { label: 'Good wine in its place', fx: (E) => { E.goods(c.B, c.A, 'wine', 40); E.tie(c.A, c.B, 0.02); } }, dismiss(c, 'Wine turns; that is the gods\' business')]),

  q('oil-watered', 'Oil with water in it', (v, r) => pair(v, r, () => true, (h) => (h.stores.oil || 0) > 5), (v, c) => `${N(v, c.A)} says the oil it bought from ${N(v, c.B)} separated in the jar: a third of it water.`,
  (v, c) => [fine(c, 'B', 50, 'A fine, and the oil made up', (E) => E.goods(c.B, c.A, 'oil', 5)), rule(c, 'B', 0, 'The jar was damp'), dismiss(c, 'Let the buyer taste before he pays')]),

  q('deposit-short', 'Grain left in keeping', (v, r) => {
    const c = pair(v, r);
    return c && { ...c, kg: kgOf(r, 40, 120) };
  }, (v, c) => `Before going to the army ${P(v, c.a)} left ${c.kg} kg of barley in ${N(v, c.B)}'s storeroom for safekeeping. He came back to find it a third short.`,
  (v, c) => [rule(c, 'A', Math.round(c.kg / 3), 'A deposit is sacred: every kilo made good'), quarrelSplit(c, Math.round(c.kg / 3), 'Mice and damp take their share: half'), rule(c, 'B', 0, 'Stored grain shrinks; he knew it')]),

  q('cloak-pledge', 'A pledge kept', (v, r) => debtPair(v, r, 20), (v, c) => `${P(v, c.b)} gave his good cloak as a pledge for barley from ${N(v, c.A)}. He says he has paid, and ${P(v, c.a)} still will not give back the cloak.`,
  (v, c) => [rule(c, 'B', 0, 'Paid is paid: the cloak goes back', (E) => E.forgive(c.B, c.A, 1)), rule(c, 'A', 0, 'Not paid until the last kilo'), dismiss(c, 'Let witnesses say what was paid')]),

  q('wood-short', 'A cartload of wood short', (v, r) => pair(v, r, (h) => h.stores.wood < 400, (h) => h.stores.wood > 300), (v, c) => `${N(v, c.A)} paid ${N(v, c.B)} for a cartload of firewood and stacked it: half a load, they say, and green at that.`,
  (v, c) => [rule(c, 'A', 15, 'The difference back'), { label: 'The rest of the load, and dry', fx: (E) => { E.goods(c.B, c.A, 'wood', 200); } }, dismiss(c, 'Wood shrinks as it dries')]),

  // ---- families ----
  q('dowry-short', 'A dowry not paid', (v, r) => withPerson(v, r, (p, h) => p.sex === 'f' && p.spouse >= 0 && alive(v, p.spouse) && p.father >= 0 && v.people[p.father].household !== h.id && !v.households[v.people[p.father].household].player && v.households[v.people[p.father].household].members.some((id) => alive(v, id)), (h, A, p) => h.id === v.people[p.father].household), (v, c) => `${P(v, c.a)}'s son married ${P(v, c.p)} of ${N(v, c.B)}, and the dowry promised at the betrothal was never paid in full.`,
  (v, c) => [rule(c, 'A', 80, 'Her father\'s house pays the rest'), quarrelSplit(c, 80, 'Half now, half at the next harvest'), dismiss(c, 'A marriage is more than its dowry')]),

  q('wife-returned', 'A wife sent home', (v, r) => withPerson(v, r, (p, h) => p.sex === 'f' && p.spouse >= 0 && alive(v, p.spouse) && p.father >= 0 && v.people[p.father].household !== h.id && !v.households[v.people[p.father].household].player, (h, A, p) => h.id === v.people[p.father].household), (v, c) => `${P(v, c.p)} has gone back to her father's house, ${N(v, c.B)}, and her father wants her dowry back from ${N(v, c.A)}, as the law says.`,
  (v, c) => [rule(c, 'B', 80, 'The dowry goes back with her'), rule(c, 'A', 0, 'She left; the dowry stays'), quarrelSplit(c, 80, 'Send her home to her husband, and a gift between the houses', (E) => E.tie(c.A, c.B, 0.05), 'A')]),

  q('betrothal-broken', 'A betrothal broken off', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && !p.slave && p.spouse < 0 && ofAge(18, 32)(v, p), (h) => members(v, h).some((w) => w.sex === 'f' && w.spouse < 0 && ofAge(14, 22)(v, w))), (v, c) => `${N(v, c.B)} had promised a daughter to ${P(v, c.p)} of ${N(v, c.A)}, and now has promised her elsewhere, for a better dowry. ${P(v, c.a)} calls it an insult to his house.`,
  (v, c) => [rule(c, 'A', 60, 'A promise is a promise: they pay for breaking it'), rule(c, 'B', 0, 'A father gives his daughter where he thinks best'), dismiss(c, 'Better broken now than a bad marriage')]),

  q('heiress', 'The heiress', (v, r) => withPerson(v, r, (p) => p.sex === 'f' && p.spouse < 0 && ofAge(12, 20)(v, p) && !(p.father >= 0 && alive(v, p.father)), () => true), (v, c) => `${P(v, c.p)} of ${N(v, c.A)} is her dead father's only heir. By law her nearest kinsman may claim her in marriage, and the land with her; ${P(v, c.b)} claims to be that kinsman, and ${N(v, c.A)} says he is a cousin twice removed and after the land.`,
  (v, c) => [rule(c, 'B', 0, 'The law is the law: he may claim her', (E) => E.all(-0.01)), rule(c, 'A', 0, 'He is no near kin: she stays'), quarrelSplit(c, 0, 'She marries within her own house, and he has a gift for his trouble', (E) => E.grain(c.A, c.B, 40))]),

  q('guardian', 'A guardian wasting the estate', (v, r) => withPerson(v, r, (p) => lifeStage(v, p) === 'child' && !(p.father >= 0 && alive(v, p.father)), () => true), (v, c) => `${N(v, c.B)} says the guardian of the orphan ${P(v, c.p)} in ${N(v, c.A)} is selling off the boy's inheritance a jar at a time.`,
  (v, c) => [fine(c, 'A', 80, 'The guardian accounts for every jar, and pays the shortfall into keeping'), rule(c, 'A', 0, 'A guardian\'s accounts are his own business'), dismiss(c, 'The boy\'s kin can watch over it')]),

  q('adoption', 'An adopted son', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && ageYears(v, p) >= 50, () => true), (v, c) => `Old ${P(v, c.p)} of ${N(v, c.A)}, with no son of his own, means to adopt a young man of ${N(v, c.B)} to carry on his house and his rites. His brother's family say the land should come to them.`,
  (v, c) => [{ label: 'A man may adopt whom he likes', fx: (E) => { E.tie(c.A, c.B, 0.1); E.gw(c.A, 0.02); } }, rule(c, 'A', 0, 'The land stays with his blood'), dismiss(c, 'Let him make a will before witnesses')]),

  q('widow-keep', 'A widow neglected', (v, r) => withPerson(v, r, (p) => p.sex === 'f' && p.spouse >= 0 && !alive(v, p.spouse) && ageYears(v, p) > 35, (h, A, p) => p.father >= 0 && v.people[p.father] && v.people[p.father].household === h.id), (v, c) => `${N(v, c.B)} says their daughter ${P(v, c.p)}, widowed in ${N(v, c.A)}, is kept on scraps by her husband's kin, and wants her and her dowry back.`,
  (v, c) => [rule(c, 'B', 70, 'Her dowry goes home with her'), rule(c, 'A', 0, 'She is kept as well as anyone'), fine(c, 'A', 30, 'She stays, properly kept, and a fine for the neglect')]),

  q('brothers-split', 'Brothers dividing', (v, r) => withPerson(v, r, (p, h) => p.sex === 'm' && !p.slave && lifeStage(v, p) === 'adult' && adultMen(v, h).length >= 2, () => true), (v, c) => `${P(v, c.p)} of ${N(v, c.A)} wants his share of the land and the house's stores to set up on his own; his brother says nothing is divided until their mother dies. ${N(v, c.B)}, their mother's kin, back the younger brother.`,
  (v, c) => [{ label: 'Divide it now, by lot', fx: (E) => { E.gw(c.A, -0.02); E.gw(c.B, 0.03); } }, rule(c, 'A', 0, 'Nothing divided while their mother lives'), dismiss(c, 'Brothers must settle brothers\' business')]),

  q('nothos', 'A bastard\'s claim', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && lifeStage(v, p) === 'adult' && !p.slave, () => true), (v, c) => `A young man of ${N(v, c.B)} says he is the son of ${P(v, c.a)}'s late father by a hired woman, and claims a son's share of ${N(v, c.A)}'s land.`,
  (v, c) => [rule(c, 'A', 0, 'A bastard has no share in the land'), rule(c, 'B', 60, 'Not land: a son\'s gift in barley'), dismiss(c, 'Let him prove it before the phratry')]),

  q('adultery', 'Adultery', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && !p.slave && p.spouse < 0 && ofAge(18, 35)(v, p), (h) => members(v, h).some((w) => w.sex === 'f' && w.spouse >= 0 && alive(v, w.spouse) && ofAge(16, 40)(v, w))), (v, c) => `${P(v, c.b)} caught ${P(v, c.p)} of ${N(v, c.A)} with his wife. By the law he could have killed him on the spot; he held his hand, and wants him judged.`,
  (v, c) => [fine(c, 'A', 150, 'A heavy fine, paid to the wronged house', (E) => { E.grain(c.A, c.B, 100); E.rep(c.p, -0.15); E.tie(c.A, c.B, -0.2); }), { label: 'Shamed in the market, as the law allows', fx: (E) => { E.rep(c.p, -0.25); E.hurt(c.p, 0.15); E.gw(c.A, -0.06); E.gw(c.B, 0.03); E.tie(c.A, c.B, -0.15); } }, { label: 'Let the wronged husband divorce, and say no more', fx: (E) => { E.tie(c.A, c.B, -0.1); E.gw(c.B, -0.03); } }]),

  q('elopement', 'A girl taken without leave', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && !p.slave && p.spouse < 0 && ofAge(18, 30)(v, p), (h) => members(v, h).some((w) => w.sex === 'f' && w.spouse < 0 && ofAge(15, 22)(v, w))), (v, c) => `${P(v, c.p)} of ${N(v, c.A)} has run off with a daughter of ${N(v, c.B)} without her father's leave, and they are living together in his father's house.`,
  (v, c) => [rule(c, 'B', 100, 'He marries her properly, and pays her father for the insult'), rule(c, 'A', 0, 'Done is done; let them marry'), fine(c, 'A', 60, 'She goes home, and a fine on his house')]),

  q('burial-cost', 'Who pays for the funeral', (v, r) => pair(v, r), (v, c) => `An old cousin of both ${N(v, c.A)} and ${N(v, c.B)} died with nothing, and each says the other is nearer kin and owes the funeral and the rites.`,
  (v, c) => [rule(c, 'A', 30, 'The nearer kin pays'), quarrelSplit(c, 30, 'Both houses, equally', (E) => E.all(0.01)), { label: 'The deme buries him from the common granary', hint: '30 kg from the granary', fx: (E) => { E.grain('common', c.A, 30); E.all(0.01); } }]),

  q('kakosis', 'An old father neglected', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && ageYears(v, p) >= 60, () => true), (v, c) => `${N(v, c.B)} says old ${P(v, c.p)} of ${N(v, c.A)} is left to go hungry by his son, who has taken over the house. Neglect of a parent is a crime at Athens.`,
  (v, c) => [fine(c, 'A', 60, 'A fine, and the old man fed first'), rule(c, 'A', 0, 'The old man exaggerates'), dismiss(c, 'Let his son swear before the shrine to keep him')]),

  q('widow-child', 'A widow remarrying', (v, r) => withPerson(v, r, (p) => p.sex === 'f' && p.spouse >= 0 && !alive(v, p.spouse) && ageYears(v, p) < 38, () => true), (v, c) => `${P(v, c.p)}, widowed in ${N(v, c.A)}, is to marry into ${N(v, c.B)}. Her dead husband's family say her children stay with them, and her dowry too.`,
  (v, c) => [rule(c, 'A', 0, 'The children stay; the dowry goes with her', (E) => E.grain(c.A, c.B, 60)), rule(c, 'B', 80, 'Children and dowry go with their mother'), quarrelSplit(c, 60, 'The children stay; half the dowry goes', undefined, 'A')]),

  q('wedding-feast', 'The wedding feast', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} and ${N(v, c.B)} married their children last month, and now quarrel over who was to pay for the feast, the wine and the musicians.`,
  (v, c) => [rule(c, 'A', 40, 'The bride\'s father pays, as is the custom'), quarrelSplit(c, 40, 'Half each'), dismiss(c, 'A wedding is a gift to both houses')]),

  // ---- honour and violence ----
  q('shield-insult', 'Called a shield-thrower', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && !p.slave && p.weapon && ageYears(v, p) > 20, () => true), (v, c) => `At the well ${P(v, c.b)} called ${P(v, c.p)} of ${N(v, c.A)} a shield-thrower, before the women. To call a man that falsely is slander under the law.`,
  (v, c) => [fine(c, 'B', 50, 'Slander: a fine, and he takes it back before the same women', (E) => E.rep(c.p, 0.05)), rule(c, 'B', 0, 'Everyone knows what happened in the battle', (E) => E.rep(c.p, -0.08)), dismiss(c, 'Words at the well are not worth a hearing')]),

  q('wine-brawl', 'A brawl over wine', (v, r) => pair(v, r), (v, c) => `${P(v, c.a)} and ${P(v, c.b)} came to blows at a drinking party, and ${P(v, c.a)}'s head was cut open on a bench. Each says the other struck first.`,
  (v, c) => [rule(c, 'A', 40, 'He pays for the wound', (E) => E.hurt(c.a, 0.1)), quarrelSplit(c, 0, 'Drunk, both; they drink together again, sober', (E) => E.hurt(c.a, 0.1)), fine(c, 'B', 40, 'A fine on both for disturbing the peace', (E) => E.fine(c.A, 40))]),

  q('wife-slander', 'A wife slandered', (v, r) => pair(v, r), (v, c) => `${P(v, c.a)} says ${N(v, c.B)} has been saying in the village that his wife is not chaste.`,
  (v, c) => [fine(c, 'B', 60, 'A fine for slander, and the words taken back'), rule(c, 'B', 0, 'Where there is smoke'), dismiss(c, 'Women\'s talk')]),

  q('festival-damage', 'Damage after the festival', (v, r) => pair(v, r), (v, c) => `After the festival the young men of ${N(v, c.B)}, drunk, broke ${N(v, c.A)}'s gate and smashed two storage jars.`,
  (v, c) => [rule(c, 'A', 45, 'They pay for the jars and the gate'), quarrelSplit(c, 45, 'Half, and they mend the gate themselves'), dismiss(c, 'The god\'s day; the god\'s mischief')]),

  q('hubris', 'An old man struck', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && ageYears(v, p) >= 55, () => true), (v, c) => `${P(v, c.b)} struck old ${P(v, c.p)} of ${N(v, c.A)} in an argument over the road. Striking an old man is hubris, an outrage against the whole deme.`,
  (v, c) => [fine(c, 'B', 100, 'Outrage: a heavy fine', (E) => E.all(0.02)), rule(c, 'A', 40, 'He pays the old man for the blow'), dismiss(c, 'The old man swung first')]),

  q('fig-boy', 'A boy beaten for figs', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && lifeStage(v, p) !== 'adult' && ageYears(v, p) >= 8 && ageYears(v, p) < 16, () => true), (v, c) => `${P(v, c.b)} caught ${P(v, c.p)} of ${N(v, c.A)} in his fig tree and beat him badly. The boy's family say it was a few figs; ${P(v, c.b)} says it is the fifth time.`,
  (v, c) => [rule(c, 'A', 30, 'Too heavy a hand: he pays for the hurt'), rule(c, 'B', 0, 'A thief is a thief'), quarrelSplit(c, 0, 'The boy works a day in the orchard; no more said')]),

  q('threshing-theft', 'Grain gone from the floor', (v, r) => (monthOf(v) >= 7 && monthOf(v) <= 10 ? pair(v, r) : null), (v, c) => `${P(v, c.a)} left his winnowed barley in a heap on the threshing floor overnight and found it lighter in the morning. A child saw ${N(v, c.B)}'s slave there in the dark.`,
  (v, c) => [rule(c, 'A', 50, 'The master answers for his slave: he pays'), rule(c, 'B', 0, 'A child\'s word is not enough'), fine(c, 'B', 30, 'The slave is flogged, and a fine')]),

  q('woodpile-theft', 'Wood taken from the pile', (v, r) => pair(v, r, (h) => h.stores.wood > 200), (v, c) => `${P(v, c.a)} says someone has been taking wood from his pile by night, and the tracks lead to ${N(v, c.B)}.`,
  (v, c) => [rule(c, 'A', 20, 'He pays for it'), dismiss(c, 'Tracks in mud prove nothing'), quarrelSplit(c, 20, 'Half, and a watch kept')]),

  q('sickle-theft', 'A sickle stolen', (v, r) => pair(v, r), (v, c) => `${P(v, c.a)}'s sickle went missing in the harvest, and he has seen one just like it, with his mark filed off, in ${P(v, c.b)}'s hand.`,
  (v, c) => [rule(c, 'A', 20, 'It is his: give it back, and pay for the days without it'), rule(c, 'B', 0, 'All sickles look alike'), dismiss(c, 'Let the smith say whose it is')]),

  q('grape-theft', 'Grapes taken by night', (v, r) => pair(v, r, (h) => has(v, h, 'vines')), (v, c) => `Before the vintage someone stripped a row of ${P(v, c.a)}'s vines in the night. The young men of ${N(v, c.B)} were heard singing on the road.`,
  (v, c) => [rule(c, 'A', 40, 'Their house pays for the grapes'), dismiss(c, 'Singing is no crime'), fine(c, 'B', 25, 'A fine, and a watch on the vines till the vintage')]),

  q('olive-picked', 'Olives picked from another\'s trees', (v, r) => pair(v, r, (h) => has(v, h, 'olives')), (v, c) => `${P(v, c.a)} found ${N(v, c.B)}'s women gathering fallen olives under his trees, and says they were beating the branches too.`,
  (v, c) => [rule(c, 'A', 30, 'They pay for what they took'), rule(c, 'B', 0, 'Gleaning the fallen is the poor\'s right'), quarrelSplit(c, 0, 'They may glean the fallen, never beat the branches', (E) => E.all(0.01))]),

  q('curse-tablet', 'A curse tablet', (v, r) => pair(v, r), (v, c) => `${P(v, c.a)} dug up a folded lead tablet by his threshing floor: his name and his oxen bound to the gods below. He says ${N(v, c.B)} put it there.`,
  (v, c) => [fine(c, 'B', 40, 'Impiety and malice: a fine, and a sacrifice to undo it', (E) => E.gw(c.A, 0.02)), rule(c, 'B', 0, 'There is no proof whose it is'), { label: 'A sacrifice for both houses, paid from the granary', hint: '25 kg from the granary', fx: (E) => { E.spend(25, 'a sacrifice to undo the curse'); E.tie(c.A, c.B, 0.04); E.all(0.01); } }]),

  q('drill-threat', 'A spear raised', (v, r) => withPerson(v, r, (p) => p.sex === 'm' && !p.slave && p.weapon && lifeStage(v, p) === 'adult', () => true), (v, c) => `At the drill ground ${P(v, c.b)} lost his temper and levelled his spear at ${P(v, c.p)} of ${N(v, c.A)}. Nobody was hurt, but the men want it dealt with before someone is.`,
  (v, c) => [fine(c, 'B', 40, 'A fine; he drills apart for a month'), rule(c, 'B', 0, 'Tempers fray at the drill; it is good they do'), quarrelSplit(c, 0, 'They drill side by side till they are friends', (E) => E.tie(c.A, c.B, 0.06))]),

  // ---- slaves ----
  q('slave-struck', 'A slave struck a free man', (v, r) => withPerson(v, r, (p) => p.slave && p.sex === 'm', () => true), (v, c) => `${P(v, c.p)}, a slave of ${N(v, c.A)}, struck ${P(v, c.b)} of ${N(v, c.B)} in a quarrel at the well. A slave who strikes a free man is to be punished by his master, or handed over.`,
  (v, c) => [rule(c, 'B', 50, 'His master pays, and flogs him', (E) => E.hurt(c.p, 0.2)), { label: 'The slave is handed over to the wronged house', favours: c.B, fx: (E) => { const p = v.people[c.p]; if (p && p.alive) { v.households[c.A].members = v.households[c.A].members.filter((id) => id !== p.id); p.household = c.B; v.households[c.B].members.push(p.id); E.say(`${p.name} now belongs to the house of ${v.households[c.B].name}.`); } E.gw(c.A, -0.06); } }, dismiss(c, 'He was provoked')]),

  q('slave-sheltered', 'A runaway sheltered', (v, r) => withPerson(v, r, (p) => p.slave, () => true), (v, c) => `${P(v, c.p)}, a slave of ${N(v, c.A)}, ran off and was found in ${N(v, c.B)}'s storeroom. ${N(v, c.B)} say he came of his own accord and they were feeding him out of pity.`,
  (v, c) => [rule(c, 'A', 60, 'Back to his master; they pay for the days lost'), { label: 'He goes back, and is not to be beaten for it', fx: (E) => { E.gw(c.A, -0.02); E.all(0.01); } }, fine(c, 'B', 40, 'Harbouring a slave: a fine')]),

  q('slave-hurt-hired', 'A hired slave hurt', (v, r) => withPerson(v, r, (p) => p.slave && p.sex === 'm', () => true), (v, c) => `${N(v, c.A)} hired out its slave ${P(v, c.p)} to ${N(v, c.B)} for the quarrying, and he came back with a crushed foot.`,
  (v, c) => [rule(c, 'A', 80, 'They pay for the lost work', (E) => E.hurt(c.p, 0.2)), quarrelSplit(c, 80, 'Half: the quarry is dangerous', (E) => E.hurt(c.p, 0.2)), rule(c, 'B', 0, 'The risk was known', (E) => E.hurt(c.p, 0.2))]),

  q('slave-freeborn', 'A slave says he was born free', (v, r) => withPerson(v, r, (p) => p.slave, () => true), (v, c) => `${P(v, c.p)}, a slave of ${N(v, c.A)}, says he was born free in a town the Boeotians sacked and sold wrongly, and ${P(v, c.b)} says he knew his father.`,
  (v, c) => [{ label: 'He is free', fx: (E) => { E.free(c.p); E.gw(c.A, -0.08); E.all(0.01); } }, rule(c, 'A', 0, 'Bought fairly in the market: he stays a slave'), { label: 'Free, if he works a year more to repay his price', fx: (E) => { E.free(c.p); E.gw(c.A, -0.03); E.grain(c.B, c.A, 60); } }]),

  q('slave-child', 'A slave woman\'s child', (v, r) => withPerson(v, r, (p) => p.slave && p.sex === 'f', () => true), (v, c) => `${N(v, c.B)} says the child of ${P(v, c.p)}, a slave woman of ${N(v, c.A)}, is the son of one of its men, and wants him raised free in their house.`,
  (v, c) => [rule(c, 'A', 0, 'A slave\'s child belongs to her master'), rule(c, 'B', 40, 'The father\'s house takes the child, and pays for him'), dismiss(c, 'Let the child grow before anyone claims him')]),

  q('slave-freed-heirs', 'A freed slave and the heirs', (v, r) => withPerson(v, r, (p) => p.slave && ageYears(v, p) > 30, () => true), (v, c) => `Before he died, the old head of ${N(v, c.A)} promised ${P(v, c.p)} his freedom. The heirs say nothing was written; ${P(v, c.b)} of ${N(v, c.B)} heard the promise.`,
  (v, c) => [{ label: 'A dead man\'s word stands: he is free', fx: (E) => { E.free(c.p); E.gw(c.A, -0.06); E.all(0.02); } }, rule(c, 'A', 0, 'Nothing written, nothing promised'), { label: 'Free, if he pays his price from his savings', fx: (E) => { E.free(c.p); E.gw(c.A, -0.02); } }]),

  q('slave-theft', 'Stolen goods from a slave', (v, r) => withPerson(v, r, (p) => p.slave, () => true), (v, c) => `${N(v, c.A)}'s slave ${P(v, c.p)} has been taking cheese and oil from the storeroom and selling them to ${N(v, c.B)} for a few obols.`,
  (v, c) => [rule(c, 'A', 40, 'The buyer gives back what he bought, or its price'), fine(c, 'B', 40, 'Receiving from a slave: a fine'), dismiss(c, 'Keep your storeroom locked')]),

  // ---- work and trades ----
  q('reaper-share', 'A reaper\'s share', (v, r) => (monthOf(v) >= 7 && monthOf(v) <= 9 ? pair(v, r, () => true, (h) => h.wealth < 0.55) : null), (v, c) => `${P(v, c.b)} reaped ${P(v, c.a)}'s field for the usual eighth, and says the sheaves he was given were the thin ones from the edge.`,
  (v, c) => [rule(c, 'B', 30, 'Make up his share from the good sheaves'), rule(c, 'A', 0, 'An eighth is an eighth'), quarrelSplit(c, 30, 'A little more, for the good of the next harvest', undefined, 'A')]),

  q('coppice', 'Felling in another\'s coppice', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} has always cut the oak coppice above the spring; ${N(v, c.B)}'s men felled half of it this winter and say the woods belong to all.`,
  (v, c) => [rule(c, 'A', 40, 'An old custom is a right: they pay for the wood'), rule(c, 'B', 0, 'The woods are common'), quarrelSplit(c, 0, 'Each house its own stand, marked out', (E) => E.all(0.01))]),

  q('quarry-stone', 'Stone taken from a pile', (v, r) => pair(v, r, (h) => (h.stores.stone || 0) > 50), (v, c) => `${N(v, c.A)} quarried stone for a new house and piled it at the quarry. Half the pile is now in ${N(v, c.B)}'s new wall.`,
  (v, c) => [rule(c, 'A', 50, 'They pay for the stone'), { label: 'They quarry as much again for them', fx: (E) => { E.tie(c.A, c.B, 0.02); E.gw(c.B, -0.02); } }, dismiss(c, 'A pile at the quarry is anyone\'s')]),

  q('millstone', 'A cracked millstone', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} lent its quern to ${N(v, c.B)} while theirs was being dressed, and it came back cracked.`,
  (v, c) => [rule(c, 'A', 30, 'They pay for a new stone'), quarrelSplit(c, 30, 'Half'), dismiss(c, 'Stones crack')]),

  q('builder-bad', 'A wall that fell', (v, r) => pair(v, r), (v, c) => `${P(v, c.b)} built a storeroom wall for ${N(v, c.A)} last summer, and the first winter rains brought it down.`,
  (v, c) => [rule(c, 'A', 60, 'He builds it again, at his own cost'), quarrelSplit(c, 60, 'They share the cost of the second wall'), rule(c, 'B', 0, 'The mudbrick they gave him was bad')]),

  q('smith-price', 'The smith\'s price', (v, r) => {
    if (!v.smith || v.smith.man < 0 || v.smith.ruined) return null;
    const S = v.households[v.smith.house];
    if (!S || S.player) return null;
    const B = pick(r, others(v).filter((h) => h !== S));
    return B && { A: S.id, B: B.id, a: v.smith.man, b: manOf(v, B).id };
  }, (v, c) => `${P(v, c.b)} says the smith ${P(v, c.a)} charged him twice the usual for mending his ploughshare because he knew he could not wait.`,
  (v, c) => [rule(c, 'B', 10, 'He gives back the difference'), rule(c, 'A', 0, 'A smith may charge for haste'), { label: 'Set the smith\'s prices before the deme', fx: (E) => { E.gw(c.A, -0.04); E.all(0.02); } }]),

  q('smith-failed', 'A ploughshare that broke', (v, r) => {
    if (!v.smith || v.smith.man < 0 || v.smith.ruined) return null;
    const S = v.households[v.smith.house];
    if (!S || S.player) return null;
    const B = pick(r, others(v).filter((h) => h !== S));
    return B && { A: S.id, B: B.id, a: v.smith.man, b: manOf(v, B).id };
  }, (v, c) => `The ploughshare the smith ${P(v, c.a)} made for ${N(v, c.B)} snapped on the first stone. ${P(v, c.b)} lost three days' ploughing and wants a new one, free.`,
  (v, c) => [rule(c, 'B', 25, 'A new one, free, and the lost days paid'), quarrelSplit(c, 25, 'A new one, free'), rule(c, 'A', 0, 'He ploughed it into a boulder')]),

  q('carrier-lost', 'Goods lost on the road', (v, r) => pair(v, r), (v, c) => `${P(v, c.b)} carried a jar of oil and a new sickle back from Athens for ${N(v, c.A)}, and arrived with the sickle only. He says the jar broke on the road.`,
  (v, c) => [rule(c, 'A', 40, 'A carrier answers for what he carries'), quarrelSplit(c, 40, 'Half: the road is rough'), rule(c, 'B', 0, 'He did it as a favour')]),

  q('carrier-fee', 'A carrier\'s fee', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)} carried ${N(v, c.A)}'s errands from Athens and wants the usual fee; ${N(v, c.A)} says they were going anyway and it was a neighbour's favour.`,
  (v, c) => [rule(c, 'B', 15, 'The usual fee'), rule(c, 'A', 0, 'A favour between neighbours'), quarrelSplit(c, 15, 'Half')]),

  q('herd-rota', 'Whose turn with the flock', (v, r) => (v.flock.head > 0 ? pair(v, r, (h) => h.sheep > 0, (h) => h.sheep > 0) : null), (v, c) => `${N(v, c.A)} says it has sent a man out with the common flock three months running, and ${N(v, c.B)}, with as many sheep, has sent nobody.`,
  (v, c) => [rule(c, 'A', 40, 'They send a man, and pay for the months missed'), quarrelSplit(c, 40, 'A rota, kept by the deme', (E) => E.all(0.01)), rule(c, 'B', 0, 'Each house herds as it can')]),

  q('ox-taken-back', 'Oxen taken back mid-field', (v, r) => pair(v, r, (h) => yoked(v, h), (h) => !yoked(v, h)), (v, c) => `${P(v, c.a)} took his oxen back from ${N(v, c.B)} with their field half ploughed, saying he needed them for his own. Now their sowing is late.`,
  (v, c) => [rule(c, 'B', 40, 'An agreement is an agreement: he pays for the late sowing'), rule(c, 'A', 0, 'A man\'s own field comes first'), quarrelSplit(c, 40, 'He lends them back for two days, free', undefined, 'A')]),

  q('threshing-turn', 'Whose turn on the floor', (v, r) => (monthOf(v) >= 7 && monthOf(v) <= 9 ? pair(v, r) : null), (v, c) => `${N(v, c.A)} and ${N(v, c.B)} both want the threshing floor while the north wind holds, and their men have nearly come to blows over it.`,
  (v, c) => [rule(c, 'A', 0, 'Who reaped first threshes first'), rule(c, 'B', 0, 'The bigger heap goes first, before rain'), quarrelSplit(c, 0, 'Day and day about', (E) => E.all(0.01))]),

  // ---- water and the commons ----
  q('well-sheep', 'Sheep at the well', (v, r) => (monthOf(v) >= 8 && monthOf(v) <= 11 ? pair(v, r, (h) => true, (h) => h.sheep > 10) : null), (v, c) => `In the summer drought ${N(v, c.B)} has been watering its whole flock at the village well, and by evening there is no water left for the houses.`,
  (v, c) => [rule(c, 'A', 0, 'Beasts water at the stream, not the well'), rule(c, 'B', 0, 'Beasts must drink'), quarrelSplit(c, 0, 'Beasts at dawn only, before the houses draw', (E) => E.all(0.01))]),

  q('washing-fouled', 'The washing place fouled', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} says ${N(v, c.B)} soaks its hides above the washing place, and the women come back with the clothes stinking.`,
  (v, c) => [rule(c, 'A', 0, 'Hides go below the washing place'), dismiss(c, 'A smell harms nobody'), fine(c, 'B', 20, 'A fine, and the hides moved')]),

  q('stream-diverted', 'Water taken from the stream', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)} has dug a channel to water its garden from the stream, and ${N(v, c.A)}'s garden downstream is dry.`,
  (v, c) => [rule(c, 'A', 20, 'Fill in the channel'), quarrelSplit(c, 0, 'Each takes the water on alternate days'), rule(c, 'B', 0, 'The stream is for all who can dig to it')]),

  q('levy-cheated', 'The levy reckoned wrong', (v, r) => pair(v, r), (v, c) => `${P(v, c.a)} says the deme's levy was taken from his harvest twice, once in the field and once on the floor, and wants it back from the common granary. ${N(v, c.B)} took the reckoning.`,
  (v, c) => [{ label: 'Give it back from the granary', favours: c.A, hint: '40 kg from the granary', fx: (E) => { E.grain('common', c.A, 40); E.gw(c.A, 0.04); E.gw(c.B, -0.03); } }, rule(c, 'B', 0, 'The tally sticks say once'), dismiss(c, 'Let the tally sticks be counted again by others')]),

  q('relief-unfair', 'The city\'s grain shared unfairly', (v, r) => pair(v, r, (h) => h.wealth < 0.5, (h) => h.wealth > 0.5), (v, c) => `${N(v, c.A)} says that when grain was given out in the hungry time, ${N(v, c.B)} took more than its share, though it had grain of its own.`,
  (v, c) => [rule(c, 'A', 50, 'They give back the extra'), rule(c, 'B', 0, 'It was shared by mouths, as agreed'), fine(c, 'B', 30, 'The extra goes back to the granary')]),

  q('copse-overcut', 'The near copse cut bare', (v, r) => pair(v, r, () => true, (h) => h.stores.wood > 300), (v, c) => `${N(v, c.A)} complains that ${N(v, c.B)} is cutting the near copse faster than it grows, to sell the wood, and there will soon be none for anyone's hearth.`,
  (v, c) => [fine(c, 'B', 40, 'A limit on what each house cuts, and a fine for the past'), rule(c, 'B', 0, 'Wood is there to be cut'), quarrelSplit(c, 0, 'They cut in the far woods for a year')]),

  q('procession', 'First in the procession', (v, r) => pair(v, r, (h) => h.wealth > 0.6, (h) => h.wealth > 0.6), (v, c) => `${N(v, c.A)} and ${N(v, c.B)}, the two leading houses after yours, both claim the right to lead the procession at the deme's festival.`,
  (v, c) => [rule(c, 'A', 0, `${v.households[c.A].name}'s house leads`), rule(c, 'B', 0, `${v.households[c.B].name}'s house leads`), quarrelSplit(c, 0, 'By lot, before the altar', (E) => E.all(0.01))]),

  q('sacred-tree', 'A tree cut in the shrine', (v, r) => pair(v, r), (v, c) => `${P(v, c.b)} cut a tree in the precinct of the hero's shrine for firewood. ${N(v, c.A)}, who keep the shrine, call it sacrilege.`,
  (v, c) => [fine(c, 'B', 80, 'Sacrilege: a heavy fine and a sacrifice', (E) => E.all(0.02)), rule(c, 'B', 0, 'It was a dead tree'), fine(c, 'B', 25, 'A sacrifice, at his cost')]),

  q('lane-blocked', 'A lane built over', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)}'s new storeroom stands across the lane ${N(v, c.A)} uses to reach the threshing floor.`,
  (v, c) => [rule(c, 'A', 40, 'Pull it back, or pay for the long way round'), rule(c, 'B', 0, 'A man builds on his own ground'), quarrelSplit(c, 0, 'A gate through it, and the lane kept')]),

  // ---- your own house ----
  q('mine-sheep', 'Your sheep in their barley', (v, r) => {
    const A = mine(v);
    if (!A || !A.sheep) return null;
    const c = withMine(v, r, (h) => v.land.fields.some((f) => f.owner === h.id && sown(f)));
    return c && { ...c, kg: kgOf(r, 40, 120) };
  }, (v, c) => `Your own herder let your sheep into ${N(v, c.B)}'s barley, and ${P(v, c.b)} brings the matter to you, the demarch, knowing it is your house he complains of.`,
  (v, c) => [{ label: 'Your house pays in full', hint: `${c.kg} kg`, fx: (E) => { E.grain(c.A, c.B, c.kg); E.gw(c.B, 0.06); E.all(0.02); } }, { label: 'Half: the fence was down', favours: c.A, fx: (E) => { E.grain(c.A, c.B, c.kg / 2); E.gw(c.B, -0.02); } }, { label: 'Your herder says the sheep never went in', favours: c.A, fx: (E) => { E.gw(c.B, -0.1); } }]),

  q('mine-son', 'Your son struck a man', (v, r) => {
    const A = mine(v);
    if (!A || !members(v, A).some((p) => p.sex === 'm' && !p.player && !p.slave && ageYears(v, p) >= 16)) return null;
    return withMine(v, r);
  }, (v, c) => `A young man of your own house struck ${P(v, c.b)} in a quarrel at the wine-shop. ${P(v, c.b)}'s house want you, the demarch, to judge your own.`,
  (v, c) => [{ label: 'Your house pays for the blow, and more', hint: '60 kg', fx: (E) => { E.grain(c.A, c.B, 60); E.gw(c.B, 0.05); E.all(0.02); } }, { label: 'A small payment, and an apology', favours: c.A, fx: (E) => { E.grain(c.A, c.B, 20); } }, { label: 'He was provoked: nothing owed', favours: c.A, fx: (E) => { E.gw(c.B, -0.1); E.tie(c.A, c.B, -0.1); } }]),

  q('mine-rent', 'A rent you are owed', (v, r) => {
    const A = mine(v);
    const f = A && pick(r, v.land.fields.filter((x) => x.rent && x.rent.to === A.id && x.owner >= 0 && v.households[x.owner] && !v.households[x.owner].player));
    if (!f) return null;
    const B = v.households[f.owner];
    return { A: A.id, B: B.id, a: manOf(v, A).id, b: manOf(v, B).id, f: f.id };
  }, (v, c) => `${P(v, c.b)} says the share of his harvest from ${F(v, c.f)} that goes to your house as rent is crushing him in a bad year, and asks you to lower it.`,
  (v, c) => [{ label: 'Lower it by half', fx: (E) => { const f = v.land.fields[c.f]; if (f.rent) f.rent.share = (f.rent.share ?? 0.1) / 2; E.gw(c.B, 0.08); E.all(0.02); E.say('The rent on the field is halved.'); } }, { label: 'Let him off this year\'s', fx: (E) => { E.gw(c.B, 0.05); E.all(0.01); } }, { label: 'A rent is a rent', favours: c.A, fx: (E) => { E.gw(c.B, -0.08); } }]),

  q('mine-boundary', 'Your boundary', (v, r) => {
    const c = nearFields(v, r, (f) => v.households[f.owner].player, (g) => !v.households[g.owner].player, true);
    return c;
  }, (v, c) => `${P(v, c.b)} says your ploughmen have moved the headland between ${F(v, c.f)} and his ${F(v, c.g)}, and asks you to judge it, though it is your own land.`,
  (v, c) => [{ label: 'Give him the strip, and something for his trouble', hint: '30 kg', fx: (E) => { E.grain(c.A, c.B, 30); E.gw(c.B, 0.06); E.all(0.02); } }, { label: 'Have the old men of the deme walk it', fx: (E) => { E.gw(c.B, 0.02); E.all(0.01); } }, { label: 'Your men know your land', favours: c.A, fx: (E) => { E.gw(c.B, -0.1); } }]),

  q('mine-debt', 'A debt to your house', (v, r) => {
    const A = mine(v);
    const d = A && pick(r, (v.debts || []).filter((x) => x.to === A.id && x.kg > 40 && v.households[x.from] && !v.households[x.from].player));
    if (!d) return null;
    const B = v.households[d.from];
    return { A: A.id, B: B.id, a: manOf(v, A).id, b: manOf(v, B).id, kg: Math.round(d.kg) };
  }, (v, c) => `${N(v, c.B)} owes your house ${c.kg} kg and cannot pay. ${P(v, c.b)} asks the deme to see that his children are not left hungry for it.`,
  (v, c) => [{ label: 'Forgive the debt', fx: (E) => { E.forgive(c.B, c.A, 1); E.gw(c.B, 0.12); E.all(0.03); } }, { label: 'Wait a year for it', fx: (E) => { E.gw(c.B, 0.04); E.all(0.01); } }, { label: 'Paid, in sheep or barley, now', favours: c.A, fx: (E) => { E.grain(c.B, c.A, c.kg / 2); E.forgive(c.B, c.A, 0.5); E.gw(c.B, -0.1); E.all(-0.02); } }]),

  // ---- more of the same village life ----
  q('bees-swarm', 'A swarm of bees', (v, r) => pair(v, r), (v, c) => `A swarm left ${N(v, c.A)}'s hives and settled in a hollow tree on ${N(v, c.B)}'s land. ${N(v, c.B)} took the honey.`,
  (v, c) => [rule(c, 'A', 25, 'A swarm is its keeper\'s while he follows it'), rule(c, 'B', 0, 'What settles on a man\'s land is his'), quarrelSplit(c, 25, 'Half the honey')]),

  q('pig-garden', 'A pig in the garden', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)}'s pig rooted up ${N(v, c.A)}'s garden: the onions, the beans and the garlic for the winter.`,
  (v, c) => [rule(c, 'A', 30, 'They pay for the garden'), quarrelSplit(c, 30, 'Half, and the pig penned'), dismiss(c, 'Fence your garden')]),

  q('donkey-hire', 'A donkey worked to death', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)} hired ${N(v, c.A)}'s donkey to carry wood, and it died under the load on the hill path.`,
  (v, c) => [rule(c, 'A', 70, 'They pay its price'), quarrelSplit(c, 70, 'Half: it was old'), rule(c, 'B', 0, 'It died of age, not of the load')]),

  q('night-noise', 'Singing all night', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} complains that the young men of ${N(v, c.B)} sing and dance in the lane every night till cockcrow, and nobody can sleep before the ploughing.`,
  (v, c) => [rule(c, 'A', 0, 'Quiet after dark'), dismiss(c, 'Young men will be young'), quarrelSplit(c, 0, 'Quiet on working nights, not festivals')]),

  q('stolen-hen', 'Hens gone', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} says ${N(v, c.B)}'s children have been taking eggs, and now two hens are missing.`,
  (v, c) => [rule(c, 'A', 10, 'They pay for the hens'), dismiss(c, 'A fox takes hens'), quarrelSplit(c, 10, 'The children work a day for the hens')]),

  q('roof-rain', 'Rain off the neighbour\'s roof', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)} raised its roof, and now the winter rain pours off it into ${N(v, c.A)}'s courtyard and storeroom.`,
  (v, c) => [rule(c, 'A', 30, 'A gutter, at their cost, and the spoiled grain paid for'), quarrelSplit(c, 30, 'A gutter, shared'), rule(c, 'B', 0, 'A man may roof his house as he likes')]),

  q('loom-weights', 'Loom weights and wool', (v, r) => pair(v, r), (v, c) => `The women of ${N(v, c.A)} gave wool to ${N(v, c.B)} to be woven on shares, and say the cloth came back short and coarse.`,
  (v, c) => [rule(c, 'A', 25, 'The difference made good'), quarrelSplit(c, 25, 'Half'), dismiss(c, 'Next time they weave it themselves')]),

  q('dowry-jewels', 'Earrings not returned', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} lent a pair of gold earrings to a bride of ${N(v, c.B)} for her wedding. They have not come back.`,
  (v, c) => [rule(c, 'A', 60, 'Back, or their price'), rule(c, 'B', 0, 'They were a wedding gift'), dismiss(c, 'Let the women settle it')]),

  q('drunk-husband', 'A wife\'s father complains', (v, r) => pair(v, r), (v, c) => `${P(v, c.b)} says his daughter's husband in ${N(v, c.A)} drinks the household's wine and beats her, and asks the deme to warn him.`,
  (v, c) => [fine(c, 'A', 30, 'A warning before the deme, and a fine', (E) => E.gw(c.B, 0.04)), rule(c, 'A', 0, 'A man\'s house is his own'), quarrelSplit(c, 0, 'Her father may take her home if it happens again')]),

  q('false-witness', 'A false witness', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} says ${P(v, c.b)} swore falsely before the shrine in last year's quarrel over a goat, and has since been heard boasting of it.`,
  (v, c) => [fine(c, 'B', 70, 'False oath: a fine, and the old ruling undone', (E) => E.grain(c.B, c.A, 20)), rule(c, 'B', 0, 'Boasting is not proof'), dismiss(c, 'The gods punish false oaths')]),

  q('gleaning', 'Gleaners driven off', (v, r) => (monthOf(v) >= 7 && monthOf(v) <= 9 ? pair(v, r, (h) => h.wealth < 0.45, (h) => h.wealth > 0.55) : null), (v, c) => `The women of ${N(v, c.A)}, a poor house, were driven off ${N(v, c.B)}'s stubble with sticks when they came to glean.`,
  (v, c) => [rule(c, 'A', 20, 'Gleaning is the poor\'s right: a gift for the insult'), rule(c, 'B', 0, 'A man\'s stubble is his own'), quarrelSplit(c, 0, 'Gleaning after the sheaves are carried, as is the custom', (E) => E.all(0.01))]),

  q('sheaves-wet', 'Sheaves left in the rain', (v, r) => (monthOf(v) >= 7 && monthOf(v) <= 10 ? pair(v, r) : null), (v, c) => `${N(v, c.B)} carried ${N(v, c.A)}'s sheaves to the floor for a share, and left them out in the rain overnight. Half have sprouted.`,
  (v, c) => [rule(c, 'A', 50, 'They pay for the spoiled sheaves'), quarrelSplit(c, 50, 'Half: the rain came early'), rule(c, 'B', 0, 'Nobody could foresee rain in Skirophorion')]),

  q('seed-bad', 'Seed that would not sprout', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} bought seed barley from ${N(v, c.B)} and half the field has come up thin. They say the seed was old and weevilled.`,
  (v, c) => [rule(c, 'A', 60, 'They pay for the lost crop'), quarrelSplit(c, 60, 'Half'), rule(c, 'B', 0, 'The field was sown late')]),

  q('olive-press', 'Turns at the press', (v, r) => pair(v, r, (h) => orchard(v, h), (h) => orchard(v, h)), (v, c) => `${N(v, c.A)} and ${N(v, c.B)} share the old olive press, and each says the other kept it a day past his turn while his olives went mouldy.`,
  (v, c) => [rule(c, 'A', 30, `${v.households[c.A].name}'s house was wronged`), rule(c, 'B', 0, `${v.households[c.B].name}'s house was wronged`), quarrelSplit(c, 0, 'A written rota for the press', (E) => E.all(0.01))]),

  q('vintage-help', 'Treading the grapes', (v, r) => pair(v, r, (h) => has(v, h, 'vines')), (v, c) => `${N(v, c.B)} trod ${N(v, c.A)}'s grapes for a share of the must, and says they were given the last of the pressing, thin and sour.`,
  (v, c) => [{ label: 'Good wine for their share', favours: c.B, fx: (E) => { E.goods(c.A, c.B, 'wine', 40); E.gw(c.B, 0.03); } }, rule(c, 'A', 0, 'A share is a share of what comes'), quarrelSplit(c, 0, 'A jar from the first pressing')]),

  q('wine-shop', 'A tab at the wine-shop', (v, r) => pair(v, r, (h) => (h.stores.wine || 0) > 20), (v, c) => `${N(v, c.A)} sells wine by the cup from its doorway, and ${P(v, c.b)} has drunk on credit all winter and now says he paid as he went.`,
  (v, c) => [rule(c, 'A', 35, 'He pays the tab'), quarrelSplit(c, 35, 'Half, and no more credit'), rule(c, 'B', 0, 'No tally, no debt')]),

  q('horse-race', 'A wager on a race', (v, r) => pair(v, r), (v, c) => `At the festival ${P(v, c.a)} and ${P(v, c.b)} wagered a goat on the young men's race. Each says his man won.`,
  (v, c) => [rule(c, 'A', 30, `${P(v, c.a)} won`), rule(c, 'B', 0, `${P(v, c.b)} won`), dismiss(c, 'Wagers are not the deme\'s business')]),

  q('old-quarrel', 'An old feud', (v, r) => {
    const c = pair(v, r);
    return c && tie(v, c.A, c.B) < -0.2 ? c : null;
  }, (v, c) => `${N(v, c.A)} and ${N(v, c.B)} have been at odds for years, and it has come to their men refusing to stand beside each other in the line. The general will not like it.`,
  (v, c) => [{ label: 'Make them swear peace at the altar, and feast together at the deme\'s cost', hint: '60 kg from the granary', fx: (E) => { E.grain('common', c.A, 30); E.grain('common', c.B, 30); E.tie(c.A, c.B, 0.3); E.all(0.01); } }, rule(c, 'A', 0, `${v.households[c.A].name}'s house has the right of it`), dismiss(c, 'Let them hate each other; they will still fight')]),

  q('grave-plot', 'A family grave', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)} buried their grandmother in the plot by the road where ${N(v, c.A)}'s ancestors lie.`,
  (v, c) => [rule(c, 'A', 40, 'A sacrifice to the dead of the house wronged'), rule(c, 'B', 0, 'The road graves are anyone\'s'), quarrelSplit(c, 0, 'A boundary stone between the graves')]),

  q('oath-breaking', 'A sale sworn and broken', (v, r) => pair(v, r), (v, c) => `${P(v, c.b)} swore to sell ${N(v, c.A)} his yearling calf at the spring price, and then sold it to a man from Eleutherai for more.`,
  (v, c) => [rule(c, 'A', 40, 'He pays the difference he gained'), rule(c, 'B', 0, 'Nothing was paid; nothing was sold'), fine(c, 'B', 30, 'A broken oath: a fine')]),

  q('hired-poach', 'A hired man poached', (v, r) => pair(v, r, (h) => h.wealth > 0.5, (h) => h.wealth > 0.5), (v, c) => `${N(v, c.A)} hired a man for the season, and ${N(v, c.B)} took him away mid-harvest by offering more.`,
  (v, c) => [rule(c, 'A', 30, 'They pay for the lost days'), rule(c, 'B', 0, 'A free man works where he likes'), dismiss(c, 'Pay better next time')]),

  q('stone-wall-sheep', 'A wall knocked down', (v, r) => pair(v, r, () => true, (h) => h.sheep > 0), (v, c) => `${N(v, c.B)}'s sheep knocked down a length of ${N(v, c.A)}'s dry-stone wall, and their herder will not rebuild it.`,
  (v, c) => [rule(c, 'A', 20, 'The herder rebuilds it'), quarrelSplit(c, 20, 'Both houses, a morning\'s work'), dismiss(c, 'A wall sheep can knock down was falling anyway')]),

  q('spring-claim', 'A spring on the hillside', (v, r) => pair(v, r), (v, c) => `${N(v, c.B)} has walled in the little spring on the hillside, which ${N(v, c.A)}'s women have used for as long as anyone remembers.`,
  (v, c) => [rule(c, 'A', 0, 'The wall comes down: it is everyone\'s'), rule(c, 'B', 0, 'It rises on their land'), quarrelSplit(c, 0, 'A gap in the wall, and a share of the water')]),

  q('unpaid-bride-price', 'A promised ox', (v, r) => pair(v, r), (v, c) => `At the betrothal ${P(v, c.b)} promised ${N(v, c.A)} an ox along with his daughter. The wedding is past, the ox never came.`,
  (v, c) => [rule(c, 'A', 100, 'The ox, or its price'), quarrelSplit(c, 100, 'Half its price'), dismiss(c, 'Wedding promises are made in wine')]),

  q('foster-child', 'A child put out to nurse', (v, r) => pair(v, r), (v, c) => `${N(v, c.A)} put a baby out to nurse with a woman of ${N(v, c.B)}, and has not paid her for months.`,
  (v, c) => [rule(c, 'B', 30, 'Pay the nurse'), quarrelSplit(c, 30, 'Half now, half at harvest', undefined, 'A'), dismiss(c, 'Let them agree')]),

  q('thatch-fire', 'A fire from a neighbour\'s hearth', (v, r) => pair(v, r), (v, c) => `Sparks from ${N(v, c.B)}'s bread oven set ${N(v, c.A)}'s thatched storeroom alight. Most of the barley was saved; the roof was not.`,
  (v, c) => [rule(c, 'A', 70, 'They pay for the roof'), quarrelSplit(c, 70, 'Half: a dry wind'), rule(c, 'B', 0, 'An oven is an oven')]),

  q('stray-ram', 'A ram among the ewes', (v, r) => pair(v, r, (h) => h.sheep > 0, (h) => h.sheep > 0), (v, c) => `${N(v, c.B)}'s scrubby ram got in among ${N(v, c.A)}'s good ewes, and half the lambs will be his. ${N(v, c.A)} wanted a better ram's blood in them.`,
  (v, c) => [rule(c, 'A', 30, 'They pay for the spoiled breeding'), dismiss(c, 'Lambs are lambs'), quarrelSplit(c, 0, 'A share of the lambs to the ram\'s house', (E) => E.sheep(c.A, c.B, 1))]),

  q('cheese-sour', 'Sour cheese', (v, r) => pair(v, r, () => true, (h) => h.sheep > 5), (v, c) => `${N(v, c.A)} bought a winter's cheese from ${N(v, c.B)}'s dairy and half of it was maggoty by Posideon.`,
  (v, c) => [rule(c, 'A', 25, 'The price of the bad half back'), quarrelSplit(c, 25, 'A quarter back'), rule(c, 'B', 0, 'It was kept badly')]),
];
