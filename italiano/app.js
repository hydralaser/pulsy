import { LEVELS, oldNorm, similarity, buildDeck, wordOptions, conjOptions, nearCountFor, schedule, knownState, isLearned, isMature, norm, shuffle, DAY, PERSONS, TENSES, VERBS, conjugate } from './engine.js';
import { VERB_TIERS } from './data.js';

// ---------------- persistence ----------------
const KEY = 'ripasso-v1';
const defaults = () => ({
  v: 1, cards: {}, log: {}, custom: [],
  settings: { newPerDay: 10, direction: 'mixed', listen: true, autoplay: true, scope: 'all' },
  enabled: { 'A1-1': true, pres1: true },
});
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw), def = defaults(); return { ...def, ...d, settings: { ...def.settings, ...d.settings } }; }
  } catch (e) { /* storage unavailable */ }
  return defaults();
}
let S = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };
let deck = buildDeck(S.custom);
const rebuildDeck = () => { deck = buildDeck(S.custom); };

// One-off upgrade from the first version: themed sets became CEFR levels, and word ids were
// built with a buggy article stripper. Move saved progress onto the new ids.
(function migrate() {
  if ((S.v || 1) >= 2) return;
  for (const w of deck.allWords) {
    const old = 'w:' + oldNorm(w.it);
    if (old !== w.id && S.cards[old] && !S.cards[w.id]) { S.cards[w.id] = S.cards[old]; delete S.cards[old]; }
  }
  if (!deck.sets.some(x => x.kind === 'word' && S.enabled[x.id])) S.enabled['A1-1'] = true;
  S.v = 2; save();
})();

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const today = () => (S.log[dayKey()] ||= { n: 0, r: 0, c: 0, bonus: 0 });
const newLeft = () => { const t = today(); return Math.max(0, S.settings.newPerDay + (t.bonus || 0) - t.n); };
function streak() {
  let n = 0, t = Date.now();
  if (!S.log[dayKey(t)]?.r) t -= DAY;           // today not done yet doesn't break the streak
  while (S.log[dayKey(t)]?.r) { n++; t -= DAY; }
  return n;
}

// ---------------- speech ----------------
let itVoice = null;
// ok: null = untested, true = an utterance actually started, false = it failed (error says why)
const speech = { ok: null, error: '', voices: 0 };
const hasTTS = 'speechSynthesis' in window;
function loadVoices() {
  if (!hasTTS) return;
  const vs = speechSynthesis.getVoices();
  speech.voices = vs.length;
  itVoice = vs.find(v => /^it[-_]IT/i.test(v.lang) && /natural|enhanced|premium|google/i.test(v.name)) || vs.find(v => /^it/i.test(v.lang)) || null;
}
if (hasTTS) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function ttsSpeak(text) {
  if (!hasTTS || !text) return;
  try {
    const synth = speechSynthesis;
    const go = () => {
      const u = new SpeechSynthesisUtterance(text.replace('/', ' '));
      u.lang = 'it-IT'; if (itVoice) u.voice = itVoice; u.rate = 0.9; u.volume = 1;
      u.onstart = () => { speech.ok = true; };
      u.onerror = e => { if (!/interrupted|canceled/.test(e.error)) { speech.ok = false; speech.error = e.error || 'unknown'; } };
      synth.speak(u);
      synth.resume();                       // Chrome can leave the queue paused
    };
    // cancelling and speaking in the same tick drops the new utterance in some browsers
    if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(go, 80); } else go();
  } catch (e) { speech.ok = false; speech.error = String(e.message || e); }
}
// ---------------- recorded clips (offline audio) ----------------
// audio/index.json maps text -> [pack, offset, length]; each pack is a run of standalone MP3s.
// Played through one <audio> element: unlike Web Audio it isn't muted by the iPhone silent switch.
const clips = { index: null, packs: {}, loading: {}, el: null, failed: false, url: null };
try { navigator.audioSession && (navigator.audioSession.type = 'playback'); } catch (e) { /* ignore */ }
fetch('audio/index.json').then(r => r.ok ? r.json() : Promise.reject()).then(ix => { clips.index = ix; preloadPacks(); })
  .catch(() => { clips.failed = true; });
function loadPack(i) {
  if (clips.packs[i] || clips.loading[i]) return clips.loading[i];
  return (clips.loading[i] = fetch('audio/' + clips.index.packs[i]).then(r => r.ok ? r.arrayBuffer() : Promise.reject())
    .then(buf => { clips.packs[i] = buf; return buf; }).catch(() => { delete clips.loading[i]; }));
}
// load the packs you're likely to need now: verbs and any level with parts switched on or cards started
function preloadPacks() {
  const ix = clips.index; if (!ix) return;
  const want = new Set(['verbs.mp3']);
  for (const s of deck.sets) if (s.level && (S.enabled[s.id] || s.cards.some(id => S.cards[id]))) want.add(s.level + '.mp3');
  ix.packs.forEach((n, i) => { if (want.has(n)) loadPack(i); });
}
function playClip(text) {
  const e = clips.index?.t[text];
  if (!e) return false;
  const buf = clips.packs[e[0]];
  if (!buf) { loadPack(e[0])?.then(() => playClip(text)); return true; }   // first use of this level: play once it arrives
  const el = clips.el ||= new Audio();
  if (clips.url) URL.revokeObjectURL(clips.url);
  clips.url = URL.createObjectURL(new Blob([buf.slice(e[1], e[1] + e[2])], { type: 'audio/mpeg' }));
  el.src = clips.url;
  el.play().then(() => { speech.ok = true; speech.clip = true; }).catch(err => { speech.ok = false; speech.error = err.name; });
  return true;
}
function speak(text) {
  if (!text) return;
  if (!playClip(text)) ttsSpeak(text);      // custom words have no recording: fall back to the device voice
}
async function downloadAllAudio(progress) {
  if (!clips.index) return false;
  let done = 0;
  await Promise.all(clips.index.packs.map((_, i) => loadPack(i).then(() => progress(++done, clips.index.packs.length))));
  return Object.keys(clips.packs).length === clips.index.packs.length;
}

