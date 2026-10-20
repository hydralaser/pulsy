import { FAMILY } from './rules.js';
import { ageYears, canFight } from './people.js';
import { logNews } from './clock.js';
import { worth } from './economy.js';

// Households last longer than the people in them. The head is the senior man; when he dies, or
// grows too old to run the farm, his eldest son takes over and the household takes his name. Sons
// stay in their father's household when they marry, as most did; brothers go their own ways once
// their father is gone and there is a house for them, each taking his share of the land, for
// Attic land was divided among sons. A daughter marries out with a dowry. A dead man's armour
// stays in the household for his sons.

export function headOf(v, h) {
  return h.head >= 0 ? v.people[h.head] : null;
}

export function houseName(v, h) {
  return h.player ? 'Your house' : `House of ${h.name}`;
}

// The man who should head a household now.
function rightfulHead(v, h, exclude = -1) {
  const living = h.members.map((id) => v.people[id]).filter((p) => p.alive && p.id !== exclude && !p.slave);
  const men = living.filter((p) => p.sex === 'm').sort((a, b) => a.born - b.born);
  const old = headOf(v, h);
  // His sons first, eldest first; then his brothers; then any man of the house.
  const sons = old ? men.filter((p) => p.father === old.id) : [];
  const grown = (p) => ageYears(v, p) >= 16;
  return sons.find(grown) || men.find(grown) || sons[0] || men[0] || living.sort((a, b) => a.born - b.born)[0] || null;
}

function setHead(v, h, p, how) {
  const old = headOf(v, h);
  h.head = p ? p.id : -1;
  if (!p) return;
  if (p.sex === 'm') h.name = p.name;
  const wasYou = h.player && old && old.player;
  if (old) old.player = false;
  if (h.player) {
    p.player = true;
    if (wasYou && how === 'died') logNews(v, 'family', `${p.name}, ${old && p.father === old.id ? 'his son' : 'his heir'}, is now head of your house and the leading man of the village.`, { pause: true, house: h.id });
  }
}

// When someone dies: the household passes on if it was its head, and his armour stays at home.
export function onDeath(v, p) {
  const h = v.households[p.household];
  if (p.weapon && p.shield && p.shield !== 'none' && !p.slave) {
    h.armoury = h.armoury || [];
    h.armoury.push({ weapon: p.weapon, shield: p.shield, armour: p.armour, helmet: p.helmet, greaves: p.greaves, kit: p.kit ? { ...p.kit } : undefined });
  }
  if (h.head === p.id) {
    const heir = rightfulHead(v, h, p.id);
    setHead(v, h, heir, 'died');
    if (heir && !h.player) logNews(v, 'family', `${heir.name} is now head of the house that was ${p.name}'s.`, { house: h.id });
    if (!heir) passLeadership(v, h);
  }
}

// If your whole house dies out, the village's leading man is the head of its richest house, and he
// moves into the great house.
function passLeadership(v, h) {
  if (!h.player) return;
  h.player = false;
  const next = v.households.filter((o) => o !== h && o.members.some((id) => v.people[id].alive)).sort((a, b) => worth(v, b) - worth(v, a))[0];
  if (!next) return;
  next.player = true;
  next.plan = null;
  v.petitions = (v.petitions || []).filter((p) => p.house !== next.id);
  const great = v.land.houses.findIndex((x) => x.great);
  next.house = great;
  h.house = -1;
  const head = headOf(v, next);
  if (head) head.player = true;
  logNews(v, 'family', `Your house has died out. ${head ? head.name : 'The house of ' + next.name}, head of the richest house left, is now the leading man of the village, and moves into the great house.`, { pause: true });
}

// Each day: the old hand the farm to their sons, and men with households of their own to set up
// go when there is a house for them.
export function familyDay(v) {
  for (const h of v.households) {
    if (!h.members.some((id) => v.people[id].alive)) continue;
    const head = headOf(v, h);
    // An old man hands the farm to his grown son.
    if (head && head.alive && ageYears(v, head) >= FAMILY.retire) {
      const son = h.members.map((id) => v.people[id]).filter((p) => p.alive && p.father === head.id && p.sex === 'm' && ageYears(v, p) >= FAMILY.takeOver).sort((a, b) => a.born - b.born)[0];
      if (son) {
        setHead(v, h, son, 'retired');
        logNews(v, 'family', `Old ${head.name} hands the farm to his son ${son.name}.`, { house: h.id });
      }
    }
    // Married men who are not the head and whose father no longer runs the house want their own.
    const cur = headOf(v, h);
    const leaving = h.members.map((id) => v.people[id]).filter((p) => p.alive && p.sex === 'm' && !p.slave && p.spouse >= 0 && v.people[p.spouse].alive
      && cur && p.id !== cur.id && p.father !== cur.id && ageYears(v, p) >= 20);
    h.waiting = leaving.length ? leaving[0].id : -1;
    if (!leaving.length) continue;
    const plot = freeHouse(v);
    if (plot >= 0) split(v, h, leaving[0], plot);
  }
}

