import { CONFUSABLES, VERBS, TENSES, PERSONS, VERB_TIERS } from './data.js';
import { WORD_LEVELS } from './words.js';
export const LEVELS = Object.keys(WORD_LEVELS);

// ---------------- text helpers ----------------
const ARTICLE = /^(?:(?:il|lo|la|i|gli|le|un|una|uno)\s+|(?:l|un)['’]\s*)/i;
// the first version stripped article-like letters without needing a space ("insieme" -> "nsieme");
// kept only so saved progress can be moved to the corrected ids
const OLD_ARTICLE = /^(il|lo|la|i|gli|le|un|una|uno|l'|un')\s*/i;
export const oldNorm = s => s.trim().toLowerCase().replace(OLD_ARTICLE, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’]/g, "'");
export const stripArticle = s => s.replace(ARTICLE, '');
export const norm = s => stripArticle(s.trim().toLowerCase())
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'");
const undouble = s => s.replace(/(.)\1/g, '$1');
const glossItems = en => en.toLowerCase().replace(/\(.*?\)/g, '').split(/[\/,;]/)
  .map(x => x.trim().replace(/^to /, '')).filter(Boolean);

export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// How "sound-alike" two Italian words are (0..1).
export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (x === y) return 0;
  if (undouble(x) === undouble(y)) return 0.97;           // penna / pena
  const d = lev(x, y), L = Math.max(x.length, y.length);
  let s = 1 - d / L;
  if (d === 1) s += 0.25;                                  // nove / nave
  if (x.slice(0, 3) === y.slice(0, 3)) s += 0.08;
  if (x.slice(-3) === y.slice(-3)) s += 0.05;
  return d > 3 ? 0 : Math.min(s, 0.95);
}

const glossConflict = (a, b) => {
  const A = glossItems(a.en), B = glossItems(b.en);
  return A.some(x => B.includes(x)) || norm(a.it) === norm(b.it);
};

const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const pick = arr => arr[Math.random() * arr.length | 0];

// ---------------- conjugation ----------------
const AUX = { a: ['ho', 'hai', 'ha', 'abbiamo', 'avete', 'hanno'], e: ['sono', 'sei', 'è', 'siamo', 'siete', 'sono'] };
const FUT_END = ['ò', 'ai', 'à', 'emo', 'ete', 'anno'];
const COND_END = ['ei', 'esti', 'ebbe', 'emmo', 'este', 'ebbero'];
const IMP_END = ['o', 'i', 'a', 'amo', 'ate', 'ano'];

// join a stem and ending applying -care/-gare (add h) and -iare (merge i) spelling rules
function joinAre(stem, end) {
  if (/[cg]$/.test(stem) && /^[ie]/.test(end)) return stem + 'h' + end;
  if (/i$/.test(stem) && /^i/.test(end)) return stem.slice(0, -1) + end;
  return stem + end;
}

const cache = new Map();
export function conjugate(v) {
  if (cache.has(v.inf)) return cache.get(v.inf);
  const cls = v.inf.slice(-3);              // are / ere / ire
  const stem = v.inf.slice(0, -3);
  const T = {};
  const join = cls === 'are' ? joinAre : (s, e) => s + e;

  if (v.pres) T.pres = v.pres;
  else if (cls === 'are') T.pres = ['o', 'i', 'a', 'iamo', 'ate', 'ano'].map(e => join(stem, e));
  else if (v.isc) T.pres = ['isco', 'isci', 'isce', 'iamo', 'ite', 'iscono'].map(e => stem + e);
  else T.pres = ['o', 'i', 'e', 'iamo', cls === 'ere' ? 'ete' : 'ite', 'ono'].map(e => stem + e);

  if (v.imp) T.imp = v.imp;
  else { const s = v.impStem || stem + cls[0] + 'v'; T.imp = IMP_END.map(e => s + e); }

  let fs = v.fut;
  if (!fs) {
    if (cls === 'are') fs = /[cg]i$/.test(stem) ? stem.slice(0, -1) + 'er' : /[cg]$/.test(stem) ? stem + 'her' : stem + 'er';
    else fs = stem + (cls === 'ere' ? 'er' : 'ir');
  }
  T.fut = FUT_END.map(e => fs + e);
  T.cond = COND_END.map(e => fs + e);

  const pp = v.pp || stem + { are: 'ato', ere: 'uto', ire: 'ito' }[cls];
  const aux = v.aux === 'e' ? 'e' : 'a';
  const agree = i => aux === 'e' && i >= 3 ? pp.replace(/o$/, 'i') : pp;
  T.pp = AUX[aux].map((a, i) => a + ' ' + agree(i));
  // the classic mistake: wrong auxiliary
  const other = aux === 'e' ? 'a' : 'e';
  T.ppWrongAux = AUX[other].map((a, i) => a + ' ' + (other === 'e' && i >= 3 ? pp.replace(/o$/, 'i') : pp));

  if (v.cong) T.cong = v.cong;
  else if (cls === 'are') T.cong = ['i', 'i', 'i', 'iamo', 'iate', 'ino'].map(e => join(stem, e));
  else if (v.isc) T.cong = ['isca', 'isca', 'isca', 'iamo', 'iate', 'iscano'].map(e => stem + e);
  else T.cong = ['a', 'a', 'a', 'iamo', 'iate', 'ano'].map(e => stem + e);

  T.pastPart = pp; T.aux = aux;
  cache.set(v.inf, T);
  return T;
}