function soundStatus() {
  if (clips.index) {
    if (speech.ok === false && speech.clip !== true) return { level: 'bad', text: `Playback was blocked (${speech.error}). Turn the volume up and tap Play test again.` };
    const n = Object.keys(clips.packs).length, total = clips.index.packs.length;
    return { level: 'ok', text: `Recorded voice for ${Object.keys(clips.index.t).length.toLocaleString()} words and verb forms (Piper "Serena"). ${n === total ? 'All audio is downloaded.' : `${n} of ${total} audio packs loaded; the rest load when you need them.`}` };
  }
  if (!hasTTS) return { level: 'bad', text: 'This browser can\'t speak. If you opened the link inside the Claude app (or another app), open it in Safari or Chrome instead.' };
  if (speech.ok === false) return { level: 'bad', text: `Speech failed (${speech.error}). Check your volume, and on iPhone make sure the silent switch is off.` };
  if (speech.voices && !itVoice) return { level: 'warn', text: 'No Italian voice is installed, so words may be read with an English accent or not at all. iPhone: Settings → Accessibility → Spoken Content → Voices → Italian. Android: Settings → Text-to-speech → install Italian.' };
  if (itVoice) return { level: 'ok', text: `Using ${itVoice.name}. If you hear nothing, turn the volume up, and on iPhone make sure the silent switch is off.` };
  return { level: 'warn', text: 'Tap "Play test" to check sound.' };
}
const buzz = p => { try { navigator.vibrate?.(p); } catch (e) { /* ignore */ } };

// ---------------- helpers ----------------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $app = document.getElementById('app');
const inScope = (card, scope) => scope.set ? card.set === scope.set : scope.kind === 'all' || (scope.kind === 'words') === (card.kind === 'word');
const setOf = id => deck.sets.find(s => s.id === id);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// mark the letters of `a` that are not shared with `b` (shows the doubled consonant etc.)
// only when the two look alike; otherwise highlighting is just noise
function diffMark(a, b) {
  if (similarity(a, b) < 0.5) return esc(a);
  const m = a.length, n = b.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let out = '', i = 0, j = 0;
  while (i < m) {
    if (j < n && a[i] === b[j]) { out += esc(a[i]); i++; j++; }
    else if (j < n && L[i][j + 1] > L[i + 1][j]) j++;
    else { out += `<mark>${esc(a[i])}</mark>`; i++; }
  }
  return out;
}

// ~25 check-ups a day at most, however many words get marked
function markKnown(ids) {
  const todo = ids.filter(id => !isLearned(S.cards[id]));
  const days = Math.min(90, Math.max(7, Math.round(todo.length / 25)));
  for (const id of todo) S.cards[id] = knownState(Date.now(), days);
  return todo.length;
}

function setStats(set) {
  let seen = 0, learned = 0, mature = 0;
  for (const id of set.cards) { const s = S.cards[id]; if (s) { seen++; if (isLearned(s)) learned++; if (isMature(s)) mature++; } }
  return { total: set.cards.length, seen, learned, mature };
}
function counts(scope = { kind: S.settings.scope }) {
  const now = Date.now();
  let due = 0;
  for (const [id, s] of Object.entries(S.cards)) { const c = deck.cards.get(id); if (c && inScope(c, scope) && (s.due <= now || s.learn !== null)) due++; }
  return { due, fresh: Math.min(newLeft(), newPool(scope, 999).length) };
}
function newPool(scope, limit) {
  const sets = deck.sets.filter(s => scope.set ? s.id === scope.set : S.enabled[s.id] && inScope({ kind: s.kind, set: s.id }, scope));
  const words = [], conj = [];
  for (const s of sets) {
    const fresh = s.cards.filter(id => !S.cards[id]);
    (s.kind === 'word' ? words : conj).push(...(s.kind === 'conj' ? shuffle(fresh) : fresh));
  }
  const out = [];
  while ((words.length || conj.length) && out.length < limit) {
    if (words.length) out.push(words.shift());
    if (conj.length && out.length < limit) out.push(conj.shift());
  }
  return out;
}

// ---------------- views ----------------
let view = { name: 'home' };
let sess = null;
let advanceTimer = null;
const go = (v) => { clearTimeout(advanceTimer); view = typeof v === 'string' ? { name: v } : v; render(); window.scrollTo(0, 0); };

const ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z"/>',
  words: '<path d="M5 4h10l4 4v12H5z M14 4v5h5"/><path d="M8 13h8M8 16.5h6"/>',
  verbs: '<path d="M4 6h16M4 12h10M4 18h13"/><circle cx="19" cy="12" r="1.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

