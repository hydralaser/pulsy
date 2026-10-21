import { aliveHouseholds, dailyGrain, worth } from './economy.js';
import { regardWord } from './neighbours.js';
import { goodwillWord } from './council.js';

// The village's chronicle: what each year came to, kept for every year, and read out to you as the
// year turns, with what stands out in it.

// Counted as the year goes: the barley threshed, the wine and oil pressed, the quarrels heard and
// left.
export function tally(v, key, n = 1) {
  v.tally = v.tally || {};
  v.tally[key] = (v.tally[key] || 0) + n;
}

const CAUSES = [
  ['hunger', (p) => /hunger|starv/i.test(p.cause || '')],
  ['war and violence', (p) => /kill|wound|battle|wall|ambush|raid|assault|the line|struck/i.test(p.cause || '')],
  ['in childhood', (p, age) => age < 5],
  ['old age', (p, age) => age >= 60],
  ['sickness and mishap', () => true],
];

// The year just ended, as figures.
export function closeYear(v) {
  const end = v.day;
  const start = end - 360;
  if (start < 0) return null;
  const hs = aliveHouseholds(v);
  const alive = v.people.filter((p) => p.alive);
  const t = v.tally || {};
  const died = v.people.filter((p) => !p.alive && !p.gone && p.diedOn >= start && p.diedOn < end);
  const deaths = {};
  for (const p of died) {
    const age = (p.diedOn - p.born) / 360;
    const [cause] = CAUSES.find(([, f]) => f(p, age));
    deaths[cause] = (deaths[cause] || 0) + 1;
  }
  const worths = hs.map((h) => ({ name: h.player ? 'yours' : h.name, w: worth(v, h), player: !!h.player })).sort((a, b) => b.w - a.w);
  const gw = hs.filter((h) => !h.player).map((h) => h.goodwill ?? 0.6);
  const ha = (k) => v.land.fields.filter((f) => (k ? f.kind === k : !f.kind)).reduce((a, f) => a + f.ha, 0);
  const rec = {
    year: Math.floor(start / 360) + 1,
    people: alive.length,
    slaves: alive.filter((p) => p.slave).length,
    houses: hs.length,
    births: v.people.filter((p) => !p.from && p.born >= start && p.born < end).length,
    deaths: died.length,
    causes: deaths,
    harvest: Math.round(t.harvest || 0),
    wine: Math.round(t.wine || 0),
    oil: Math.round(t.oil || 0),
    grain: Math.round(hs.reduce((a, h) => a + h.stores.grain, 0)),
    common: Math.round(v.common.grain),
    coin: Math.round(hs.reduce((a, h) => a + (h.stores.coin || 0), 0)),
    sheep: v.flock.head,
    goodwill: gw.length ? gw.reduce((a, b) => a + b, 0) / gw.length : 0.6,
    standing: v.war ? v.war.standing : 0.5,
    rain: v.rain,
    grainHa: Math.round(ha(null) * 10) / 10,
    vinesHa: Math.round(ha('vines') * 10) / 10,
    olivesHa: Math.round(ha('olives') * 10) / 10,
    heard: t.heard || 0,
    festered: t.festered || 0,
    battles: (v.war && v.war.history || []).filter((x) => x.day >= start && x.day < end).length,
    fallen: (v.war && v.war.history || []).filter((x) => x.day >= start && x.day < end).reduce((a, x) => a + (x.dead || 0), 0),
    richest: worths[0] ? worths[0].name : '',
    poorest: worths.length ? worths[worths.length - 1].name : '',
    spread: worths.length > 1 ? Math.round(worths[0].w / Math.max(1, worths[worths.length - 1].w)) : 1,
    // Days of food in hand, for the whole village, as the new year begins.
    foodDays: Math.round(hs.reduce((a, h) => a + h.stores.grain, 0) / Math.max(1, hs.reduce((a, h) => a + dailyGrain(v, h), 0))),
  };
  v.chronicle = v.chronicle || [];
  v.chronicle.push(rec);
  v.tally = {};
  v.yearReport = rec.year;
  return rec;
}

const chronFmt = (n) => Math.round(n).toLocaleString('en-GB');
const pct = (x) => `${Math.round(x * 100)}%`;
const change = (a, b) => (b ? (a - b) / b : 0);

