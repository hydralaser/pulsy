import { CIVIC, SPOIL, CITY } from './rules.js';
import { clamp } from '../sim/core.js';
import { logNews, monthOf } from './clock.js';
import { aliveHouseholds, worth, dailyGrain } from './economy.js';
import { villageRng } from './people.js';
import { addGoodwill } from './council.js';
import { headOf } from './family.js';
import { keepBack } from './smith.js';

// What the well-off owe the city and the deme. The eisphora, a tax on wealth, which the city lays
// on the richer houses in most years of the war. A liturgy: the richest house pays for the chorus
// at the Rural Dionysia, and is honoured for it, the more so the more lavishly; a man who thinks
// another richer may name him, and if he is found so the burden passes to him. And the deme's
// festivals, which every house keeps by its means, with sacrifices and wine. And grain, which does
// not keep for ever.

const civicYear = (v) => Math.floor(v.day / 360);

export function civicDay(v) {
  civicV = v;
  spoil(v);
  const m = monthOf(v);
  const dom = v.day % 30;
  const y = civicYear(v);
  v.civicDone = v.civicDone || {};
  if (m === CIVIC.eisphora.month && dom === 5 && v.civicDone.eisphora !== y) {
    v.civicDone.eisphora = y;
    if (villageRng(v).chance(CIVIC.eisphora.chance)) eisphora(v);
  }
  if (m === CIVIC.liturgy.month && dom === 0 && v.civicDone.liturgy !== y) {
    v.civicDone.liturgy = y;
    liturgy(v);
  }
  CIVIC.festivals.forEach((f, i) => {
    if (m === f.month && dom === 10 && v.civicDone[`fest${i}`] !== y) {
      v.civicDone[`fest${i}`] = y;
      festival(v, i);
    }
  });
  // Left unanswered, the deme decides: the chorus paid as is due, the festival kept fittingly.
  if (v.civic && v.day - v.civic.day > CIVIC.answer) decideCivic(v, v.civic.kind === 'liturgy' ? 'due' : 'fitting', true);
}

// Damp, mice and weevils.
function spoil(v) {
  for (const h of aliveHouseholds(v)) {
    const old = h.stores.grain - dailyGrain(v, h) * 360;
    if (old > 0) h.stores.grain -= old * SPOIL.grain;
  }
  if (v.common && v.common.grain > 0) v.common.grain *= 1 - SPOIL.grain;
}

// Paying the city or the deme: in coin first, then in barley it can spare beyond its food to the
// next harvest and its seed. What cannot be paid, is not: nobody is made to go hungry for it.
let civicV = null;
function payOut(h, kg) {
  const coin = Math.min((h.stores.coin || 0) * CITY.drachma, kg);
  h.stores.coin = (h.stores.coin || 0) - coin / CITY.drachma;
  const spare = civicV ? Math.max(0, h.stores.grain - keepBack(civicV, h)) : Math.max(0, h.stores.grain);
  const grain = Math.min(spare, kg - coin);
  h.stores.grain -= grain;
  return coin + grain;
}

const nameOf = (h) => (h.player ? 'your house' : `the house of ${h.name}`);

// The eisphora: a fiftieth of what the richer houses are worth.
function eisphora(v) {
  const hs = [...aliveHouseholds(v)].sort((a, b) => worth(v, b) - worth(v, a));
  const taxed = hs.slice(0, Math.max(1, Math.round(hs.length * CIVIC.eisphora.richest)));
  let total = 0;
  let short = 0;
  const yours = [];
  for (const h of taxed) {
    const due = Math.round(worth(v, h) * CIVIC.eisphora.rate);
    const paid = payOut(h, due);
    total += paid;
    if (paid < due - 1) short++;
    if (h.player) yours.push(`${Math.round(due / CITY.drachma)} drachmae from your house`);
  }
  if (v.war) v.war.standing = clamp(v.war.standing + (short ? CIVIC.standing.eisphoraShort : CIVIC.standing.eisphoraPaid), 0, 1);
  logNews(v, 'council', `The city levies the eisphora for the war: ${taxed.length} of the richest houses pay ${Math.round(total / CITY.drachma)} drachmae between them${yours.length ? `, ${yours.join('')}` : ''}.${short ? ` ${short} could not pay in full, and the city notes it.` : ''}`, { pause: !!yours.length });
}

