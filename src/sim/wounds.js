import { WEAPONS, ARMOUR, HELMETS, GREAVES, WOUNDS, HORSE, pickWeighted } from './rules.js';
import { THRUST, CUT, MISSILE, BLUNT, HORSE_WOUNDS, GLANCES, WOUND_AREAS } from './woundtables.js';
import { isFormed, isRunning, isGone, dist, clamp, fwdOf, rightOf, shiftNerve, logEvent, bodyOf } from './core.js';
import { killSoldier, downSoldier } from './combat.js';
import { vacateSlot, placeInSlot, rearSlot } from './unit.js';
import { makeRng } from './rng.js';

const TABLES = { thrust: THRUST, cut: CUT, missile: MISSILE, blunt: BLUNT, horse: HORSE_WOUNDS };
const SIDE_WORD = { L: 'left', R: 'right' };

// How fit a man still is, from the blood he has lost: 1 unhurt, 0 when he can no longer stand.
// Everything that used to read his "health" reads this.
function condition(s) {
  return clamp(1 - (1 - s.blood) / WOUNDS.collapse, 0, 1);
}

// Where a blow is coming from, as he sees it.
function bearing(att, def) {
  const dx = att.pos.x - def.pos.x;
  const dy = att.pos.y - def.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const f = fwdOf(def.facing);
  const r = rightOf(def.facing);
  return { ahead: (dx * f.x + dy * f.y) / len, right: (dx * r.x + dy * r.y) / len };
}

// The pieces of kit that might be in the way of a blow to this part of him.
function armourOver(def, at) {
  const pieces = [];
  const add = (table, key, glance) => {
    const a = table[key];
    if (a && a.cover[at]) pieces.push({ a, glance });
  };
  add(HELMETS, def.helmet, 'helmet');
  add(ARMOUR, def.armour, def.armour);
  add(GREAVES, def.greaves, 'greaves');
  return pieces;
}

function armourCover(def, at) {
  let c = 0;
  for (const { a } of armourOver(def, at)) c = Math.max(c, a.cover[at]);
  return c;
}

// Pick a wound from a table: by its own weight, where the blow is coming from, how hard the
// weapon hits, and, for a skilled man, how much he looks for a gap in the armour.
function pickWound(rng, table, kind, def, att, from, power, filter) {
  const mix = WOUNDS.mix[kind];
  const aim = WOUNDS.aim[from];
  const gaps = att ? clamp((att.skill - 0.45) * WOUNDS.gapAim, -0.3, 0.6) : 0;
  const pairs = [];
  for (const e of table) {
    if (filter && !filter(e)) continue;
    const group = WOUND_AREAS[e[2]];
    let w = e[0] * mix[e[1]] * Math.pow(power, e[1] - 1.5);
    if (aim && group) w *= aim[group];
    // An eye he has already lost cannot be put out again.
    if (e[4] && e[4].eye === true && def.eyes === 0) continue;
    if (gaps && e[2] !== 'horse') w *= 1 - gaps * armourCover(def, e[2]);
    if (w > 0) pairs.push([e, w]);
  }
  return pairs.length ? pickWeighted(rng, pairs) : null;
}

// The same kind of wound to the same part of him, one grade less bad.
function lesser(rng, table, kind, def, e, grade, power) {
  if (grade < 0) return null;
  return pickWound(rng, table, kind, def, null, 'front', power, (o) => o[1] === grade && o[2] === e[2])
    || pickWound(rng, table, kind, def, null, 'front', power, (o) => o[1] === grade && WOUND_AREAS[o[2]] === WOUND_AREAS[e[2]]);
}

function fill(text, noun, side) {
  return text.replace(/\{w\}/g, noun).replace(/\{side\}/g, SIDE_WORD[side] || 'left');
}