// ---------------- cards & sets ----------------
const parse = line => { const [it, en, pos] = line.split('|'); return { it, en, pos }; };

export function buildDeck(customWords = []) {
  const cards = new Map();
  const sets = [];
  const allWords = [];
  const addWordSet = (id, name, words, custom = false, level = null, part = 0) => {
    const ids = [];
    for (const w of words) {
      const p = typeof w === 'string' ? parse(w) : w;
      const cid = 'w:' + norm(p.it);
      if (!cards.has(cid)) {
        const card = { id: cid, kind: 'word', ...p, set: id };
        cards.set(cid, card); allWords.push(card);
      }
      ids.push(cid);
    }
    sets.push({ id, name, kind: 'word', cards: [...new Set(ids)], custom, level, part });
  };
  // each level is split into parts of roughly 100 words, most frequent first
  for (const lvl of LEVELS) {
    const words = WORD_LEVELS[lvl], parts = Math.max(1, Math.round(words.length / 100)), size = Math.ceil(words.length / parts);
    for (let p = 0; p < parts; p++) addWordSet(`${lvl}-${p + 1}`, `${lvl} · part ${p + 1}`, words.slice(p * size, (p + 1) * size), false, lvl, p + 1);
  }
  if (customWords.length) addWordSet('custom', 'My words', customWords, true);

  for (const t of TENSES) for (const tier of [1, 2, 3]) {
    const ids = [];
    for (const v of VERBS.filter(v => v.tier === tier)) {
      const forms = conjugate(v)[t.id];
      PERSONS.forEach((p, i) => {
        const cid = `c:${v.inf}:${t.id}:${i}`;
        cards.set(cid, { id: cid, kind: 'conj', verb: v, tense: t, person: i, answer: forms[i], set: `${t.id}${tier}` });
        ids.push(cid);
      });
    }
    sets.push({ id: `${t.id}${tier}`, name: `${t.name}: ${VERB_TIERS[tier].toLowerCase()}`, tense: t.id, tier, kind: 'conj', cards: ids });
  }
  const known = new Set(allWords.map(w => norm(w.it)));
  const distractorPool = allWords.concat(CONFUSABLES.map(parse).filter(c => !known.has(norm(c.it))).map(c => ({ ...c, confusable: true })));
  return { cards, sets, allWords, distractorPool };
}

// ---------------- multiple choice ----------------
// near = how many sound-alike / same-verb options to include; grows as a card matures
export function nearCountFor(state) {
  const ivl = state?.ivl || 0;
  return ivl < 2 ? 1 : ivl < 10 ? 2 : 3;
}

export function wordOptions(deck, card, mode, nearN, n = 4) {
  const pool = deck.distractorPool.filter(c => !glossConflict(c, card));
  const label = c => (mode === 'it-en' ? c.en : c.it);
  const used = new Set([label(card).toLowerCase()]);
  const out = [];
  const take = c => { const l = label(c).toLowerCase(); if (used.has(l)) return false; used.add(l); out.push(c); return true; };

  const near = pool.map(c => [c, similarity(c.it, card.it)]).filter(([, s]) => s >= 0.5)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  // listening mode is all about sound-alikes: use as many as we have
  const wantNear = mode === 'listen' ? n - 1 : nearN;
  for (const c of shuffle(near.slice(0, Math.max(wantNear + 1, 3)))) { if (out.length >= wantNear) break; take(c); }
  const samePos = shuffle(pool.filter(c => c.pos === card.pos && !c.confusable));
  const rest = shuffle(pool.filter(c => !c.confusable));
  for (const c of samePos.concat(rest)) { if (out.length >= n - 1) break; take(c); }
  return shuffle([{ ...card, correct: true }, ...out]).map(c => ({ text: label(c), correct: !!c.correct, item: c }));
}