// A house standing empty, if there is one.
export function freeHouse(v) {
  const taken = new Set(v.households.filter((h) => h.members.some((id) => v.people[id].alive)).map((h) => h.house));
  return v.land.houses.findIndex((x, i) => x.built && !x.great && !taken.has(i));
}

// A man sets up his own household: his wife and children go with him, he takes his share of the
// land, the sheep and the stores, and the house's ways of working.
export function split(v, from, man, plot) {
  const id = v.households.length;
  const goers = new Set([man.id, man.spouse]);
  for (const p of v.people) if (p.alive && p.household === from.id && (p.father === man.id || (p.mother === man.spouse && p.mother >= 0)) && p.spouse < 0) goers.add(p.id);
  const h = {
    id,
    house: plot,
    assign: { ...from.assign },
    members: [...goers],
    wealth: from.wealth,
    player: false,
    head: man.id,
    name: man.name,
    sheep: 0,
    stores: { grain: 0, wood: 0, wool: 0, cloth: 0, stone: 0 },
    // A new house sets up with tools of its own, not new.
    tools: { plough: 0.6, sickle: 0.6, axe: 0.6 },
    armoury: [],
    goodwill: from.player ? 0.7 : from.goodwill,
    ordered: { m: false, f: false },
    plan: null,
  };
  // His share: the land of his father divided among the brothers still at home and him.
  const father = man.father;
  const brothers = from.members.map((pid) => v.people[pid]).filter((p) => p.alive && p.sex === 'm' && !p.slave && ageYears(v, p) >= 16 && (p.id === man.id || (father >= 0 && p.father === father))).length;
  const share = 1 / Math.max(2, brothers);
  const plots = v.land.fields.filter((f) => f.owner === from.id).sort((a, b) => a.rotation - b.rotation || a.dist - b.dist);
  const take = Math.round(plots.length * share);
  // Take whole pairs where possible, one of each rotation, so both houses can sow every year.
  const r0 = plots.filter((f) => f.rotation === 0);
  const r1 = plots.filter((f) => f.rotation === 1);
  const mine = [];
  for (let i = 0; mine.length < take; i++) {
    const f = i % 2 === 0 ? r0.pop() : r1.pop();
    if (f) mine.push(f);
    if (!r0.length && !r1.length) break;
  }
  for (const f of mine) f.owner = id;
  // Stores and sheep by the mouths that go.
  const before = from.members.filter((pid) => v.people[pid].alive).length;
  const part = goers.size / Math.max(1, before);
  for (const k of Object.keys(h.stores)) {
    const amount = (from.stores[k] || 0) * part;
    from.stores[k] -= amount;
    h.stores[k] = amount;
  }
  h.sheep = Math.floor(from.sheep * share);
  from.sheep -= h.sheep;
  for (const pid of goers) {
    const p = v.people[pid];
    p.household = id;
    p.homeAt = null;
  }
  from.members = from.members.filter((pid) => !goers.has(pid));
  v.households.push(h);
  // Brothers' households start close.
  v.ties = v.ties || {};
  const k = from.id < id ? `${from.id}-${id}` : `${id}-${from.id}`;
  v.ties[k] = 0.5;
  const where = v.land.houses[plot].outside ? 'outside the wall' : 'inside the wall';
  logNews(v, 'family', `${man.name}${v.people[man.father] ? `, son of ${v.people[man.father].name},` : ''} sets up his own household in a house ${where}, with ${mine.length} plot${mine.length === 1 ? '' : 's'} of land.`, { house: id, pause: from.player });
  return h;
}

// A bride brings a dowry from her father's house to her husband's: some grain, cloth and sheep.
export function dowry(v, fromH, toH, bride) {
  const s = fromH.stores;
  const grain = Math.min(FAMILY.dowryGrain, s.grain * 0.1);
  const cloth = s.cloth * 0.25;
  const sheep = fromH.sheep >= 6 ? Math.min(3, Math.floor(fromH.sheep * 0.15)) : 0;
  s.grain -= grain;
  s.cloth -= cloth;
  fromH.sheep -= sheep;
  toH.stores.grain += grain;
  toH.stores.cloth += cloth;
  toH.sheep += sheep;
  return { grain, cloth, sheep };
}

// A young man coming of age takes his father's or grandfather's armour if the house has it laid by.
export function inheritKit(v, p) {
  const h = v.households[p.household];
  if (!h.armoury || !h.armoury.length || !canFight(v, p)) return false;
  // The best piece first.
  h.armoury.sort((a, b) => (b.armour !== 'none') - (a.armour !== 'none'));
  Object.assign(p, h.armoury.shift());
  return true;
}