function nav() {
  const tab = (id, label) => `<button class="tab ${view.name === id || (view.parent === id) ? 'on' : ''}" data-a="go" data-v="${id}">${icon(id)}<span>${label}</span></button>`;
  return `<nav class="tabs">${tab('home', 'Today')}${tab('words', 'Words')}${tab('verbs', 'Verbs')}${tab('settings', 'Settings')}</nav>`;
}

function render() {
  const v = view.name;
  document.body.dataset.view = v;
  if (v === 'study') return renderStudy();
  const body = { home: homeView, words: wordsView, verbs: verbsView, settings: settingsView, set: setView, verb: verbView, done: doneView }[v]();
  $app.innerHTML = `<main class="page">${body}</main>${v === 'done' ? '' : nav()}`;
}

function homeView() {
  const scope = { kind: S.settings.scope };
  const { due, fresh } = counts(scope);
  const t = today();
  const acc = t.r ? Math.round(100 * t.c / t.r) : null;
  // 7-day forecast of reviews
  const now = Date.now(), days = Array(7).fill(0);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (const [id, s] of Object.entries(S.cards)) {
    const c = deck.cards.get(id); if (!c || !inScope(c, scope) || s.learn !== null) continue;
    const d = Math.floor((Math.max(s.due, now) - start) / DAY); if (d >= 0 && d < 7) days[d]++;
  }
  const max = Math.max(1, ...days);
  const dn = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const bars = days.map((n, i) => `<div class="fc"><div class="fcb" style="height:${Math.max(n ? 6 : 2, Math.round(56 * n / max))}px"></div><small>${n || ''}</small><span>${i ? dn[(start.getDay() + i) % 7] : 'Today'}</span></div>`).join('');
  const learnedWords = deck.allWords.filter(w => isLearned(S.cards[w.id])).length;
  const learnedConj = [...deck.cards.values()].filter(c => c.kind === 'conj' && isLearned(S.cards[c.id])).length;
  const seg = (k, l) => `<button class="seg ${S.settings.scope === k ? 'on' : ''}" data-a="scope" data-v="${k}">${l}</button>`;
  const enabledNames = deck.sets.filter(s => S.enabled[s.id] && inScope({ kind: s.kind, set: s.id }, scope)).map(s => s.name);
  return `
    <header class="masthead">
      <div><h1>Ripasso</h1><p class="sub">Italian, a little every day</p></div>
      <div class="streak" title="Days in a row"><b>${streak()}</b><span>day streak</span></div>
    </header>
    <section class="hero">
      <div class="segs">${seg('all', 'Everything')}${seg('words', 'Words')}${seg('verbs', 'Verbs')}</div>
      <div class="bignums">
        <div><b>${due}</b><span>to review</span></div>
        <div><b>${fresh}</b><span>new today</span></div>
        <div><b>${acc === null ? '–' : acc + '%'}</b><span>today's accuracy</span></div>
      </div>
      <button class="primary" data-a="start" ${due + fresh ? '' : 'disabled'}>${due + fresh ? (due ? 'Start review' : 'Learn new words') : 'All done for now'}</button>
      ${!due && !fresh ? `<button class="ghost" data-a="more">Learn 5 more new cards</button>` : ''}
      <p class="fine">New cards come from: ${enabledNames.length ? esc(enabledNames.slice(0, 3).join(', ')) + (enabledNames.length > 3 ? ` and ${enabledNames.length - 3} more` : '') : 'no sets switched on — pick some under Words or Verbs'}</p>
    </section>
    <section class="block">
      <h2>Coming up</h2>
      ${days.some(Boolean) ? `<div class="forecast">${bars}</div>` : '<p class="fine">Reviews for the next week show here once you\'ve learned some cards.</p>'}
    </section>
    ${!clips.index && (soundStatus().level === 'bad' || (speech.voices && !itVoice)) ? `<button class="notice" data-a="go" data-v="settings">${esc(soundStatus().text)} <b>Sound settings</b></button>` : ''}
    <section class="block stats2">
      <div><b>${learnedWords}</b><span>words learned of ${deck.allWords.length}</span></div>
      <div><b>${learnedConj}</b><span>verb forms learned</span></div>
    </section>`;
}

function setRow(s) {
  const st = setStats(s);
  const pL = 100 * st.learned / st.total, pM = 100 * st.mature / st.total;
  return `<div class="setrow">
    <button class="setmain" data-a="openset" data-v="${s.id}">
      <span class="setname">${esc(s.kind === 'conj' ? VERB_TIERS[s.tier] : s.level ? `Part ${s.part}` : s.name)}${s.level ? ` <small>${esc(s.cards.slice(0, 3).map(id => deck.cards.get(id).it).join(', '))}…</small>` : ''}</span>
      <span class="bar"><i class="l" style="width:${pL}%"></i><i class="m" style="width:${pM}%"></i></span>
      <span class="setmeta">${st.learned}/${st.total} learned${st.mature ? ` · ${st.mature} solid` : ''}</span>
    </button>
    <label class="switch" title="Include in new cards"><input type="checkbox" id="en-${s.id}" data-a="toggle" data-v="${s.id}" ${S.enabled[s.id] ? 'checked' : ''}><span></span></label>
  </div>`;
}