export function conjOptions(card, nearN, n = 4) {
  const T = conjugate(card.verb), t = card.tense.id, p = card.person;
  const used = new Set([card.answer]);
  const out = [];
  const take = (text, why) => { if (!text || used.has(text)) return; used.add(text); out.push({ text, why }); };
  const samePerson = shuffle(TENSES.filter(x => x.id !== t).map(x => [T[x.id][p], x.name]));
  const who = (tid, form) => PERSONS.filter((_, i) => T[tid][i] === form).join(' / ');
  const sameTense = shuffle(PERSONS.map((_, i) => [T[t][i], `${card.tense.name}, ${who(t, T[t][i])}`]).filter((_, i) => i !== p));
  const tricky = [];
  if (t === 'pp') tricky.push([T.ppWrongAux[p], `wrong auxiliary: ${card.verb.inf} takes ${T.aux === 'e' ? 'essere' : 'avere'}`]);
  // near = same tense (other person) + typical mistakes; far = same person, other tenses
  const nearList = shuffle(tricky.concat(sameTense));
  for (const [x, w] of nearList) { if (out.length >= nearN) break; take(x, w); }
  for (const [x, w] of samePerson.concat(sameTense)) { if (out.length >= n - 1) break; take(x, w); }
  return shuffle([{ text: card.answer, correct: true }, ...out.map(o => ({ ...o, correct: false }))]);
}

// ---------------- scheduler ----------------
// Answers are graded automatically: wrong = again, slow = hard, fast = good.
const DAY = 864e5;
export function schedule(state, grade, now = Date.now()) {
  const s = { ivl: 0, ease: 2.5, reps: 0, lapses: 0, learn: 0, ...state };
  s.last = now;
  if (s.learn !== null && s.learn !== undefined) {
    // learning / relearning: needs two correct answers in a row (within the session)
    if (grade === 'again') { s.learn = 0; s.due = now + 60e3; }
    else if (s.learn === 0) { s.learn = 1; s.due = now + 5 * 60e3; }
    else {
      s.learn = null; s.reps++;
      s.ivl = s.lapses ? Math.max(1, Math.round(s.prevIvl * 0.4)) : (grade === 'hard' ? 1 : 2);
      s.due = now + s.ivl * DAY;
    }
    return s;
  }
  if (grade === 'again') {
    s.lapses++; s.ease = Math.max(1.3, s.ease - 0.2); s.prevIvl = s.ivl; s.learn = 0; s.due = now + 60e3;
    return s;
  }
  // reward late reviews a bit (you remembered it for longer than planned)
  const late = Math.max(0, (now - (s.due || now)) / DAY);
  const base = s.ivl + late / 2;
  let ivl = grade === 'hard' ? Math.max(s.ivl + 1, base * 1.2) : Math.max(s.ivl + 1, base * s.ease);
  if (grade === 'hard') s.ease = Math.max(1.3, s.ease - 0.15);
  ivl *= 0.95 + Math.random() * 0.1;                       // fuzz so cards don't clump
  s.ivl = Math.min(365, Math.round(ivl)); s.reps++;
  s.due = now + s.ivl * DAY;
  return s;
}

// Mark a card as already known (imported progress). First check-ups are spread evenly over
// 3..days days, so marking a big level as known doesn't dump hundreds of reviews on one day.
export function knownState(now = Date.now(), days = 7) {
  const ivl = Math.round(3 + Math.random() * Math.max(1, days - 3));
  return { ivl, ease: 2.5, reps: 1, lapses: 0, learn: null, due: now + ivl * DAY, last: now, imported: true };
}

export const isLearned = s => s && s.learn === null && s.ivl >= 1;
export const isMature = s => s && s.learn === null && s.ivl >= 21;
export { shuffle, pick, DAY, PERSONS, TENSES, VERBS };