// A blow, or a javelin, that has got past his shield. `how` says what hit him:
//   kind: 'thrust' | 'cut' | 'missile' | 'blunt' (default: what the weapon does)
//   noun: what to call it; power: how hard it hits; over: a spear from the second rank.
export function strike(world, att, def, how = {}) {
  const rng = world.rng;
  const weapon = WEAPONS[att.weapon];
  let kind = how.kind || weapon.wounds;
  const noun = how.noun || weapon.noun;
  let power = how.power ?? weapon.power;
  const { ahead, right } = bearing(att, def);

  // A blow at a horseman often lands on his horse.
  if (def.kind === 'horse' && !def.unhorsed && rng.chance(att.kind === 'horse' ? HORSE.horseHitMounted : HORSE.horseHit)) {
    woundHorse(world, att, def, noun, power);
    return;
  }

  // Between two horsemen on the move most blows glance.
  if (att.kind === 'horse' && def.kind === 'horse') power *= HORSE.glancing;
  else if (att.kind === 'horse') power *= HORSE.downward;
  // A horseman coming on at speed can simply ride a man down.
  if (att.kind === 'horse' && def.kind !== 'horse' && how.impact && rng.chance(0.25)) {
    kind = 'blunt';
    power = 1.1;
  }
  let from = 'front';
  if (ahead < -0.35) from = 'behind';
  else if (how.over) from = 'over';
  else if (def.kind === 'horse' && att.kind !== 'horse' && !def.unhorsed) from = 'below';
  else if (att.kind === 'horse' && def.kind !== 'horse') from = 'above';

  const table = TABLES[kind];
  let e = pickWound(rng, table, kind, def, att, from, power);
  if (!e) return;
  let grade = e[1];

  // Which side of him: the side the blow comes from, and from the front, more often the side
  // the shield does not cover.
  let pR = 0.5 + 0.25 * right;
  if (from === 'front' && def.shield !== 'none') pR += WOUNDS.shieldSide - 0.5;
  let side = rng.chance(clamp(pR, 0.1, 0.9)) ? 'R' : 'L';
  if (e[4] && e[4].eye === true && def.eyes === 1) side = def.eyeLost === 'R' ? 'L' : 'R';

  // The armour, if it is in the way.
  let text = null;
  for (const { a, glance } of armourOver(def, e[2])) {
    if (!rng.chance(a.cover[e[2]])) continue;
    const hold = (a.resist[kind] || 0) * clamp(1.25 - 0.25 * power, 0.6, 1.1);
    if (rng.chance(hold)) {
      // Turned. A heavy blow still hurts through the bronze.
      const bruise = grade >= 2 ? lesser(rng, BLUNT, 'blunt', def, e, grade - 2, 1) : null;
      if (bruise) {
        e = bruise;
        grade = e[1];
        text = fill(e[3], noun, side);
        kind = 'blunt';
      } else {
        grade = 0;
        text = fill(rng.pick(GLANCES[glance]), noun, side);
        e = [0, 0, e[2], text];
      }
    } else if (grade > 0 && rng.chance(hold)) {
      // Through, but the worse for having had to get through.
      const l = lesser(rng, table, kind, def, e, grade - 1, power);
      if (l) {
        e = l;
        grade = e[1];
      }
    }
    break;
  }
  applyWound(world, def, att, { at: e[2], grade, side, text: text || fill(e[3], noun, side), fx: e[4] || {}, kind });
}

function woundHorse(world, att, def, noun, power) {
  const rng = world.rng;
  const e = pickWound(rng, HORSE_WOUNDS, 'horse', def, null, 'front', power);
  if (!e) return;
  const grade = e[1];
  const text = fill(e[3], noun, 'L');
  def.lastHitT = world.t;
  def.resolve -= 0.15;
  def.wounds.push({ t: world.t, at: 'horse', grade, text, by: att.name, byId: att.id, bleed: 0, clot: 1, horse: true });
  def.record.woundsTaken++;
  if (grade === 0) return;
  // A wounded horse is slower, and its rider knows he may not get away on it.
  def.speedMul *= [1, 0.92, 0.75][grade] || 0.75;
  shiftNerve(world, def, -[0, 0.04, 0.08, 0.15][grade] * (1 - 0.4 * def.courage), 'wounds');
  if (grade < 3) return;
  // Brought down: the rider is thrown, and on the ground among the enemy he is done for the day.
  def.unhorsed = true;
  if (isNotable(world, def)) logEvent(world, 'wound', `${def.name} has ${text.replace(/^the horse/, 'his horse')}.`, { unit: def.side, who: def.id });
  const fall = pickWound(rng, BLUNT, 'blunt', def, null, 'front', 0.8);
  applyWound(world, def, att, { at: fall[2], grade: fall[1], side: rng.chance(0.5) ? 'L' : 'R', text: `thrown from his horse: ${fill(fall[3], 'fall', 'L')}`, fx: { ...(fall[4] || {}), down: true }, kind: 'blunt' });
}