function levelStats(lvl) {
  let total = 0, learned = 0;
  for (const s of deck.sets) if (s.level === lvl) { const st = setStats(s); total += st.total; learned += st.learned; }
  return { total, learned };
}
function wordsView() {
  const levels = LEVELS.map(lvl => {
    const sets = deck.sets.filter(s => s.level === lvl), st = levelStats(lvl);
    const pct = Math.round(100 * st.learned / st.total);
    return `<section class="tense level">
      <div class="levelhead"><h2>${lvl} <small>${st.total} words · ${st.learned} learned (${pct}%)</small></h2>
        <button class="chip" data-a="confirm" data-do="marklevel" data-v="${lvl}" data-label="Mark ${lvl} as known">Mark ${lvl} as known</button></div>
      <div class="sets">${sets.map(setRow).join('')}</div></section>`;
  }).join('');
  const custom = deck.sets.filter(s => s.custom);
  return `<header class="pagehead"><h1>Words</h1><p class="sub">${deck.allWords.length.toLocaleString()} words in six levels, most common first. Switch on the parts you want new words from.</p></header>
    <div class="legend"><span><i class="l"></i>learned</span><span><i class="m"></i>solid (3+ weeks)</span></div>
    <p class="fine">Coming from Linguno? Mark the levels you've finished as known. Those words come back for a quick check spread over the next few weeks, and any you miss go back into learning.</p>
    ${custom.length ? `<section class="tense"><h2>My words</h2><div class="sets">${custom.map(setRow).join('')}</div></section>` : ''}
    ${levels}
    ${!S.custom.length ? `<p class="fine">Add your own words in Settings and they get their own set here.</p>` : ''}`;
}

function verbsView() {
  const groups = TENSES.map(t => {
    const sets = deck.sets.filter(s => s.kind === 'conj' && s.tense === t.id);
    return `<section class="tense"><h2>${t.name} <small>${esc(t.hint)}</small></h2><div class="sets">${sets.map(setRow).join('')}</div></section>`;
  }).join('');
  const verbs = VERBS.map(v => `<button class="chip" data-a="openverb" data-v="${v.inf}">${v.inf}</button>`).join('');
  return `<header class="pagehead"><h1>Verbs</h1><p class="sub">Each card is one verb, one tense, one person. Passato prossimo uses masculine forms (siamo andati).</p></header>
    ${groups}
    <section class="block"><h2>Verb tables</h2><div class="chips">${verbs}</div></section>`;
}

function setView() {
  const s = setOf(view.id); if (!s) return go('home');
  const st = setStats(s);
  let list;
  if (s.kind === 'word') {
    list = s.cards.map(id => {
      const c = deck.cards.get(id), state = S.cards[id];
      const tag = !state ? '<em class="tag new">new</em>' : state.learn !== null ? '<em class="tag lrn">learning</em>' : `<em class="tag ${isMature(state) ? 'mat' : 'ok'}">${state.ivl}d</em>`;
      return `<li><button data-a="say" data-v="${esc(c.it)}"><span class="it">${esc(c.it)}</span><span class="en">${esc(c.en)}</span>${tag}</button></li>`;
    }).join('');
  } else {
    const byVerb = {};
    for (const id of s.cards) { const c = deck.cards.get(id); (byVerb[c.verb.inf] ||= []).push(c); }
    list = Object.entries(byVerb).map(([inf, cs]) => {
      const done = cs.filter(c => isLearned(S.cards[c.id])).length;
      return `<li><button data-a="openverb" data-v="${inf}"><span class="it">${inf}</span><span class="en">${esc(cs[0].verb.en)}</span><em class="tag ${done === 6 ? 'mat' : done ? 'ok' : 'new'}">${done}/6</em></button></li>`;
    }).join('');
  }
  return `<header class="pagehead withback"><button class="iconbtn" data-a="go" data-v="${s.kind === 'word' ? 'words' : 'verbs'}" aria-label="Back">${icon('back')}</button>
      <div><h1>${esc(s.name)}</h1><p class="sub">${st.learned} of ${st.total} learned · ${st.total - st.seen} not started</p></div></header>
    <div class="actions">
      <button class="primary" data-a="studyset" data-v="${s.id}">Study this set</button>
      <button class="ghost" data-a="confirm" data-do="markset" data-v="${s.id}" data-label="Mark all as known">Mark all as known</button>
    </div>
    <p class="fine">Already know these from Linguno or elsewhere? Mark them as known. They come back for a quick check over the next week or so, and anything you miss goes back into learning.</p>
    <ul class="wordlist">${list}</ul>
    ${s.custom || st.seen ? `<div class="actions"><button class="danger" data-a="confirm" data-do="resetset" data-v="${s.id}" data-label="Reset progress for this set">Reset progress for this set</button></div>` : ''}`;
}

function tenseTable(v, t, hiPerson) {
  const T = conjugate(v);
  return `<table class="mini intro">${PERSONS.map((p, i) => `<tr class="${i === hiPerson ? 'cur' : ''}"><th>${t.id === 'cong' ? 'che ' + p : p}</th><td><button data-a="say" data-v="${esc(T[t.id][i])}">${esc(T[t.id][i])}</button></td></tr>`).join('')}</table>`;
}

function conjTable(v, hiTense, hiPerson) {
  const T = conjugate(v);
  return TENSES.map(t => `<div class="ctab ${hiTense === t.id ? 'hi' : ''}"><h3>${t.name}</h3><table>${PERSONS.map((p, i) => `<tr class="${hiTense === t.id && hiPerson === i ? 'cur' : ''}"><th>${t.id === 'cong' ? 'che ' + p : p}</th><td><button data-a="say" data-v="${esc(T[t.id][i])}">${esc(T[t.id][i])}</button></td></tr>`).join('')}</table></div>`).join('');
}