// What stands out in the year: the worrying first, then the rest.
export function insights(v, rec) {
  const all = v.chronicle || [];
  const prev = all[all.indexOf(rec) - 1] || null;
  const warn = [];
  const note = [];
  // People.
  const grew = prev ? rec.people - prev.people : 0;
  const main = Object.entries(rec.causes).sort((a, b) => b[1] - a[1])[0];
  (rec.deaths > rec.births + 2 ? warn : note).push(`${rec.births} born and ${rec.deaths} died${main ? `, most ${{ hunger: 'of hunger', 'war and violence': 'by war and violence', 'in childhood': 'in childhood', 'old age': 'of old age', 'sickness and mishap': 'from sickness and mishap' }[main[0]]} (${main[1]})` : ''}; ${prev ? `the village is ${grew >= 0 ? `${grew} larger` : `${-grew} smaller`} than a year ago, at ${rec.people}` : `${rec.people} people`}${rec.slaves ? `, ${rec.slaves} of them slaves` : ''}.`);
  if (rec.causes.hunger) warn.push(`${rec.causes.hunger} died of hunger. Look to the stores and the poorer houses before the lean months.`);
  // Food.
  if (rec.foodDays < 240) warn.push(`The houses hold ${chronFmt(rec.grain)} kg of barley between them: about ${rec.foodDays} days' food for everyone, short of a year. A bad harvest would mean hunger.`);
  else note.push(`The houses hold ${chronFmt(rec.grain)} kg of barley between them, about ${rec.foodDays} days' food; what they hold beyond a year's food slowly spoils.`);
  const poorHouses = aliveHouseholds(v).filter((h) => h.stores.grain < dailyGrain(v, h) * 150);
  if (poorHouses.length) warn.push(`${poorHouses.length === 1 ? 'One house is' : `${poorHouses.length} houses are`} short of food already: ${poorHouses.slice(0, 4).map((h) => (h.player ? 'yours' : `the house of ${h.name}`)).join(', ')}.`);
  // The harvest.
  if (rec.harvest) {
    const h = prev && prev.harvest ? change(rec.harvest, prev.harvest) : 0;
    note.push(`The barley harvest came to ${chronFmt(rec.harvest)} kg${prev && prev.harvest ? `, ${h >= 0 ? `${pct(h)} up on` : `${pct(-h)} down on`} last year` : ''}, in a year of ${rec.rain < 0.75 ? 'poor' : rec.rain > 1.15 ? 'good' : 'ordinary'} rains.`);
  }
  if (rec.wine || rec.oil) note.push(`The vines gave ${chronFmt(rec.wine)} litres of wine and the olives ${chronFmt(rec.oil)} kg of oil, from ${rec.vinesHa} ha and ${rec.olivesHa} ha.`);
  // Coin and wealth.
  if (prev) {
    const dc = rec.coin - prev.coin;
    note.push(`Coin in the houses ${dc >= 0 ? `rose by ${chronFmt(dc)}` : `fell by ${chronFmt(-dc)}`} to ${chronFmt(rec.coin)} drachmae.`);
  }
  if (rec.spread >= 6) warn.push(`The richest house (${rec.richest === 'yours' ? 'yours' : `the house of ${rec.richest}`}) is worth ${rec.spread} times the poorest (${rec.poorest === 'yours' ? 'yours' : `the house of ${rec.poorest}`}). Poor houses sell up, borrow and go hungry first.`);
  // Goodwill and standing.
  const low = aliveHouseholds(v).filter((h) => !h.player && (h.goodwill ?? 0.6) < 0.35);
  if (low.length) warn.push(`${low.length === 1 ? 'One house is' : `${low.length} houses are`} turning against you: ${low.slice(0, 4).map((h) => `the house of ${h.name} (${goodwillWord(h.goodwill ?? 0.6)})`).join(', ')}.`);
  if (prev) {
    const dg = rec.goodwill - prev.goodwill;
    if (Math.abs(dg) >= 0.03) (dg < 0 ? warn : note).push(`The village as a whole thinks ${dg > 0 ? 'better' : 'worse'} of you than a year ago (${goodwillWord(rec.goodwill)}).`);
    const ds = rec.standing - prev.standing;
    if (Math.abs(ds) >= 0.05) (ds < 0 ? warn : note).push(`${v.name}'s standing with the city has ${ds > 0 ? 'risen' : 'fallen'}, to ${pct(rec.standing)}${ds < 0 ? ': its prices are dearer and its courts less kind' : ''}.`);
  }
  // Quarrels.
  if (rec.festered) warn.push(`You left ${rec.festered} of ${rec.heard + rec.festered} quarrels unheard, and they festered.`);
  else if (rec.heard) note.push(`You heard ${rec.heard} quarrel${rec.heard === 1 ? '' : 's'}, and left none to fester.`);
  // War.
  if (rec.battles) (rec.fallen ? warn : note).push(`The army was called out ${rec.battles} time${rec.battles === 1 ? '' : 's'}; ${rec.fallen ? `${rec.fallen} of ${v.name}'s men fell` : 'none of its men fell'}.`);
  // Neighbours.
  const bad = Object.values(v.demes || {}).filter((d) => d.feud > 0.15);
  if (bad.length) warn.push(`There is bad blood with ${bad.map((d) => (d.side === 'boeotia' ? `the ${d.name}` : d.name)).join(', ')}: expect theft, burning and men beaten on the roads until it fades.`);
  const sour = Object.values(v.demes || {}).filter((d) => d.side === 'athens' && (d.regard ?? 0.6) < 0.35 && !(d.feud > 0.15));
  if (sour.length) note.push(`${sour.map((d) => d.name).join(', ')} ${sour.length === 1 ? 'is' : 'are'} ${regardWord(sour[0].regard)} toward ${v.name}, and will not marry their daughters into it.`);
  // Work undone.
  const behind = aliveHouseholds(v).filter((h) => (h.behind || 0) > 1).sort((a, b) => b.behind - a.behind);
  if (behind.length) note.push(`${behind.length === 1 ? 'One house' : `${behind.length} houses`} could not get through all their work for want of hands (${behind.slice(0, 3).map((h) => (h.player ? 'yours' : `the house of ${h.name}`)).join(', ')}); hired men or a slave from Athens would help.`);
  // The market.
  if (v.market && (v.market.oil < 0.85 || v.market.wine < 0.85)) note.push(`Athens is awash with ${v.market.oil < v.market.wine ? 'oil' : 'wine'}: it fetches ${pct(Math.min(v.market.oil, v.market.wine))} of its usual price.`);
  return { warn, note };
}

