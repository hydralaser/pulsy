// Confusable words and verb data. Word format: "italian|english|pos"
// pos: n = noun, v = verb, a = adjective, x = other. Glosses separated by " / " count as synonyms.

// The word bank lives in words.js (built by tools/build_bank.py).

// Real Italian words that are easily confused with deck words (doubled consonants,
// one-letter differences). Only ever used as wrong answers, never as cards.
export const CONFUSABLES = [
  'la pena|pain / sorrow|n', 'il carro|cart|n', 'il sonno|sleepiness|n', 'il papa|pope|n',
  'la pala|shovel|n', 'la palla|ball|n', 'la cassa|till / crate|n', 'il fato|fate|n', 'il fatto|fact|n',
  'la sete|thirst|n', 'i cappelli|hats|n', 'il cappello|hat|n', 'le note|notes|n', 'la nota|note|n',
  'la serra|greenhouse|n', 'l\'oro|gold|n', 'le pesche|peaches|n', 'la panna|cream|n', 'la sala|hall|n',
  'il canto|song / singing|n', 'il conte|count (nobleman)|n', 'il miele|honey|n', 'la nave|ship|n',
  'la corte|court|n', 'amaro|bitter|a', 'il banco|desk / counter|n', 'largo|wide|a', 'la pizza|pizza|n',
  'la vite|screw / vine|n', 'il tonno|tuna|n', 'il tono|tone|n', 'la ditta|company (firm)|n',
  'il camino|fireplace|n', 'il cammino|path|n', 'l\'ala|wing|n', 'la coppia|couple|n', 'la copia|copy|n',
  'il polo|pole|n', 'il pelo|fur|n', 'la casta|caste|n', 'la tana|den|n', 'la vena|vein|n',
  'la messa|mass (church)|n', 'il moto|motion|n', 'il mulo|mule|n', 'la mira|aim|n',
  'la colla|glue|n', 'il collo|neck|n', 'la cella|cell|n', 'il nodo|knot|n', 'il cono|cone|n',
  'il buco|hole|n', 'la mente|mind|n', 'il mento|chin|n', 'la tela|canvas|n', 'il tetto|roof|n',
  'il detto|saying|n', 'il pomo|knob|n', 'la rete|net|n', 'il seno|breast|n', 'la torre|tower|n',
  'la torta|cake|n', 'il torto|wrong (injustice)|n',
];

// ---------- Verbs & conjugation ----------
export const PERSONS = ['io', 'tu', 'lui/lei', 'noi', 'voi', 'loro'];
export const TENSES = [
  { id: 'pres', name: 'Presente', hint: 'present: I speak' },
  { id: 'pp', name: 'Passato prossimo', hint: 'perfect: I spoke / have spoken' },
  { id: 'imp', name: 'Imperfetto', hint: 'imperfect: I was speaking / used to' },
  { id: 'fut', name: 'Futuro semplice', hint: 'future: I will speak' },
  { id: 'cond', name: 'Condizionale', hint: 'conditional: I would speak' },
  { id: 'cong', name: 'Congiuntivo presente', hint: 'subjunctive: (that) I speak' },
];

