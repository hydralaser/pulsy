// Prints every text the app can speak, grouped into audio packs: {"A1": [...], ..., "verbs": [...]}
import { WORD_LEVELS } from '../words.js';
import { VERBS, TENSES, PERSONS } from '../data.js';
import { conjugate } from '../engine.js';
const packs = {};
for (const [lvl, words] of Object.entries(WORD_LEVELS)) packs[lvl] = words.map(w => w.split('|')[0]);
const verbs = new Set(['Ciao! Questa è una prova.']);
for (const v of VERBS) {
  const T = conjugate(v);
  verbs.add(v.inf);
  for (const t of TENSES) T[t.id].forEach((form, i) => {
    verbs.add(form);                                           // verb tables
    verbs.add((t.id === 'cong' ? 'che ' : '') + PERSONS[i].replace('lui/lei', 'lui') + ' ' + form);  // answers
  });
}
packs.verbs = [...verbs];
console.log(JSON.stringify(packs));