function verbView() {
  const v = VERBS.find(x => x.inf === view.id);
  const T = conjugate(v);
  return `<header class="pagehead withback"><button class="iconbtn" data-a="go" data-v="verbs" aria-label="Back">${icon('back')}</button>
    <div><h1>${v.inf}</h1><p class="sub">${esc(v.en)} · past participle <b>${T.pastPart}</b> · takes <b>${T.aux === 'e' ? 'essere' : 'avere'}</b></p></div></header>
    <div class="ctabs">${conjTable(v)}</div>`;
}

function settingsView() {
  const st = S.settings;
  const radio = (k, val, label) => `<button class="seg ${st[k] === val ? 'on' : ''}" data-a="set" data-k="${k}" data-v="${val}">${label}</button>`;
  const tog = (k, label, hint) => `<label class="trow"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><span class="switch"><input type="checkbox" id="s-${k}" data-a="settog" data-k="${k}" ${st[k] ? 'checked' : ''}><span></span></span></label>`;
  return `<header class="pagehead"><h1>Settings</h1></header>
    <section class="block">
      <h2>Daily new cards</h2>
      <div class="stepper"><button data-a="step" data-v="-5" aria-label="Fewer">−</button><b>${st.newPerDay}</b><button data-a="step" data-v="5" aria-label="More">+</button></div>
      <p class="fine">Each new card comes back a few times as you learn it, so 10 new cards is about 40 questions on day one.</p>
    </section>
    <section class="block">
      <h2>Question direction</h2>
      <div class="segs">${radio('direction', 'mixed', 'Mixed')}${radio('direction', 'it-en', 'Italian → English')}${radio('direction', 'en-it', 'English → Italian')}</div>
      ${tog('listen', 'Listening questions', clips.index || hasTTS ? (clips.index || itVoice ? 'Hear a word, pick the spelling. Part of Mixed.' : 'No Italian voice found on this device, so these are skipped.') : 'Your browser has no speech, so these are skipped.')}
      ${tog('autoplay', 'Read words aloud', 'Uses your device\'s Italian voice')}
    </section>
    <section class="block">
      <h2>Sound</h2>
      <p class="sound ${soundStatus().level}" id="soundStatus">${esc(soundStatus().text)}</p>
      <button class="ghost" data-a="soundtest">Play test</button>
      ${clips.index ? `<button class="ghost" data-a="dlaudio">Download all audio (${(clips.index.bytes / 1e6 || 0).toFixed(0)} MB)</button>
      <p class="fine">${window.RIPASSO_SW ? 'Once downloaded, the app and all audio work with no connection.' : 'This copy runs inside claude.ai and needs a connection to open. For fully offline use, install the hosted version (see the README).'}</p>` : ''}
    </section>
    <section class="block">
      <h2>Bring over words you know</h2>
      <p class="fine">Paste words you already know, one per line or separated by commas (for example a list from Linguno). Articles are optional. Matching words skip the learning stage and are scheduled for a check-up.</p>
      <textarea id="importKnown" rows="5" placeholder="casa&#10;il libro&#10;mangiare, bere, dormire"></textarea>
      <button class="ghost" data-a="importknown">Mark as known</button>
      <p class="result" id="importResult"></p>
    </section>
    <section class="block">
      <h2>Add your own words</h2>
      <p class="fine">One per line as <b>italiano = english</b>. They go in a set called "My words".</p>
      <textarea id="customWords" rows="5" placeholder="la tazza = cup&#10;il cucchiaio = spoon"></textarea>
      <button class="ghost" data-a="addcustom">Add words</button>
      <p class="result" id="customResult">${S.custom.length ? `${plural(S.custom.length, 'word')} added so far.` : ''}</p>
    </section>
    <section class="block">
      <h2>Backup</h2>
      <p class="fine">Progress is saved in this browser only. Copy a backup to move it to another device, then paste it there.</p>
      <div class="actions"><button class="ghost" data-a="export">Copy backup</button><button class="ghost" data-a="import">Restore from pasted backup</button></div>
      <textarea id="backup" rows="3" placeholder="Paste a backup here to restore it"></textarea>
      <p class="result" id="backupResult"></p>
    </section>
    <section class="block"><button class="danger" data-a="confirm" data-do="resetall" data-label="Erase all progress">Erase all progress</button></section>`;
}