// The liturgy falls on the richest house that can bear it.
function liturgy(v) {
  const hs = [...aliveHouseholds(v)].sort((a, b) => worth(v, b) - worth(v, a));
  const cost = CIVIC.liturgy.cost;
  // The richest house that can find the money: land does not pay a chorus.
  const means = (x) => (x.stores.coin || 0) * CITY.drachma + Math.max(0, x.stores.grain - keepBack(v, x));
  const h = hs.find((x) => worth(v, x) >= CIVIC.liturgy.worth && means(x) >= cost);
  if (!h) {
    const kg = Math.min(cost, v.common.grain * 0.5);
    v.common.grain -= kg;
    logNews(v, 'council', `No house in ${v.name} can find the money for the chorus at the Rural Dionysia this year; the deme pays ${Math.round(kg)} kg of barley's worth from the common granary.`);
    return;
  }
  if (h.player) {
    const other = hs.find((x) => !x.player);
    v.civic = { kind: 'liturgy', day: v.day, cost, other: other ? other.id : -1 };
    logNews(v, 'council', `The deme lays this year's liturgy on your house: the chorus for the Rural Dionysia, about ${Math.round(cost / CITY.drachma)} drachmae.`, { pause: true });
    return;
  }
  // Another house pays, and gains in standing for it; a very rich one does it lavishly.
  const lavish = h.wealth > 0.8 && worth(v, h) > CIVIC.liturgy.worth * 2;
  const paid = payOut(h, cost * (lavish ? CIVIC.lavish : 1));
  const head = headOf(v, h);
  if (head && head.alive) head.reputation = clamp((head.reputation || 0) + (lavish ? 0.08 : 0.04), 0, 1);
  logNews(v, 'council', `The house of ${h.name} pays for the chorus at the Rural Dionysia${lavish ? ', lavishly' : ''}: ${Math.round(paid / CITY.drachma)} drachmae.`);
}

// A festival of the deme: how it is kept is for the demarch to say, the cost shared by every
// house by its means, the sacrifices from the flocks, the wine from the storerooms.
function festival(v, i) {
  const f = CIVIC.festivals[i];
  v.civic = { kind: 'festival', day: v.day, i };
  logNews(v, 'council', `${f.name.charAt(0).toUpperCase() + f.name.slice(1)} comes round. How shall the deme keep it?`, { pause: true });
}

export const FESTIVAL_SCALE = {
  modest: { label: 'Modestly', mul: 0.5, gw: -0.01 },
  fitting: { label: 'Fittingly', mul: 1, gw: 0.02 },
  lavish: { label: 'Lavishly', mul: 2, gw: 0.05 },
};

// What a festival would cost each house, and the deme.
export function festivalCost(v, i, scale) {
  const f = CIVIC.festivals[i];
  const s = FESTIVAL_SCALE[scale];
  const people = aliveHouseholds(v).reduce((a, h) => a + h.members.filter((id) => v.people[id].alive).length, 0);
  return {
    grain: Math.round(aliveHouseholds(v).reduce((a, h) => a + worth(v, h) * f.share, 0) * s.mul),
    sheep: Math.round(f.sheep * s.mul),
    wine: Math.round(f.wine * people * s.mul),
  };
}