function isNotable(world, s) {
  const u = s.kind === 'hoplite' ? world.units[s.unit] : null;
  return s.veteran || (u && (s.id === u.leaderId || s.id === u.secondId));
}

// What a lasting mark makes of a man people know.
const EPITHETS = {
  'one eye': 'the One-eyed',
  blindness: 'the Blind',
  'one hand': 'the One-handed',
  'a lame leg': 'the Lame',
  'a ruined face': 'the Scarred',
};

// What the wound does to him.
export function applyWound(world, def, att, w) {
  const rng = world.rng;
  const G = WOUNDS.grades[w.grade];
  const fx = w.fx;
  const group = WOUND_AREAS[w.at];
  const k = rng.range(0.7, 1.3);
  const vessel = fx.vessel ? WOUNDS.vessel : 1;
  const wound = {
    t: world.t, at: w.at, side: w.side, grade: w.grade, text: w.text, by: att ? att.name : '', byId: att ? att.id : -1,
    bleed: G.bleed * k * vessel, clot: G.clot * (fx.vessel ? 1.5 : 1), mark: fx.mark || null, gut: !!fx.gut,
  };
  def.wounds.push(wound);
  def.blood -= G.blood * k * (fx.vessel ? 1.5 : 1);
  if (wound.bleed > 0) def.bleeding = true;
  def.lastHitT = world.t;
  def.record.woundsTaken++;
  if (att) {
    att.record.woundsGiven++;
    att.resolve += 0.1;
  }
  const u = bodyOf(world, def);
  u.stats.wounds++;

  if (fx.instant) {
    killSoldier(world, def, att, w.text);
    return;
  }
  // What no longer works.
  const g = w.grade;
  if (group === 'arm' || group === 'shoulder') {
    if (w.side === 'R') def.skillMul *= [1, 0.92, 0.75, 0.5, 0.5][g];
    else def.shieldMul *= [1, 0.9, 0.7, 0.4, 0.4][g];
  }
  if (group === 'leg') def.speedMul *= [1, 0.92, 0.75, 0.5, 0.5][g];
  if (group === 'torso' || group === 'back') def.staminaCap = Math.max(0.3, def.staminaCap - [0, 0.03, 0.1, 0.2, 0.3][g]);
  if (group === 'head') shiftNerve(world, def, -[0, 0.03, 0.06, 0.1, 0.1][g], 'wounds');
  let down = !!fx.down || w.grade === 4;
  if (fx.stun) {
    if (g >= 2) down = true;
    else {
      // Dazed for a moment.
      def.attackT = (def.attackT || 0) + 2;
      def.supportT = (def.supportT || 0) + 2;
    }
  }
  if (fx.eye) {
    const both = fx.eye === 'both' || def.eyes === 1;
    def.eyes = both ? 0 : 1;
    def.eyeLost = both ? 'both' : w.side;
    def.skillMul *= 0.85;
    if (def.eyes === 0) down = true;
  }
  if (fx.mark && isNotable(world, def) && EPITHETS[fx.mark] && !def.epithet) def.epithet = EPITHETS[fx.mark];
  shiftNerve(world, def, -G.pain * (1 - 0.4 * def.courage), 'wounds');
  def.stamina = Math.max(0, def.stamina - G.wind);
  def.resolve -= g === 0 ? 0.15 : 0.25;
  def.health = condition(def);

  if (isNotable(world, def) && (g >= 2 || fx.mark)) {
    const more = fx.mark === 'one eye' ? ' He will lose the eye.' : fx.mark === 'one hand' ? ' He will lose the hand.' : '';
    logEvent(world, 'wound', `${def.name} takes ${w.text}.${more}`, { unit: def.side, who: def.id });
  }
  if (def.blood <= 0) {
    killSoldier(world, def, att, w.text);
    return;
  }
  if (down || def.health <= 0) {
    downSoldier(world, def, att, w.text);
    return;
  }
  // Men are shaken by their own kind falling beside them: hoplites by hoplites. Light troops
  // feel their own losses (see light.js).
  for (const { o, d } of def.friends) {
    if (d < 2 && isFormed(o) && o.kind === def.kind) shiftNerve(world, o, -0.015, 'casualties');
  }
  // A badly hurt man in the front rank drops back through the ranks.
  if (def.health < 0.4 && def.slot && def.slot.r === 0 && isFormed(def)) {
    const back = rearSlot(u, def.contingent);
    if (back) {
      vacateSlot(u, def);
      placeInSlot(u, def, back.f, back.r);
      def.state = 'returning';
      def.stateT = 0;
      def.target = -1;
      def.aggressor = false;
      if (isNotable(world, def)) logEvent(world, 'wound', `${def.name} is badly wounded and drops back.`, { unit: u.id, who: def.id });
    }
  }
}