function doneView() {
  const s = sess || { answered: 0, correct: 0 };
  const acc = s.answered ? Math.round(100 * s.correct / s.answered) : 0;
  const { due, fresh } = counts();
  const next = Object.values(S.cards).filter(x => x.due > Date.now()).sort((a, b) => a.due - b.due)[0];
  const when = next ? (() => { const m = (next.due - Date.now()) / 60e3; return m < 60 ? `${Math.ceil(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; })() : null;
  return `<section class="done">
    <p class="eyebrow">Session finished</p>
    <h1>${acc >= 90 ? 'Bravissimo!' : acc >= 70 ? 'Ben fatto!' : 'Avanti così!'}</h1>
    <div class="bignums">
      <div><b>${s.answered}</b><span>answers</span></div>
      <div><b>${acc}%</b><span>correct</span></div>
      <div><b>${s.newSeen || 0}</b><span>new cards</span></div>
    </div>
    ${when ? `<p class="fine">Next card is due in ${when}.</p>` : ''}
    <div class="actions">
      ${due + fresh ? `<button class="primary" data-a="start">Keep going (${due + fresh})</button>` : `<button class="primary" data-a="more">Learn 5 more</button>`}
      <button class="ghost" data-a="go" data-v="home">Back to today</button>
    </div></section>`;
}

// ---------------- study session ----------------
function startSession(scope) {
  const now = Date.now();
  const reviews = Object.entries(S.cards)
    .filter(([id, s]) => { const c = deck.cards.get(id); return c && inScope(c, scope) && (s.due <= now || s.learn !== null); })
    .sort((a, b) => a[1].due - b[1].due).map(([id]) => id).slice(0, 150);
  const limit = scope.set ? Math.max(newLeft(), 10) : newLeft();
  const fresh = newPool(scope, limit);
  const queue = [];
  while (reviews.length || fresh.length) {
    queue.push(...reviews.splice(0, 3));
    if (fresh.length) queue.push(fresh.shift());
  }
  if (!queue.length) return go('home');
  sess = { queue, i: 0, answered: 0, correct: 0, newSeen: 0, introduced: new Set(), seenTense: new Set(), scope };
  view = { name: 'study' };
  present();
}

function pickMode(card, state) {
  if (card.kind === 'conj') return 'conj';
  const dir = S.settings.direction;
  if (dir !== 'mixed') return dir;
  if (!state || (state.learn === 0 && !state.reps && !state.lapses)) return 'it-en';
  if (state.learn === 1) return 'en-it';
  const r = Math.random();
  if (S.settings.listen && (clips.index || itVoice) && r < 0.2) return 'listen';
  return r < 0.6 ? 'it-en' : 'en-it';
}

function present() {
  clearTimeout(advanceTimer);
  if (sess.i >= sess.queue.length) { view = { name: 'done' }; return render(); }
  const id = sess.queue[sess.i];
  const card = deck.cards.get(id);
  const state = S.cards[id];
  const tenseKey = card.kind === 'conj' && `${card.verb.inf}:${card.tense.id}`;
  const isNew = !state;
  const needsIntro = isNew && !sess.introduced.has(id) &&
    (card.kind === 'word' || !(sess.seenTense.has(tenseKey) || Object.keys(S.cards).some(k => k.startsWith(`c:${tenseKey}:`))));
  if (tenseKey) sess.seenTense.add(tenseKey);
  if (needsIntro) { sess.cur = { id, card, intro: true }; renderStudy(); if (card.kind === 'word' && S.settings.autoplay) speak(card.it); return; }
  const mode = pickMode(card, state);
  const nearN = nearCountFor(state);
  const options = card.kind === 'conj' ? conjOptions(card, nearN) : wordOptions(deck, card, mode, nearN);
  sess.cur = { id, card, mode, options, t0: performance.now(), answered: false };
  sess.shownAt = performance.now();
  renderStudy();
  if (S.settings.autoplay && (mode === 'it-en' || mode === 'listen')) speak(card.it);
}

function promptHTML(c) {
  const { card, mode } = c;
  if (card.kind === 'conj') {
    const p = PERSONS[card.person];
    return `<p class="eyebrow">${card.tense.name}</p>
      <p class="verbline"><b>${card.verb.inf}</b> · ${esc(card.verb.en)}</p>
      <p class="prompt it">${card.tense.id === 'cong' ? 'che ' : ''}${p} <span class="blank">${c.answered ? (c.chosen.correct ? esc(card.answer) : diffMark(card.answer, c.chosen.text)) : '…'}</span></p>`;
  }
  if (mode === 'listen') return `<p class="eyebrow">Which word did you hear?</p>
      <button class="bigspeak" data-a="say" data-v="${esc(card.it)}" aria-label="Play again">${icon('speaker')}</button>
      ${c.answered ? `<p class="prompt it">${esc(card.it)}</p>` : '<p class="fine">Tap to hear it again</p>'}`;
  if (mode === 'it-en') return `<p class="eyebrow">What does it mean?</p>
      <p class="prompt it">${esc(card.it)} <button class="iconbtn inline" data-a="say" data-v="${esc(card.it)}" aria-label="Hear it">${icon('speaker')}</button></p>`;
  return `<p class="eyebrow">How do you say</p><p class="prompt en">${esc(card.en)}</p>`;
}

function feedbackHTML(c) {
  const { card, chosen } = c;
  const ok = chosen.correct;
  if (card.kind === 'conj') {
    const T = conjugate(card.verb), t = card.tense.id;
    const why = ok ? '' : `<p class="why">You picked <b class="it">${diffMark(chosen.text, card.answer)}</b>${chosen.why ? ` (${esc(chosen.why)})` : ''}</p>`;
    const table = ok ? '' : `<div class="minigrid">${[0, 1, 2, 3, 4, 5].map(i => `<span class="${i === card.person ? 'cur' : ''}"><small>${PERSONS[i]}</small> ${esc(T[t][i])}</span>`).join('')}</div>`;
    return `<div class="fb ${ok ? 'good' : 'bad'}"><p class="verdict">${ok ? 'Giusto' : 'Not quite'}</p>${why}${table}</div>`;
  }
  const other = chosen.item;
  const why = ok ? '' : `<p class="why"><b class="it">${diffMark(other.it, card.it)}</b> means “${esc(other.en)}”</p>`;
  return `<div class="fb ${ok ? 'good' : 'bad'}"><p class="verdict">${ok ? 'Giusto' : 'Not quite'}</p>
    <p class="answer"><b class="it">${ok ? esc(card.it) : diffMark(card.it, other.it)}</b> <span>${esc(card.en)}</span>
    <button class="iconbtn inline" data-a="say" data-v="${esc(card.it)}" aria-label="Hear it">${icon('speaker')}</button></p>${why}</div>`;
}

function renderStudy() {
  document.body.dataset.view = 'study';
  const c = sess.cur, total = sess.queue.length;
  const pct = Math.round(100 * sess.i / total);
  const top = `<div class="studytop"><button class="iconbtn" data-a="quit" aria-label="End session">${icon('close')}</button>
    <div class="progress"><i style="width:${pct}%"></i></div><span class="count">${total - sess.i}</span></div>`;
  let main, bottom;
  if (c.intro) {
    const card = c.card;
    if (card.kind === 'word') {
      main = `<p class="eyebrow">New word</p><p class="prompt it">${esc(card.it)} <button class="iconbtn inline" data-a="say" data-v="${esc(card.it)}" aria-label="Hear it">${icon('speaker')}</button></p><p class="gloss">${esc(card.en)}</p>`;
    } else {
      main = `<p class="eyebrow">New: ${card.tense.name}</p><p class="verbline"><b>${card.verb.inf}</b> · ${esc(card.verb.en)}</p>
        ${tenseTable(card.verb, card.tense, card.person)}`;
    }
    bottom = `<button class="primary" data-a="gotit">Got it</button>`;
  } else {
    main = promptHTML(c);
    const opts = c.options.map((o, k) => {
      let cls = 'opt';
      if (c.answered) cls += o.correct ? ' right' : o === c.chosen ? ' wrong' : ' dim';
      const isIt = c.card.kind === 'conj' || c.mode !== 'it-en';
      return `<button class="${cls}${isIt ? ' it' : ''}" data-a="answer" data-v="${k}" ${c.answered ? 'tabindex="-1"' : ''}><kbd>${k + 1}</kbd><span>${esc(o.text)}</span></button>`;
    }).join('');
    if (c.answered) main += feedbackHTML(c);
    // Continue always has its own slot below the answers (hidden until you answer), so nothing shifts under your thumb
    bottom = `<div class="opts">${opts}</div>
      <button class="primary next" data-a="next" ${c.answered ? '' : 'disabled aria-hidden="true" tabindex="-1"'}>Continue</button>`;
  }
  $app.innerHTML = `<main class="study ${c.answered ? 'answered' : ''}">${top}<div class="stage">${main}</div><div class="dock">${bottom}</div></main>`;
}

function answer(k) {
  const c = sess.cur;
  if (!c || c.intro || c.answered) return;
  // ignore taps that land in the first moment after a new question appears (a tap meant for the previous screen)
  if (performance.now() - sess.shownAt < 450) return;
  const chosen = c.options[k]; if (!chosen) return;
  c.answered = true; c.chosen = chosen;
  const secs = (performance.now() - c.t0) / 1000;
  const slow = c.card.kind === 'conj' ? 9 : c.mode === 'listen' ? 8 : 6;
  const grade = !chosen.correct ? 'again' : secs > slow ? 'hard' : 'good';
  const prev = S.cards[c.id];
  const t = today();
  if (!prev) { t.n++; sess.newSeen++; }
  const next = schedule(prev, grade);
  S.cards[c.id] = next;
  t.r++; if (chosen.correct) t.c++;
  sess.answered++; if (chosen.correct) sess.correct++;
  if (next.learn !== null) {
    const gap = chosen.correct ? 6 : 3;
    sess.queue.splice(Math.min(sess.queue.length, sess.i + 1 + gap), 0, c.id);
  }
  save();
  buzz(chosen.correct ? 12 : [40, 50, 40]);
  renderStudy();
  if (S.settings.autoplay && c.card.kind === 'word' && c.mode !== 'listen' && c.mode !== 'it-en') speak(c.card.it);
  if (S.settings.autoplay && c.card.kind === 'conj') speak((c.card.tense.id === 'cong' ? 'che ' : '') + PERSONS[c.card.person].replace('lui/lei', 'lui') + ' ' + c.card.answer);
}
function advance() { clearTimeout(advanceTimer); if (!sess?.cur?.answered) return; sess.i++; present(); }

// ---------------- actions ----------------
let confirmTimer = null;
const actions = {
  go: el => go(el.dataset.v),
  scope: el => { S.settings.scope = el.dataset.v; save(); render(); },
  start: () => startSession({ kind: S.settings.scope }),
  more: () => { today().bonus = (today().bonus || 0) + 5; save(); startSession({ kind: S.settings.scope }); },
  studyset: el => startSession({ set: el.dataset.v }),
  openset: el => go({ name: 'set', id: el.dataset.v, parent: setOf(el.dataset.v).kind === 'word' ? 'words' : 'verbs' }),
  openverb: el => go({ name: 'verb', id: el.dataset.v, parent: 'verbs' }),
  toggle: el => { S.enabled[el.dataset.v] = el.checked; save(); },
  settog: el => { S.settings[el.dataset.k] = el.checked; save(); },
  set: el => { S.settings[el.dataset.k] = el.dataset.v; save(); render(); },
  step: el => { S.settings.newPerDay = Math.max(0, Math.min(50, S.settings.newPerDay + +el.dataset.v)); save(); render(); },
  say: el => speak(el.dataset.v),
  answer: el => answer(+el.dataset.v),
  next: () => advance(),
  gotit: () => { const c = sess.cur; sess.introduced.add(c.id); sess.queue.splice(Math.min(sess.queue.length, sess.i + 3), 0, c.id); sess.i++; present(); },
  quit: () => { view = { name: sess.answered ? 'done' : 'home' }; render(); },
  confirm: el => {
    if (el.dataset.armed) { clearTimeout(confirmTimer); return actions[el.dataset.do](el); }
    el.dataset.armed = '1'; el.textContent = 'Tap again to confirm'; el.classList.add('armed');
    confirmTimer = setTimeout(() => { delete el.dataset.armed; el.textContent = el.dataset.label; el.classList.remove('armed'); }, 3500);
  },
  markset: el => { markKnown(setOf(el.dataset.v).cards); save(); render(); },
  marklevel: el => { markKnown(deck.sets.filter(s => s.level === el.dataset.v).flatMap(s => s.cards)); save(); render(); },
  dlaudio: async el => {
    el.disabled = true;
    const ok = await downloadAllAudio((d, t) => { el.textContent = `Downloading audio… ${d}/${t}`; });
    el.textContent = ok ? 'All audio downloaded' : 'Download failed. Check your connection and try again';
    el.disabled = ok;
    const st = soundStatus(), box = document.getElementById('soundStatus'); if (box) { box.className = 'sound ' + st.level; box.textContent = st.text; }
  },
  soundtest: () => {
    speech.ok = null; speak('Ciao! Questa è una prova.');
    const out = () => { const st = soundStatus(); const el = document.getElementById('soundStatus'); if (el) { el.className = 'sound ' + st.level; el.textContent = st.text; } };
    setTimeout(out, 1800);
  },
  resetset: el => { for (const id of setOf(el.dataset.v).cards) delete S.cards[id]; save(); render(); },
  resetall: () => { S = defaults(); save(); rebuildDeck(); go('home'); },
  importknown: () => {
    const raw = document.getElementById('importKnown').value;
    const tokens = raw.split(/[\n,;\t]+/).map(t => t.split(/\s[=\-–—:]\s|=/)[0].trim()).filter(Boolean);
    const byNorm = new Map(deck.allWords.map(w => [norm(w.it), w]));
    let marked = 0, already = 0; const missing = [], found = [];
    for (const t of tokens) {
      const w = byNorm.get(norm(t));
      if (!w) { missing.push(t); continue; }
      if (isLearned(S.cards[w.id])) { already++; continue; }
      found.push(w.id); marked++;
    }
    markKnown(found);
    save();
    document.getElementById('importResult').textContent =
      `Marked ${plural(marked, 'word')} as known${already ? `, ${already} already learned` : ''}.` +
      (missing.length ? ` Not in the word sets (${missing.length}): ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}. Add them below with a translation.` : '');
  },
  addcustom: () => {
    const lines = document.getElementById('customWords').value.split('\n').map(l => l.trim()).filter(Boolean);
    let added = 0; const bad = [];
    const have = new Set(deck.allWords.map(w => norm(w.it)));
    for (const l of lines) {
      const m = l.split(/\s*[=\t]\s*|\s+[-–—]\s+/);
      if (m.length < 2 || !m[0] || !m[1]) { bad.push(l); continue; }
      if (have.has(norm(m[0]))) continue;
      S.custom.push({ it: m[0], en: m.slice(1).join(' / '), pos: 'x' }); have.add(norm(m[0])); added++;
    }
    if (added) S.enabled.custom = true;
    save(); rebuildDeck();
    document.getElementById('customWords').value = bad.join('\n');
    document.getElementById('customResult').textContent = `Added ${plural(added, 'word')}.` + (bad.length ? ` ${bad.length} line(s) need an "=" between Italian and English.` : '');
  },
  export: async () => {
    const data = JSON.stringify(S);
    const box = document.getElementById('backup'), out = document.getElementById('backupResult');
    try { await navigator.clipboard.writeText(data); out.textContent = 'Backup copied. Paste it somewhere safe, or into Settings on your other device.'; }
    catch (e) { box.value = data; box.select(); out.textContent = 'Copying is blocked here, so the backup is in the box above. Select all and copy it.'; }
  },
  import: () => {
    const out = document.getElementById('backupResult');
    try {
      const d = JSON.parse(document.getElementById('backup').value);
      if (!d || typeof d.cards !== 'object') throw new Error();
      const def = defaults();
      S = { ...def, ...d, settings: { ...def.settings, ...d.settings } }; save(); rebuildDeck();
      out.textContent = `Restored ${plural(Object.keys(S.cards).length, 'card')}.`;
    } catch (e) { out.textContent = 'That doesn\'t look like a Ripasso backup. Paste the whole text you copied.'; }
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.a]; if (fn) fn(el);
});
document.addEventListener('change', e => {
  const el = e.target.closest('input[data-a]'); if (el) actions[el.dataset.a]?.(el);
});
document.addEventListener('keydown', e => {
  if (view.name !== 'study' || e.target.tagName === 'TEXTAREA') return;
  const c = sess?.cur; if (!c) return;
  if (c.intro && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actions.gotit(); return; }
  if (!c.answered && /^[1-9]$/.test(e.key)) answer(+e.key - 1);
  else if (c.answered && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(); }
});

render();
if (window.RIPASSO_SW && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