export function decideCivic(v, choice, lapsed = false) {
  civicV = v;
  const c = v.civic;
  if (!c) return;
  v.civic = null;
  const hs = aliveHouseholds(v);
  if (c.kind === 'liturgy') {
    const me = hs.find((h) => h.player);
    if (!me) return;
    if (choice === 'antidosis' && c.other >= 0) {
      const o = v.households[c.other];
      // An exchange of property is offered: if he is found the richer, he pays.
      if (villageRng(v).chance(CIVIC.antidosis) || worth(v, o) > worth(v, me)) {
        payOut(o, c.cost);
        addGoodwill(v, o, -0.12);
        logNews(v, 'council', `You name the house of ${o.name} as richer than yours, and offer to exchange property with it if it will not take the liturgy. It is found so, and pays for the chorus, with ill grace.`);
      } else {
        payOut(me, c.cost * 1.2);
        for (const h of hs) addGoodwill(v, h, -0.02);
        if (v.war) v.war.standing = clamp(v.war.standing + CIVIC.standing.liturgyDodged, 0, 1);
        logNews(v, 'council', `You name the house of ${o.name} as richer than yours; the deme finds otherwise, and your house pays for the chorus after all, with the costs of the hearing, and the shame of it.`);
      }
      return;
    }
    const lavish = choice === 'lavish';
    const paid = payOut(me, c.cost * (lavish ? CIVIC.lavish : 1));
    for (const h of hs) addGoodwill(v, h, lavish ? 0.04 : 0.01);
    const head = headOf(v, me);
    if (head && head.alive) head.reputation = clamp((head.reputation || 0) + (lavish ? 0.1 : 0.04), 0, 1);
    if (lavish && v.war) v.war.standing = clamp(v.war.standing + CIVIC.standing.liturgyLavish, 0, 1);
    logNews(v, 'council', `${lapsed ? 'With no word from you, your' : 'Your'} house pays for the chorus at the Rural Dionysia${lavish ? ', lavishly: the deme will talk of it for years' : ''}: ${Math.round(paid / CITY.drachma)} drachmae.`);
    return;
  }
  // A festival.
  const f = CIVIC.festivals[c.i];
  const s = FESTIVAL_SCALE[choice] || FESTIVAL_SCALE.fitting;
  const cost = festivalCost(v, c.i, choice);
  const total = hs.reduce((a, h) => a + worth(v, h), 0) || 1;
  let grain = 0;
  for (const h of hs) grain += payOut(h, (cost.grain * worth(v, h)) / total);
  // What the houses cannot spare, the deme's common granary makes up as far as it can.
  const common = Math.min(Math.max(0, cost.grain - grain), v.common.grain * 0.5);
  v.common.grain -= common;
  // The sacrifices from the biggest flocks, the wine from the fullest storerooms.
  let sheep = cost.sheep;
  for (const h of [...hs].sort((a, b) => b.sheep - a.sheep)) {
    const n = Math.min(h.sheep, Math.ceil(sheep / 2));
    h.sheep -= n;
    v.flock.head = Math.max(0, v.flock.head - n);
    sheep -= n;
    if (sheep <= 0) break;
  }
  let wine = cost.wine;
  for (const h of [...hs].sort((a, b) => (b.stores.wine || 0) - (a.stores.wine || 0))) {
    const l = Math.min(h.stores.wine || 0, wine);
    h.stores.wine = (h.stores.wine || 0) - l;
    wine -= l;
    if (wine <= 0) break;
  }
  for (const h of hs) addGoodwill(v, h, s.gw);
  logNews(v, 'council', `${lapsed ? 'With no word from you, the deme keeps' : 'The deme keeps'} ${f.name} ${s.label.toLowerCase()}: ${Math.round(grain)} kg of barley's worth from the houses by their means${common > 1 ? ` and ${Math.round(common)} from the common granary` : ''}, ${cost.sheep - Math.max(0, sheep)} sheep sacrificed, ${cost.wine - Math.max(0, Math.round(wine)) > 0 ? `${cost.wine - Math.max(0, Math.round(wine))} litres of wine drunk${wine > 1 ? ' (all there was)' : ''}` : 'and no wine to be had'}.${s.gw > 0.03 ? ' Nobody will forget it.' : s.gw < 0 ? ' People grumble at the meanness of it.' : ''}`);
}
