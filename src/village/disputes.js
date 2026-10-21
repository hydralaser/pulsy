import { DISPUTES } from './rules.js';
import { clamp } from '../sim/core.js';
import { logNews } from './clock.js';
import { aliveHouseholds, owe, pay } from './economy.js';
import { villageRng } from './people.js';
import { addGoodwill, addTie, tie } from './council.js';
import { die } from './life.js';
import { addRegard, addFeud, demeOf } from './neighbours.js';
import { INTERNAL } from './quarrels.js';
import { OUTSIDE } from './feuds.js';

// As demarch you hear the village's quarrels: a boundary stone moved, sheep in the barley, a debt
// denied, an insult at the well. Each comes to you with the houses it is between and what they
// want; what you rule moves grain, coin and beasts between them, and moves their regard for you and
// for each other. Favour your own house, or your friends, and everyone else sees it. Leave a quarrel
// unheard and it festers. Now and then a quarrel is with another deme: over the oil trade, a
// daughter married there, a flock on the wrong hills. Those reach into the demes' own lives and the
// market in Athens, and handled badly can come to blood.

const ALL = [...INTERNAL, ...OUTSIDE];
const byKey = new Map(ALL.map((t) => [t.key, t]));

export function disputeDay(v) {
  v.disputes = v.disputes || [];
  v.nextDisputeId = v.nextDisputeId || 1;
  for (const d of [...v.disputes]) if (v.day - d.day > DISPUTES.answer) decideDispute(v, d.id, -1);
  if (v.disputes.length >= 2 || v.siege) return;
  const rng = villageRng(v);
  if (!rng.chance(1 / DISPUTES.every)) return;
  raise(v, rng, rng.chance(DISPUTES.outside));
}

// A quarrel comes to you: one that the village as it is now could have, not heard too lately.
export function raise(v, rng, outside, key = null) {
  v.disputeSeen = v.disputeSeen || {};
  const pool = key ? [byKey.get(key)] : shuffled(rng, outside ? OUTSIDE : INTERNAL);
  for (const t of pool) {
    if (!t || (!key && v.disputeSeen[t.key] > v.day - 720)) continue;
    let c = null;
    try {
      c = t.need(v, rng);
    } catch (e) {
      c = null;
    }
    if (!c) continue;
    const d = { id: v.nextDisputeId++, key: t.key, day: v.day, c, title: t.title, text: cap(t.text(v, c)), options: t.options(v, c).map((o) => ({ label: o.label, hint: o.hint || '' })), outside: !!outside };
    v.disputes.push(d);
    v.disputeSeen[t.key] = v.day;
    logNews(v, 'dispute', `${t.title}: ${d.text}`, { pause: true });
    return d;
  }
  return null;
}

// Your ruling, or -1 if you never gave one.
export function decideDispute(v, id, choice) {
  const d = (v.disputes || []).find((x) => x.id === id);
  if (!d) return;
  v.disputes = v.disputes.filter((x) => x !== d);
  const t = byKey.get(d.key);
  if (!t) return;
  const out = [];
  const E = effects(v, d.c, out);
  if (choice < 0) {
    if (t.lapse) t.lapse(E, d.c, v);
    else {
      for (const h of [d.c.A, d.c.B]) if (h != null) E.gw(h, -0.04);
      if (d.c.A != null && d.c.B != null) E.tie(d.c.A, d.c.B, -0.1);
      E.all(-0.01);
      out.push('The quarrel festers.');
    }
    logNews(v, 'dispute', `${d.title}: you never heard it.${out.length ? ` ${out.join(' ')}` : ''}`);
    return;
  }
  const o = t.options(v, d.c)[choice];
  if (!o) return;
  o.fx(E, d.c, v);
  // Seen to favour your own house, or a house close to yours.
  if (o.favours != null) {
    const me = v.households.find((h) => h.player);
    const fav = v.households[o.favours];
    if (me && fav) {
      const bias = fav.player ? 2 : tie(v, me.id, fav.id) > 0.3 ? 1 : 0;
      if (bias) {
        for (const h of aliveHouseholds(v)) if (h.id !== fav.id) addGoodwill(v, h, -DISPUTES.bias * bias);
        out.push(fav.player ? 'Everyone saw you rule for your own house.' : `Everyone knows the house of ${fav.name} is close to yours.`);
      }
    }
  }
  logNews(v, 'dispute', `${d.title}. You rule: ${o.label.replace(/\.$/, '')}.${out.length ? ` ${out.join(' ')}` : ''}`);
}