// Every step: wounds bleed, and slow as they clot. A man who has bled enough goes down, and a
// man who bleeds out dies. Men down where the enemy now stands may be finished off.
export function stepWounds(world, dt) {
  // Once the battle is decided, what becomes of the wounded is settled by the aftermath.
  if (world.result) return;
  const check = world.step % 10 === 0;
  for (const s of world.soldiers) {
    if (s.state === 'dead') continue;
    if (s.bleeding) {
      let still = false;
      for (const w of s.wounds) {
        if (w.bleed <= 0) continue;
        s.blood -= w.bleed * dt;
        if (w.clot !== Infinity) w.bleed *= Math.exp(-dt / w.clot);
        if (w.bleed < 1e-5) w.bleed = 0;
        else still = true;
      }
      s.bleeding = still;
      s.health = condition(s);
      if (s.state === 'escaped') continue;
      const last = s.wounds[s.wounds.length - 1];
      const by = last && last.byId >= 0 ? world.soldiers[last.byId] : null;
      if (s.blood <= 0) {
        killSoldier(world, s, null, null, 'wounds', by);
        continue;
      }
      if (s.health <= 0 && s.state !== 'down') downSoldier(world, s, by, 'loss of blood');
    }
    if (check && s.state === 'down') despatch(world, s);
  }
}

function despatch(world, s) {
  let foe = null;
  for (const o of world.soldiers) {
    if (o.side === s.side || isGone(o) || isRunning(o) || dist(o.pos, s.pos) > 1.6) continue;
    foe = o;
    break;
  }
  if (!foe) return;
  for (const o of world.soldiers) {
    if (o.side === s.side && isFormed(o) && dist(o.pos, s.pos) < 2.5) return;
  }
  if (world.rng.chance(WOUNDS.despatch)) killSoldier(world, s, foe, null, 'despatched');
}

// After the battle: who of the wounded lives. Men down on a field the enemy holds may be killed
// where they lie; the rest are bound up, but some have bled too much by then, and belly wounds
// kill many men in the days after.
export function aftermath(world, holder) {
  const rng = makeRng((world.config.seed ^ 0x5eed) >>> 0);
  for (const s of world.soldiers) {
    if (s.state === 'dead' || !s.wounds.length) continue;
    let blood = s.blood;
    let mortal = false;
    for (const w of s.wounds) {
      if (w.bleed <= 0) continue;
      if (w.clot === Infinity) mortal = true;
      else blood -= w.bleed * w.clot * (1 - Math.exp(-WOUNDS.bindAfter / w.clot));
    }
    const gut = s.wounds.some((w) => w.gut);
    if (s.state === 'down' && holder != null && holder !== s.side && rng.chance(WOUNDS.strippedAfter)) s.fate = 'killed where he lay';
    else if (mortal || blood <= 0) s.fate = 'died of his wounds';
    else if (gut && rng.chance(WOUNDS.gutDeath)) s.fate = 'died of his wounds in the days after';
    else s.fate = s.state === 'down' ? 'carried off the field' : 'walked off the field';
  }
}

export function diedAfter(s) {
  return s.fate === 'killed where he lay' || (s.fate && s.fate.startsWith('died'));
}

// The marks a man carries away, if he lives.
export function marksOf(s) {
  return [...new Set(s.wounds.map((w) => w.mark).filter(Boolean))];
}