// Irregular overrides. Anything not given is built by the regular rules.
// fut = future/conditional stem. aux 'e' = essere.
export const VERBS = [
  // tier 1: essential irregulars
  { inf: 'essere', en: 'to be', tier: 1, aux: 'e', pp: 'stato', fut: 'sar',
    pres: ['sono', 'sei', 'è', 'siamo', 'siete', 'sono'],
    imp: ['ero', 'eri', 'era', 'eravamo', 'eravate', 'erano'],
    cong: ['sia', 'sia', 'sia', 'siamo', 'siate', 'siano'] },
  { inf: 'avere', en: 'to have', tier: 1, pp: 'avuto', fut: 'avr',
    pres: ['ho', 'hai', 'ha', 'abbiamo', 'avete', 'hanno'],
    cong: ['abbia', 'abbia', 'abbia', 'abbiamo', 'abbiate', 'abbiano'] },
  { inf: 'fare', en: 'to do / make', tier: 1, pp: 'fatto', fut: 'far', impStem: 'facev',
    pres: ['faccio', 'fai', 'fa', 'facciamo', 'fate', 'fanno'],
    cong: ['faccia', 'faccia', 'faccia', 'facciamo', 'facciate', 'facciano'] },
  { inf: 'andare', en: 'to go', tier: 1, aux: 'e', fut: 'andr',
    pres: ['vado', 'vai', 'va', 'andiamo', 'andate', 'vanno'],
    cong: ['vada', 'vada', 'vada', 'andiamo', 'andiate', 'vadano'] },
  { inf: 'venire', en: 'to come', tier: 1, aux: 'e', pp: 'venuto', fut: 'verr',
    pres: ['vengo', 'vieni', 'viene', 'veniamo', 'venite', 'vengono'],
    cong: ['venga', 'venga', 'venga', 'veniamo', 'veniate', 'vengano'] },
  { inf: 'dire', en: 'to say', tier: 1, pp: 'detto', fut: 'dir', impStem: 'dicev',
    pres: ['dico', 'dici', 'dice', 'diciamo', 'dite', 'dicono'],
    cong: ['dica', 'dica', 'dica', 'diciamo', 'diciate', 'dicano'] },
  { inf: 'potere', en: 'can / be able', tier: 1, fut: 'potr',
    pres: ['posso', 'puoi', 'può', 'possiamo', 'potete', 'possono'],
    cong: ['possa', 'possa', 'possa', 'possiamo', 'possiate', 'possano'] },
  { inf: 'volere', en: 'to want', tier: 1, fut: 'vorr',
    pres: ['voglio', 'vuoi', 'vuole', 'vogliamo', 'volete', 'vogliono'],
    cong: ['voglia', 'voglia', 'voglia', 'vogliamo', 'vogliate', 'vogliano'] },
  { inf: 'dovere', en: 'must / have to', tier: 1, fut: 'dovr',
    pres: ['devo', 'devi', 'deve', 'dobbiamo', 'dovete', 'devono'],
    cong: ['debba', 'debba', 'debba', 'dobbiamo', 'dobbiate', 'debbano'] },
  { inf: 'sapere', en: 'to know', tier: 1, fut: 'sapr',
    pres: ['so', 'sai', 'sa', 'sappiamo', 'sapete', 'sanno'],
    cong: ['sappia', 'sappia', 'sappia', 'sappiamo', 'sappiate', 'sappiano'] },
  { inf: 'stare', en: 'to stay / be', tier: 1, aux: 'e',
    pres: ['sto', 'stai', 'sta', 'stiamo', 'state', 'stanno'], fut: 'star',
    cong: ['stia', 'stia', 'stia', 'stiamo', 'stiate', 'stiano'] },
  { inf: 'dare', en: 'to give', tier: 1, fut: 'dar',
    pres: ['do', 'dai', 'dà', 'diamo', 'date', 'danno'],
    cong: ['dia', 'dia', 'dia', 'diamo', 'diate', 'diano'] },
  // tier 2: regular patterns
  { inf: 'parlare', en: 'to speak', tier: 2 },
  { inf: 'mangiare', en: 'to eat', tier: 2 },
  { inf: 'lavorare', en: 'to work', tier: 2 },
  { inf: 'abitare', en: 'to live (reside)', tier: 2 },
  { inf: 'cercare', en: 'to look for', tier: 2 },
  { inf: 'pagare', en: 'to pay', tier: 2 },
  { inf: 'studiare', en: 'to study', tier: 2 },
  { inf: 'credere', en: 'to believe', tier: 2 },
  { inf: 'vendere', en: 'to sell', tier: 2 },
  { inf: 'dormire', en: 'to sleep', tier: 2 },
  { inf: 'partire', en: 'to leave', tier: 2, aux: 'e' },
  { inf: 'sentire', en: 'to hear / feel', tier: 2 },
  { inf: 'finire', en: 'to finish', tier: 2, isc: true },
  { inf: 'capire', en: 'to understand', tier: 2, isc: true },
  { inf: 'preferire', en: 'to prefer', tier: 2, isc: true },
  // tier 3: more irregulars
  { inf: 'vedere', en: 'to see', tier: 3, pp: 'visto', fut: 'vedr' },
  { inf: 'uscire', en: 'to go out', tier: 3, aux: 'e',
    pres: ['esco', 'esci', 'esce', 'usciamo', 'uscite', 'escono'],
    cong: ['esca', 'esca', 'esca', 'usciamo', 'usciate', 'escano'] },
  { inf: 'bere', en: 'to drink', tier: 3, pp: 'bevuto', fut: 'berr', impStem: 'bevev',
    pres: ['bevo', 'bevi', 'beve', 'beviamo', 'bevete', 'bevono'],
    cong: ['beva', 'beva', 'beva', 'beviamo', 'beviate', 'bevano'] },
  { inf: 'prendere', en: 'to take', tier: 3, pp: 'preso' },
  { inf: 'mettere', en: 'to put', tier: 3, pp: 'messo' },
  { inf: 'leggere', en: 'to read', tier: 3, pp: 'letto' },
  { inf: 'scrivere', en: 'to write', tier: 3, pp: 'scritto' },
  { inf: 'vivere', en: 'to live', tier: 3, pp: 'vissuto', fut: 'vivr' },
  { inf: 'chiudere', en: 'to close', tier: 3, pp: 'chiuso' },
  { inf: 'aprire', en: 'to open', tier: 3, pp: 'aperto' },
  { inf: 'conoscere', en: 'to know (people)', tier: 3, pp: 'conosciuto' },
  { inf: 'rimanere', en: 'to remain', tier: 3, aux: 'e', pp: 'rimasto', fut: 'rimarr',
    pres: ['rimango', 'rimani', 'rimane', 'rimaniamo', 'rimanete', 'rimangono'],
    cong: ['rimanga', 'rimanga', 'rimanga', 'rimaniamo', 'rimaniate', 'rimangano'] },
  { inf: 'tenere', en: 'to hold / keep', tier: 3, pp: 'tenuto', fut: 'terr',
    pres: ['tengo', 'tieni', 'tiene', 'teniamo', 'tenete', 'tengono'],
    cong: ['tenga', 'tenga', 'tenga', 'teniamo', 'teniate', 'tengano'] },
];

export const VERB_TIERS = { 1: 'Essential irregulars', 2: 'Regular patterns', 3: 'More irregulars' };