// What a ruling can do, by house and person ids. Every line it adds is said in the news.
function effects(v, c, out) {
  const H = (id) => (id === 'common' ? null : v.households[id]);
  const name = (id) => (id === 'common' ? 'the common granary' : v.households[id].player ? 'your house' : `the house of ${v.households[id].name}`);
  const store = (id) => (id === 'common' ? v.common : v.households[id].stores);
  return {
    // Barley from one to another; what cannot be paid now is owed.
    grain(from, to, kg) {
      kg = Math.round(kg);
      if (kg <= 0) return;
      const s = store(from);
      const now = Math.max(0, Math.min(kg, s.grain));
      s.grain -= now;
      store(to).grain += now;
      if (now < kg && from !== 'common' && to !== 'common') owe(v, from, to, kg - now, 'judgement');
      out.push(`${cap(name(from))} pays ${name(to)} ${kg} kg of barley${now < kg ? `, ${kg - now} of it owed` : ''}.`);
    },
    coin(from, to, dr) {
      dr = Math.round(dr);
      const s = store(from);
      const now = Math.max(0, Math.min(dr, s.coin || 0));
      s.coin = (s.coin || 0) - now;
      if (to !== 'city') store(to).coin = (store(to).coin || 0) + now;
      if (now < dr) this.grain(from, to === 'city' ? 'common' : to, (dr - now) * 10);
      out.push(`${cap(name(from))} pays ${dr} drachmae${to === 'city' ? '' : ` to ${name(to)}`}.`);
    },
    sheep(from, to, n) {
      const a = H(from);
      n = Math.min(n, a ? a.sheep : 0);
      if (n <= 0) return;
      a.sheep -= n;
      if (to === 'gone') v.flock.head = Math.max(0, v.flock.head - n);
      else H(to).sheep += n;
      out.push(`${cap(name(from))} ${to === 'gone' ? 'loses' : `hands over ${n} sheep to ${name(to)}`}${to === 'gone' ? ` ${n} sheep` : ''}.`);
    },
    goods(from, to, good, kg) {
      const s = store(from);
      kg = Math.min(kg, s[good] || 0);
      if (kg <= 0) return;
      s[good] -= kg;
      store(to)[good] = (store(to)[good] || 0) + kg;
      out.push(`${cap(name(from))} hands over ${Math.round(kg)} ${good === 'wine' ? 'litres of wine' : `kg of ${good}`} to ${name(to)}.`);
    },
    // The common granary pays for something.
    spend(kg, what) {
      const now = Math.min(kg, v.common.grain);
      v.common.grain -= now;
      out.push(`${Math.round(now)} kg from the common granary for ${what}.`);
    },
    fine(id, kg) {
      this.grain(id, 'common', kg);
    },
    gw(id, d) {
      if (id == null || id === 'common') return;
      addGoodwill(v, v.households[id], d);
    },
    all(d) {
      for (const h of aliveHouseholds(v)) addGoodwill(v, h, d);
    },
    tie(a, b, d) {
      if (a == null || b == null || a === b) return;
      addTie(v, a, b, d);
    },
    hurt(pid, d) {
      const p = v.people[pid];
      if (!p || !p.alive) return;
      p.health = clamp(p.health - d, 0.05, 1);
    },
    kill(pid, how) {
      const p = v.people[pid];
      if (p && p.alive) die(v, p, how);
    },
    rep(pid, d) {
      const p = v.people[pid];
      if (p && p.alive) p.reputation = clamp((p.reputation || 0) + d, 0, 1);
    },
    free(pid) {
      const p = v.people[pid];
      if (p && p.alive && p.slave) {
        p.slave = false;
        out.push(`${p.name} is free.`);
      }
    },
    forgive(from, to, share) {
      for (const dbt of v.debts) if (dbt.from === from && dbt.to === to) dbt.kg *= 1 - share;
      v.debts = v.debts.filter((x) => x.kg > 1);
    },
    owe(from, to, kg) {
      owe(v, from, to, Math.round(kg), 'judgement');
    },
    regard(deme, d) {
      addRegard(v, deme, d);
    },
    feud(deme, d) {
      addFeud(v, deme, d);
    },
    standing(d) {
      if (v.war) v.war.standing = clamp(v.war.standing + d, 0, 1);
    },
    say(text) {
      out.push(text);
    },
    pay(from, to, kg, why) {
      pay(v, from, to, kg, why);
    },
    deme: (n) => demeOf(v, n),
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function shuffled(rng, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function disputeOf(v, id) {
  return (v.disputes || []).find((d) => d.id === id) || null;
}
