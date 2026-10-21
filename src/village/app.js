import { createVillage, stepVillage, saveVillage, loadVillage } from './village.js';
import { readVillagePalette, fitCamera, drawVillage, toLand, pickPerson } from './draw.js';
import { dateText, timeText, hoursPerSecond, monthOf } from './clock.js';
import { siteAt, siteOf } from './land.js';
import { woodpileOf } from './work.js';
import { assign, crews, siteTask, sameSite, TASKS, HALVES, canWork, fieldTask, assignPerson, siteOfPerson, peopleAt, isDrill, FIELD_TASKS, progressKey } from './work.js';
import { ageOf, lifeStage, kinOf, canFight } from './people.js';
import { MONTHS, DAYS_IN_MONTH, CLOCK } from './rules.js';
import { totals, aliveHouseholds, dailyGrain, dailyFuel, owedBy, owedTo, worth } from './economy.js';
import { houseName, headOf, freeHouse } from './family.js';
import { grant, refuse, order, release, rivalsOf, goodwillWord, PETITION_TEXT, petitionText, tie, RULES, addGoodwill, clearingHarvest, herdingNeed, councilEvery, answerWithin, hireOf, crewAt } from './council.js';
import { planHouse, freePlot, planField, freeWild } from './building.js';
import { BUILD } from './rules.js';
import { WEAPONS, SHIELDS, ARMOUR, HELMETS, GREAVES } from '../sim/rules.js';
import { WAR, COUNCIL, ECONOMY, TOOLS, SMITH, CITY, PUBLIC, ORCHARD, FIELDS, CIVIC, DISPUTES } from './rules.js';
import { decideDispute } from './disputes.js';
import { decideCivic, festivalCost, FESTIVAL_SCALE } from './civic.js';
import { planTower, planWall, wallWanted, curtainWall, wallLength, insideWall } from './public.js';
import { chooseSack, defenders } from './sack.js';
import { initNeighbours, peopleOfDeme, strengthOf, regardWord, athensPrice } from './neighbours.js';
import { bearing, planPlanting, planClearing } from './orchard.js';
import { toolsOf, toolWord, kitOf, kitPieces, kitWord, hasSmith, smithJobs, tripOf, describe, upgradeOf, kitPrice, KIT_NAMES, cityPrice, sellable, sheepKeep, slavesOf } from './smith.js';
import { planLevy, answerSummons, answerFine, battleSetup, applyBattle, standingWord, yourRead, sonToBring, CAPTIVES, decideCaptives } from './war.js';

const SAVE_KEY = 'pulsy-village';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const app = {
  v: null,
  cam: { x: 0, y: 0, scale: 1 },
  speed: 1,
  lastSpeed: 1,
  sel: { halves: [], people: [], person: -1, site: null, from: 'map', barAt: -1, labels: [] },
  pick: new Set(), // households whose people are shown one by one, to choose singly
  open: new Set(),
  logSeen: 0,
  day: -1,
  inspectedAt: 0,
  levyShare: 0.2,
  fees: {}, // the fee you mean to ask, by petition, for leave to clear land
  auto: false, // auto pace: the clock picks its own speed
  skip: null, // running on to the next thing that needs you: { until: day }
  councilOpen: false, // a council day: every petition shown at once
  levySon: false, // bring your grown son along though the levy does not take him
  battle: null, // the battle frame, while you are on the field
};

// The end: the walls carried, the village gone.
function showOver(v) {
  setSpeed(0);
  $('overTitle').textContent = `${v.name} has fallen`;
  $('overText').textContent = v.over.text;
  $('overBox').hidden = false;
}

$('overNew').addEventListener('click', () => {
  $('overBox').hidden = true;
  askFounding(false);
});

function start(v) {
  app.v = v;
  app.sel = { halves: [], people: [], person: -1, site: null, from: 'map', barAt: -1, labels: [] };
  // Older saves have unnumbered news: number it now.
  for (const e of v.log) if (e.seq == null) e.seq = v.logSeq = (v.logSeq || 0) + 1;
  app.logSeen = v.logSeq || 0;
  app.warKey = warKey(v);
  app.day = -1;
  $('overBox').hidden = !v.over;
  if (v.over) {
    $('overTitle').textContent = `${v.name} has fallen`;
    $('overText').textContent = v.over.text;
  }
  const c = $('map');
  fitCamera(app.cam, c.clientWidth, c.clientHeight);
  $('vname').textContent = v.name;
  renderPanels();
}

function load() {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (text) return loadVillage(text);
  } catch (e) {
    // An unreadable save, or one from an older version, starts a new village.
  }
  return null;
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, saveVillage(app.v));
  } catch (e) {
    // Storage may be full or blocked; the village carries on unsaved.
  }
}

// ---- panels ----

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

function siteLabel(v, site) {
  if (!site) return 'home';
  const s = siteOf(v, site);
  return s ? s.name : 'home';
}

function renderStores() {
  const v = app.v;
  const living = v.people.filter((p) => p.alive);
  const tot = totals(v);
  const hs = aliveHouseholds(v);
  const eat = hs.reduce((a, h) => a + dailyGrain(v, h), 0);
  const burn = hs.length * dailyFuel(v);
  const days = (store, use) => (use > 0 ? Math.floor(store / use) : '∞');
  const grainDays = days(tot.grain, eat);
  const woodDays = days(tot.wood, burn);
  const debt = v.debts.reduce((a, d) => a + d.kg, 0);
  const levels = [0, 0.05, 0.1, 0.15, 0.2];
  $('stores').innerHTML = `
    <div class="${grainDays < 30 ? 'warn' : ''}"><b>${fmt(tot.grain)}</b><span>kg grain in all the houses · ${grainDays} days</span></div>
    <div class="${woodDays < 20 ? 'warn' : ''}"><b>${fmt(tot.wood)}</b><span>kg firewood · ${woodDays} days</span></div>
    <div><b>${v.flock.head}</b><span>sheep and goats · ${v.flock.herders} herding</span></div>
    <div><b>${living.length}</b><span>people · ${living.filter((p) => canFight(v, p)).length} men of fighting age</span></div>
    <div><b>${fmt(tot.wool)}</b><span>kg wool · ${fmt(tot.cloth)} kg cloth</span></div>
    <div class="${debt > 500 ? 'warn' : ''}"><b>${fmt(debt)}</b><span>kg owed between houses</span></div>`;
  $('commons').innerHTML = `
    <p class="note"><b>${fmt(v.common.grain)} kg</b> of barley in the common granary.</p>
    <label class="row">Levy on every harvest
      <select id="levy">${levels.map((l) => `<option value="${l}"${Math.abs(v.levy - l) < 1e-6 ? ' selected' : ''}>${Math.round(l * 100)}%</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" id="relief"${v.relief ? ' checked' : ''}> Feed households with nothing left</label>
    ${v.war ? `<p class="note">With the city, ${esc(v.name)} is <b>${standingWord(v.war.standing)}</b>${v.war.defiance ? `, and has defied it ${v.war.defiance} time${v.war.defiance > 1 ? 's' : ''}` : ''}${v.war.history.length ? `; its men have answered ${v.war.history.filter((x) => x.sent).length} of ${v.war.history.length} summonses` : ''}.</p>` : ''}
    <p class="note">At the gate this evening: firewood ${v.prices.wood.toFixed(2)}, wool ${v.prices.wool.toFixed(1)}, cloth ${v.prices.cloth.toFixed(0)} kg of barley a kilo.</p>`;
  $('levy').onchange = (e) => {
    v.levy = Number(e.target.value);
    save();
  };
  $('relief').onchange = (e) => {
    v.relief = e.target.checked;
    save();
  };
}

function isChosen(h, half) {
  return app.sel.halves.some((x) => x.h === h && x.half === half);
}

// The households this one is closest to, and the ones it has no love for.
function tiesText(v, h) {
  const others = aliveHouseholds(v).filter((o) => o !== h).map((o) => ({ o, t: tie(v, h.id, o.id) }));
  const close = others.filter((x) => x.t > 0.3).sort((a, b) => b.t - a.t).slice(0, 3);
  const cold = others.filter((x) => x.t < -0.1).sort((a, b) => a.t - b.t).slice(0, 3);
  const names = (xs) => xs.map((x) => (x.o.player ? 'yours' : esc(x.o.name))).join(', ');
  return close.length || cold.length ? `<p class="note">${close.length ? `Close to the houses of ${names(close)}. ` : ''}${cold.length ? `No friends of the houses of ${names(cold)}.` : ''}</p>` : '';
}

// What a household is about, in its own words.
function planText(v, h) {
  const p = h.plan;
  if (!p) return '';
  const what = { wood: p.forSale === false ? 'cutting its winter wood' : 'cutting wood to sell', herd: 'minding the flock', clear: 'clearing new land', build: 'building a house' }[p.kind];
  return `${what} · `;
}

// The household list, richest first. Whatever you are doing with a household shows right there:
// the bar to send the chosen men or women somewhere sits just above the household you last
// chose from, and a household's details, and anyone you pick from it, open inside its card.
function renderHouseholds() {
  const v = app.v;
  const hs = aliveHouseholds(v).map((h) => ({ h, w: worth(v, h) })).sort((a, b) => b.w - a.w);
  const n = app.sel.halves.length + app.sel.people.length;
  const singles = app.sel.people.map((id) => v.people[id]);
  // New work the chosen households can take on: a house for a man of theirs who wants one, and new
  // land, paid for by the first household chosen other than yours (yours clears land from Projects).
  const chosen = [...new Set([...app.sel.halves.map((x) => x.h), ...singles.map((p) => p.household)])].map((id) => v.households[id]);
  // Men of fighting age, armed, among those chosen: they can be sent to drill for war.
  const fighters = singles.filter((p) => isDrill(v, p)).length + app.sel.halves.filter((x) => x.half === 'm').reduce((a, x) => a + v.households[x.h].members.filter((id) => isDrill(v, v.people[id]) && !v.people[id].assign).length, 0);
  const payer = chosen.find((h) => !h.player);
  const houseFor = chosen.find((h) => h.waiting >= 0 && freeHouse(v) < 0 && !(v.projects || []).some((x) => x.sponsor === h.id && x.kind === 'house'));
  const newWork = [
    houseFor && freePlot(v) >= 0 ? `<button data-plan="${houseFor.id}">Build a house for ${esc(v.people[houseFor.waiting].name)}</button>` : '',
    payer && !payer.player && freeWild(v) >= 0 ? `<button data-clear="${payer.id}" title="About ${Math.round(BUILD.field.work * 1.2)} days' work for 1.2 ha. ${payer.player ? 'Your house pays' : `The house of ${esc(payer.name)} pays`} the wages of anyone else's people who work on it, and keeps the brushwood and stones.">Clear new land for ${payer.player ? 'your house' : `the house of ${esc(payer.name)}`}</button>` : '',
  ].join('');
  const bar = n
    ? `<div class="sel-bar" id="selBar"><p class="note">${n} chosen. Tap a field, a wood, the quarry or the pasture on the map to send them there, or:</p>
       <button id="toFields">To the fields, wherever needed</button>${(v.projects || []).map((x) => `<button data-to-build="${x.id}">To ${x.kind === 'field' ? 'clear' : 'build'} ${esc(x.name)}</button>`).join('')}${fighters ? `<button id="toDrill">Drill for war (${fighters} m${fighters === 1 ? 'an' : 'en'})</button>` : ''}<button id="toHome" title="No order: they go back to doing as they see fit">Home: let them decide</button><button id="selClear">Clear</button>
       ${newWork ? `<p class="note">New work:</p><div class="new-work">${newWork}</div>` : ''}</div>` : '';
  const anchor = n ? (chosen.some((h) => h.id === app.sel.barAt) ? app.sel.barAt : chosen[chosen.length - 1].id) : -1;
  $('holds').innerHTML = (n ? '' : '<p class="note">Tap a household\'s men or women to choose them, then a place on the map. Tap a household\'s name for more.</p>')
    + hs.map(({ h, w }, rank) => {
      const alive = h.members.map((id) => v.people[id]).filter((p) => p.alive);
      const drilling = (sex) => alive.filter((p) => p.sex === sex && p.assign && p.assign.kind === 'drill' && !p.away).length;
      const half = (sex) => {
        const k = alive.filter((p) => p.sex === sex && canWork(v, p) && !p.assign && !p.away).length;
        const c = sex === 'm' ? 'var(--man)' : 'var(--woman)';
        const word = k === 1 ? (sex === 'm' ? 'man' : 'woman') : HALVES[sex];
        return `<button class="half" style="--c:${c}" data-h="${h.id}" data-half="${sex}" aria-pressed="${isChosen(h.id, sex)}">
          <b>${k} ${word}</b><span>${h.ordered && h.ordered[sex] ? 'by your order: ' : ''}${esc(siteLabel(v, h.assign[sex]))}${drilling(sex) ? ` · ${drilling(sex)} drilling` : ''}</span></button>`;
      };
      const eat = dailyGrain(v, h);
      const fields = v.land.fields.filter((f) => f.owner === h.id);
      const owes = owedBy(v, h);
      const owed = owedTo(v, h);
      const open = app.open.has(h.id);
      const details = open
        ? `<p class="note">${fields.length} plots (${fields.reduce((a, f) => a + f.ha, 0).toFixed(1)} ha): ${fields.map((f) => `<button class="linkish" data-site="field:${f.id}" data-from="hold:${h.id}">${f.id + 1}</button>`).join(', ')}. ${h.sheep} sheep. ${Math.round(h.stores.grain)} kg barley, ${Math.round(h.stores.wood)} kg firewood, ${Math.round(h.stores.stone || 0)} kg stone, ${h.stores.wool.toFixed(1)} kg wool, ${h.stores.cloth.toFixed(1)} kg cloth${v.yokes.some((y) => y.owner === h.id) ? ', a yoke of oxen' : ''}${v.cartOwners.includes(h.id) ? ', a cart' : ''}.${owes ? ` Owes ${Math.round(owes)} kg.` : ''}${owed ? ` Is owed ${Math.round(owed)} kg.` : ''}</p>${spentText(h)}
          <div class="members">${alive.map((p) => `<button data-person="${p.id}" data-from="hold:${h.id}" aria-pressed="${app.sel.person === p.id && app.sel.from === `hold:${h.id}`}">${p.id === h.head ? '<b>' : ''}${esc(p.name)} ${ageOf(v, p)}${p.id === h.head ? '</b>' : ''}</button>`).join('')}</div>${tiesText(v, h)}${(h.armoury || []).length ? `<p class="note">Laid by: the armour of ${h.armoury.length} dead m${h.armoury.length === 1 ? 'an' : 'en'}, for the sons when they come of age.</p>` : ''}` : '';
      const card = app.sel.from === `hold:${h.id}` && (app.sel.person >= 0 || app.sel.site) ? '<div class="inline-card inspect" id="inlineCard"></div>' : '';
      // A man who wants a house of his own, and the house going up for him.
      const project = (v.projects || []).find((x) => x.sponsor === h.id && x.kind !== 'field');
      const clearing = (v.projects || []).filter((x) => x.sponsor === h.id && x.kind === 'field');
      let house = '';
      if (project) {
        const pct = Math.round((project.done.work / project.needs.work) * 100);
        house = `<p class="note house-note">Building a house: ${pct}% done; stone ${Math.round(project.done.stone)} of ${project.needs.stone} kg, timber ${Math.round(project.done.wood)} of ${project.needs.wood} kg laid in.${project.short ? ` <b>Short of ${project.short === 'stone' ? 'stone' : 'timber'}.</b>` : ''} <button class="linkish" data-site="build:${project.id}" data-from="hold:${h.id}">The site</button></p>`;
      } else if (h.waiting >= 0) {
        const man = v.people[h.waiting];
        house = freeHouse(v) >= 0 ? `<p class="note house-note">${esc(man.name)} will move his family into an empty house.</p>`
          : `<p class="note house-note">${esc(man.name)} wants a house of his own for his family.${freePlot(v) >= 0 ? ' Choose this household\'s men or women to build him one.' : ' There is no plot left to build on.'}</p>`;
      }
      return `${h.id === anchor ? bar : ''}<div class="hold${h.player ? ' mine' : ''}" id="hold${h.id}">
        <div class="hold-head"><button data-hold="${h.id}" aria-expanded="${open}">${rank + 1}. ${esc(houseName(v, h))}</button>
 ${h.player ? '' : `<span class="mood g${Math.round((h.goodwill ?? 0.6) * 4)}">${goodwillWord(h.goodwill ?? 0.6)}</span>`}
        <small class="${h.hungry || h.rationing || h.stores.grain < eat * 15 ? 'bad' : ''}">${planText(v, h)}worth ${fmt(w)} · ${alive.length} people · ${Math.floor(h.stores.grain / Math.max(0.1, eat))} days' grain · ${Math.floor(h.stores.wood / dailyFuel(v))} days' wood${h.stores.coin >= 1 ? ` · ${Math.round(h.stores.coin)} dr` : ''}${owes > 1 ? ` · owes ${Math.round(owes)}` : ''}${h.rationing ? ` · on short rations (${Math.round(h.rationing * 100)}%)` : ''}${toolTrouble(h)}${(v.trips || []).some((t) => t.house === h.id) ? ' · men in Athens' : ''}</small></div>
        <div class="halves">${half('m')}${half('f')}</div>
        <button class="linkish pick-toggle" data-pick="${h.id}" aria-expanded="${app.pick.has(h.id)}">${app.pick.has(h.id) ? 'Hide' : 'Choose'} people one by one</button>
        ${app.pick.has(h.id) ? `<div class="picks">${alive.filter((p) => canWork(v, p) && !p.away).map((p) => `<button class="pick" data-pick-person="${p.id}" aria-pressed="${app.sel.people.includes(p.id)}"><b>${esc(p.name)} ${ageOf(v, p)}</b><span>${p.selfDrill ? 'his house sends him to drill' : `${p.assign ? 'on his own: ' : ''}${esc(siteLabel(v, siteOfPerson(v, p)))}`}${isDrill(v, p) ? ' ⚔' : ''}</span></button>`).join('')}</div>` : ''}
${house}${clearing.map((x) => `<p class="note house-note">Clearing new land: ${Math.round((x.done.work / x.needs.work) * 100)}% of ${x.needs.work.toFixed(0)} days' work. <button class="linkish" data-site="build:${x.id}" data-from="hold:${h.id}">The ground</button></p>`).join('')}${details}${card}</div>`;
    }).join('');
  if (n) {
    document.querySelectorAll('[data-to-build]').forEach((b) => { b.onclick = () => sendTo({ kind: 'build', id: Number(b.dataset.toBuild) }); });
    $('toFields').onclick = () => sendTo({ kind: 'farm', id: 0 });
    if ($('toDrill')) $('toDrill').onclick = () => sendTo({ kind: 'drill', id: 0 });
    if ($('toHousehold')) $('toHousehold').onclick = () => {
      for (const id of app.sel.people) assignPerson(v, v.people[id], null);
      app.sel.people = [];
      save();
      renderPanels();
    };
    $('toHome').onclick = () => sendTo(null);
    if ($('toSelf')) $('toSelf').onclick = () => {
      for (const { h, half } of app.sel.halves) release(v, v.households[h], half);
      app.sel.halves = [];
      app.sel.people = [];
      save();
      renderPanels();
    };
    $('selClear').onclick = () => {
      app.sel.halves = [];
      app.sel.people = [];
      renderPanels();
    };
  }
  $('hint').hidden = !n;
  $('hint').textContent = n ? `${n} chosen: tap a field, a wood or the pasture to send them there.` : '';
}

function renderCrews() {
  const v = app.v;
  const list = crews(v);
  if (!list.length) {
    $('crews').innerHTML = '<p class="note">Everyone is working at home.</p>';
    return;
  }
  $('crews').innerHTML = `<ul>${list.filter(({ site }) => siteOf(v, site)).map(({ site, halves, persons }) => {
    const people = peopleAt(v, { site, halves, persons });
    const task = siteTask(v, site);
    const what = task === 'farm' ? 'wherever the fields need hands' : TASKS[task].text;
    const key = `crew:${site.kind}:${site.id}`;
    const card = app.sel.from === key ? '<div class="inline-card inspect" id="inlineCard"></div>' : '';
    return `<li><div class="crew-row"><button data-site="${site.kind}:${site.id}" data-from="${key}" class="linkish">${esc(siteOf(v, site).name)}</button><small>${people.length} ${people.length === 1 ? 'person' : 'people'} from ${new Set(people.map((p) => p.household)).size} household${new Set(people.map((p) => p.household)).size === 1 ? '' : 's'} · ${what}</small></div>${card}</li>`;
  }).join('')}</ul>`;
}

function meter(label, value, colour = 'var(--ink)') {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="meter" style="--c:${colour}"><span>${label}</span><span class="track"><span class="fill" style="width:${pct}%"></span></span><span class="num">${pct}</span></div>`;
}

const CHORE_TEXT = {
  water: 'Fetching water from the well.',
  wash: 'Washing clothes at the stream.',
  firewood: 'Fetching firewood from the pile.',
  meal: 'Carrying a meal out to the men at work.',
};

function personText(v, p) {
  if (!p.alive) return p.gone ? `Married into ${esc(p.gone)}, and went to live there.` : `Died of ${p.cause}.`;
  if (p.away && p.away.city) {
    const t = tripOf(v, p);
    return t ? `On the road to Athens and back, to buy ${esc(t.items.map(describe).join(', '))}: home in ${Math.max(1, t.back - v.day)} day${t.back - v.day === 1 ? '' : 's'}.` : 'Away in Athens.';
  }
  if (p.away) return `Away with the army under ${esc(v.war.campaign ? v.war.campaign.general : 'the general')}.`;
  if (p.task === 'smith' && p.state !== 'home') return 'At the forge.';
  const her = p.sex === 'f' ? 'her' : 'his';
  const site = siteOfPerson(v, { ...p, assign: null });
  if (p.state === 'returning') {
    if (p.task === 'wood' && p.load > 0) return `Dragging a log of ${Math.round(p.load)} kg home to the woodpile.`;
    if (p.task === 'herd') return 'Bringing the flock home to the fold.';
    return p.load > 0 ? `Walking home with ${Math.round(p.load)} kg of grain.` : 'Walking home.';
  }
  if (p.task === 'clear' && (p.state === 'out' || p.state === 'working')) {
    return p.state === 'out' ? 'Walking out to the rough ground to clear it.' : 'Clearing new land: cutting scrub, grubbing out roots, carrying off stones.';
  }
  if (p.task === 'plant' && (p.state === 'out' || p.state === 'working')) {
    const x = (v.projects || []).find((o) => o.id === p.project);
    return p.state === 'out' ? 'Walking out to the planting.' : `Planting${x ? ` ${esc(x.name)}` : ''}: digging trenches and pits, setting the ${x && x.crop === 'olives' ? 'young olive trees' : 'vine cuttings'}.`;
  }
  if (p.task === 'build' && (p.state === 'out' || p.state === 'working')) {
    const x = (v.projects || []).find((o) => o.id === p.project);
    return p.state === 'out' ? 'Walking to the building site.' : `Building ${x ? esc(x.name) : 'a house'}: making mudbrick, laying walls.`;
  }
  if (p.task === 'stone' && (p.state === 'out' || p.state === 'working')) {
    if (p.sub === 'cart') return 'Driving the ox cart for the quarry.';
    if (p.sub === 'toStand') return 'Walking to the quarry.';
    if (p.sub === 'cut') return `Breaking out stone at the quarry: ${Math.round(p.load)} of 30 kg for the next load.`;
    if (p.sub === 'drag') return `Carrying ${Math.round(p.load)} kg of stone home.`;
  }
  if (p.task === 'wood') {
    const g = v.land.groves[p.grove];
    if (p.sub === 'cart') {
      const c = (v.cartsOut || []).find((x) => x.driver === p.id);
      if (!c) return 'Driving the ox cart.';
      if (c.state === 'out') return `Driving the empty ox cart out to ${g.name}.`;
      if (c.state === 'loading') return `Loading the cart at the edge of ${g.name}: ${Math.round(c.load)} kg on, ${Math.round(g.pile)} kg piled.`;
      return `Driving a cartload of ${Math.round(c.load)} kg of wood home.`;
    }
    if (p.sub === 'toStand') return `Walking to ${g.name} to cut wood.`;
    if (p.sub === 'cut') return `Cutting wood in ${g.name}: ${Math.round(p.load)} of ${60} kg for the next log.`;
    if (p.sub === 'drag') return g.carted ? 'Dragging a log to the landing for the cart.' : `Dragging a log of ${Math.round(p.load)} kg home to the woodpile.`;
  }
  if (p.task === 'herd') return p.state === 'out' ? `Taking the flock out to ${siteLabel(v, site)}.` : `Out with the flock on ${siteLabel(v, site)}, keeping them together.`;
  if (p.field != null && FIELD_TASKS.has(p.task) && (p.state === 'out' || p.state === 'working')) {
    const f = v.land.fields[p.field];
    if (p.task === 'thresh') return p.state === 'out' ? `On ${her} way to the threshing floor.` : `Threshing and winnowing the barley from ${f.name}: ${Math.round(f.sheaves || 0)} kg still in the sheaf.`;
    if (p.state === 'out') return `On ${her} way to ${f.name}.`;
    const what = p.task === 'plough' || p.task === 'fallow' ? (p.yoke ? `Ploughing ${p.task === 'fallow' ? 'the fallow ' : ''}behind a yoke of oxen` : `Breaking ${p.task === 'fallow' ? 'the fallow' : 'the ground'} with a mattock`) : TASKS[p.task].text.replace(/^./, (c) => c.toUpperCase());
    const key = progressKey(p.task);
    return `${what} on ${f.name}: ${Math.round((f[key] || 0) * 100)}% done.`;
  }
  if (p.doing && CHORE_TEXT[p.doing]) return CHORE_TEXT[p.doing];
  if (p.task === 'house') return 'Working at home: grinding, baking, spinning.';
  return lifeStage(v, p) === 'infant' ? 'A baby.' : 'At home.';
}

// The close look at a person or a place goes where you asked for it: on the map, over the map,
// for something you tapped there; inside the list, for something you picked from the list.
function renderInspector() {
  const v = app.v;
  const s = app.sel;
  const onMap = s.from === 'map' && (s.person >= 0 || s.site);
  $('mapCard').hidden = !onMap;
  const box = onMap ? $('mapCardBody') : document.getElementById('inlineCard');
  if (!box) return;
  if (s.person >= 0) {
    const p = v.people[s.person];
    const h = v.households[p.household];
    const colour = p.sex === 'm' ? 'var(--man)' : 'var(--woman)';
    const fighter = p.weapon && canFight(v, p);
    const kit = fighter ? [WEAPONS[p.weapon].name, p.shield !== 'none' ? SHIELDS[p.shield].name : 'no shield', p.armour !== 'none' ? ARMOUR[p.armour].name : 'no armour', p.helmet !== 'none' ? `${HELMETS[p.helmet].name} helmet` : 'no helmet', p.greaves !== 'none' ? GREAVES[p.greaves].name.toLowerCase() : ''].filter(Boolean).join(', ') : '';
    const word = (x, words) => words[x > 0.8 ? 0 : x > 0.62 ? 1 : x > 0.42 ? 2 : x > 0.25 ? 3 : 4];
    box.innerHTML = `<h2>${p.player ? 'You, the leading man of the village' : p.slave ? 'A slave' : p.sex === 'm' ? 'A man' : 'A woman'}${p.player ? '' : ' of the village'}</h2>
      <div class="who" style="color:${colour}">${esc(p.name)}${p.epithet ? `, ${esc(p.epithet)}` : ''}${p.veteran ? '<span class="badge">Veteran</span>' : ''}</div>
      <p class="note">${p.alive ? `${ageOf(v, p)} years old. ` : ''}${esc(kinOf(v, p).replace(/^./, (c) => c.toUpperCase()))}${kinOf(v, p) ? '. ' : ''}${h.head === p.id ? 'Head of the house.' : esc(houseName(v, h)) + '.'}</p>
      <p class="note">${personText(v, p)}</p>
      ${p.alive ? `${meter('Fed', p.fed, colour)}${meter('Health', p.health, colour)}${meter('Strength', p.strength, colour)}
      <h3 class="wounds-head">Skill</h3>
      <div class="skills">${meter('Farming', p.skills.farm, colour)}${meter('Woodcraft', p.skills.wood, colour)}${meter('Building', p.skills.build || 0, colour)}${meter('Herding', p.skills.herd, colour)}${meter('Housework', p.skills.house, colour)}</div>` : ''}
      ${fighter ? `<h3 class="wounds-head">In war</h3><dl>
        <dt>Courage</dt><dd>${word(p.courage, ['fearless', 'brave', 'steady', 'nervous', 'timid'])}</dd>
        <dt>Skill</dt><dd>${word(p.skill, ['master', 'skilled', 'competent', 'green', 'raw'])}</dd>
        ${p.endurance != null ? `<dt>Endurance</dt><dd>${word(p.endurance, ['tireless', 'hardy', 'fair', 'short of wind', 'soon spent'])}</dd>` : ''}
        <dt>Name</dt><dd>${word(p.reputation, ['renowned', 'respected', 'known', 'little known', 'unknown'])}</dd>
        <dt>Battles</dt><dd>${p.battles}</dd>
        <dt>Affairs</dt><dd>${word(p.politics ?? 0.4, ['shrewd', 'well informed', 'informed', 'poorly informed', 'ignorant'])}</dd>
        <dt>Kit</dt><dd>${kit}</dd>
        ${kitPieces(p).some((k) => kitOf(p)[k] < 0.99) ? `<dt>Its state</dt><dd>${kitPieces(p).filter((k) => kitOf(p)[k] < 0.99).map((k) => `${k === 'weapon' ? 'spear' : k} ${kitWord(kitOf(p)[k])}`).join(', ')}</dd>` : ''}</dl>` : ''}
      ${p.selfDrill ? '<p class="note">His household has sent him to drill today, the work at home being done.</p>' : p.assign ? `<p class="note">Sent on ${p.sex === 'f' ? 'her' : 'his'} own, apart from ${p.sex === 'f' ? 'her' : 'his'} household: ${esc(siteLabel(v, siteOfPerson(v, p)))}.</p>` : ''}
      ${p.drilled ? `<p class="note">Has drilled for war ${Math.round(p.drilled)} hours.</p>` : ''}
      ${p.marks && p.marks.length ? `<p class="note">He carries ${[...new Set(p.marks)].map(esc).join(', ')} from his battles.</p>` : ''}`;
    return;
  }
  if (s.site) {
    const site = siteOf(v, s.site);
    // A building site that has been finished, or ground that has been cleared, is gone.
    if (!site) {
      s.site = null;
      $('mapCard').hidden = true;
      box.innerHTML = '';
      return;
    }
    let body = '';
    if (s.site.kind === 'field') {
      const f = site;
      const year = Math.floor(v.day / 360);
      const o = f.kind ? ORCHARD[f.kind] : null;
      const b = o ? bearing(v, f) : 0;
      const state = o ? (f.state === 'ripe' ? `${f.kind === 'vines' ? 'Vines' : 'Olives'}, ripe: about ${Math.round(f.crop * (1 - (f.gathered || 0)))} ${o.unit} still to gather.`
        : `${f.kind === 'vines' ? 'Vines' : 'Olives'}, planted in year ${Math.floor((f.planted ?? 0) / 360) + 1}: ${b >= 1 ? 'in full bearing' : b > 0 ? `coming into bearing (${Math.round(b * 100)}%)` : 'not yet bearing'}. This year ${o.tend.map((t) => `${TASKS[t.task].text} ${Math.round((f[progressKey(t.task)] || 0) * 100)}% done`).join(', ')}; the crop is gathered in ${MONTHS[o.gather.month].name}.`)
        : f.state === 'planting' ? 'Being dug and planted.'
        : f.state === 'ripe' ? `Ripe: about ${Math.round(f.crop * (1 - f.reaped))} kg of barley still standing.`
        : f.state === 'sown' ? `Sown${f.weeded > 0 ? `, ${Math.round(f.weeded * 100)}% hoed` : ''}${f.prep ? `, on fallow ploughed ${f.prep === 1 ? 'once' : 'twice'} last year` : ''}. The barley ripens in ${MONTHS[7].name}.`
        : f.rotation === year % 2 ? `To be sown this year: ${Math.round(f.ploughed * 100)}% ploughed, ${Math.round(f.sown * 100)}% sown.${f.prep ? ` The fallow was ploughed ${f.prep === 1 ? 'once' : 'twice'} last year.` : ''}` : `Lying fallow this year: ploughed ${['not yet', 'once', 'twice'][Math.min(2, f.passes || 0)]}, in spring and again in summer.`;
      const sheaves = f.sheaves > 0 ? ` ${Math.round(f.sheaves)} kg of barley still in the sheaf, to be threshed.` : '';
      const task = fieldTask(v, f);
      const owner = f.owner >= 0 ? (v.households[f.owner].player ? 'yours' : `owned by the house of ${esc(v.households[f.owner].name)}`) : 'the village\'s common land';
      body = `<p class="note">${f.ha.toFixed(1)} hectares, ${(f.dist / 1000).toFixed(1)} km from the gate, ${owner}. ${state}${sheaves}</p><p class="note">${task ? `Work to do now: ${TASKS[task].text}.` : 'Nothing to do here now.'}</p>`;
    } else if (s.site.kind === 'build' && (v.projects || []).find((o) => o.id === s.site.id)?.kind === 'field') {
      const x = v.projects.find((o) => o.id === s.site.id);
      const w = v.land.wild[x.plot];
      const h = v.households[x.sponsor];
      body = `<p class="note">${w.ha.toFixed(1)} ha of rough ground ${(w.dist / 1000).toFixed(1)} km from the gate, being cleared for the house of ${esc(h.name)}, who pays anyone else's people who work on it. ${Math.round((x.done.work / x.needs.work) * 100)}% cleared: ${x.done.work.toFixed(0)} of ${x.needs.work.toFixed(0)} days' work. The brushwood and stones go to the house of ${esc(h.name)}. Cleared ground on the margins is thinner than the old fields: about four-fifths the yield.</p>`;
    } else if (s.site.kind === 'build') {
      const x = (v.projects || []).find((o) => o.id === s.site.id);
      if (x) {
        const h = v.households[x.sponsor];
        body = `<p class="note">Paid for by the house of ${esc(h.name)}, out of its own stores. ${Math.round((x.done.work / x.needs.work) * 100)}% built: ${x.done.work.toFixed(0)} of ${x.needs.work} days' work, ${Math.round(x.done.stone)} of ${x.needs.stone} kg of stone and ${Math.round(x.done.wood)} of ${x.needs.wood} kg of timber laid in. The house has ${Math.round(h.stores.stone || 0)} kg of stone and ${Math.round(h.stores.wood)} kg of wood at home.${x.short ? ` <b>Work has stopped for want of ${x.short === 'stone' ? 'stone: send someone to the quarry' : 'timber: send someone to the woods'}.</b>` : ''}</p>`;
      }
    } else if (s.site.kind === 'grove' && site.material === 'stone') {
      body = `<p class="note">${(Math.hypot(site.x, site.y) / 1000).toFixed(1)} km away. Grey limestone for footings and walls. Broken out and carried home in loads, or carted if a yoke and cart are free; it goes to the store of the household that quarried it.</p>`;
    } else if (s.site.kind === 'grove') {
      const trees = site.trees.map((t) => v.land.trees[t]);
      const wood = trees.reduce((a, t) => a + t.wood, 0);
      body = `<p class="note">${(Math.hypot(site.x, site.y) / 1000).toFixed(1)} km away. About ${Math.round(wood / 1000)} tonnes of wood standing; ${trees.filter((t) => t.wood <= 50).length} of ${trees.length} stands cut down, growing back as coppice.</p>`;
    } else if (s.site.kind === 'pasture') {
      body = `<p class="note">${(Math.hypot(site.x, site.y) / 1000).toFixed(1)} km away. Rough grazing for the flock. One herder can keep about fifty head together; more than that and some stray.</p>`;
    } else if (s.site.kind === 'farm') {
      body = '<p class="note">Households sent here go each day to whichever field most needs hands: reaping first, then ploughing and sowing, then hoeing.</p>';
    } else if (s.site.kind === 'forge') {
      const sm = v.smith;
      const man = sm && sm.man >= 0 ? v.people[sm.man] : null;
      const waiting = hasSmith(v) ? smithJobs(v).length : 0;
      body = `<p class="note">The village's forge, outside the gate. ${man ? `${esc(man.name)} of the house of ${esc(v.households[sm.house].name)} is the smith (${Math.round((man.skills.smith || 0) * 100)}% skilled).` : 'It stands cold: there is no smith.'} He mends tools for ${SMITH.mend.price} kg, makes new ones for ${SMITH.make.price} kg, and repairs armour for ${SMITH.repair.price} kg a piece. Armour itself comes from the city.</p>
        ${sm ? `<p class="note">${sm.iron.toFixed(1)} kg of iron, ${sm.bronze.toFixed(1)} kg of bronze and ${sm.charcoal.toFixed(1)} kg of charcoal in hand. ${waiting} job${waiting === 1 ? '' : 's'} waiting. ${sm.done || 0} done since the forge was built, for ${Math.round(sm.earned || 0)} kg.</p>` : ''}`;
    } else if (s.site.kind === 'drill') {
      body = '<p class="note">Open ground outside the gate where men practise with spear and shield, in pairs and as a line. A man who drills grows handier with his weapons and a little surer of himself, the more so the less he knows; he does no other work that day. Only men of fighting age with arms of their own drill.</p>';
    }
    const who = crews(v).find((c) => sameSite(c.site, s.site));
    const list = who ? [...who.halves.map((x) => `the ${HALVES[x.half]} of the house of ${esc(x.h.name)}`), ...who.persons.map((p) => esc(p.name))].join('; ') : '';
    // Who is actually at work here today, whether sent here or come from "the fields".
    let today = '';
    if (s.site.kind === 'field') {
      const crew = (site.crew || []).map((id) => v.people[id]).filter((p) => p.alive && p.field === site.id && (p.state === 'out' || p.state === 'working'));
      const houses = [...new Set(crew.map((p) => p.household))].map((hid) => (v.households[hid].player ? 'yours' : esc(v.households[hid].name)));
      today = crew.length ? `<p class="note">At work here today: ${crew.length} from ${houses.length === 1 ? 'the house of ' : 'the houses of '}${houses.join(', ')}.</p>` : '';
    }
    box.innerHTML = `<h2>${esc(site.name)}</h2>${body}${today}${list ? `<p class="note">Sent here: ${list}.</p>` : ''}`;
    return;
  }
  box.innerHTML = '';
}

function renderLog() {
  const v = app.v;
  const items = v.log.slice(-60).reverse();
  $('log').innerHTML = items.map((e) => {
    const d = `${(e.day % DAYS_IN_MONTH) + 1} ${MONTHS[Math.floor((e.day % 360) / DAYS_IN_MONTH)].name.slice(0, 5)}`;
    return `<li class="${e.kind === 'alarm' ? 'alarm' : ''}"><time>${d}</time><span>${esc(e.text)}</span></li>`;
  }).join('');
}

// What a house has laid out on the smith and the city this year (and last), for its card.
function spentText(h) {
  const line = (s, when) => {
    if (!s) return '';
    const parts = [];
    if (s.trips) parts.push(`${s.trips} trip${s.trips === 1 ? '' : 's'} to Athens (${s.manDays} man-days on the road)`);
    if (s.city) parts.push(`${Math.round(s.city)} kg in the city or to carriers`);
    if (s.smith) parts.push(`${Math.round(s.smith)} kg to the smith`);
    return parts.length ? `${when}: ${parts.join(', ')}.` : '';
  };
  const text = [line(h.spent, 'This year'), line(h.spentLast, 'Last year')].filter(Boolean).join(' ');
  return text ? `<p class="note">${text}</p>` : '';
}

// Tools that hold a household back, for its card.
function toolTrouble(h) {
  const t = toolsOf(h);
  const bad = Object.keys(TOOLS.names).filter((k) => t[k] < TOOLS.sharp);
  return bad.length ? ` · ${bad.map((k) => `${k === 'plough' ? 'ploughshare' : TOOLS.names[k]} ${toolWord(t[k])}`).join(', ')}` : '';
}

// A household in full, for a petition: who they are, what they have, how they stand.
function houseSummary(v, h) {
  const alive = h.members.map((id) => v.people[id]).filter((p) => p.alive);
  const eat = dailyGrain(v, h);
  const fields = v.land.fields.filter((f) => f.owner === h.id);
  const owes = owedBy(v, h);
  const owed = owedTo(v, h);
  const rank = aliveHouseholds(v).map((o) => ({ o, w: worth(v, o) })).sort((a, b) => b.w - a.w).findIndex((x) => x.o === h) + 1;
  const people = alive.map((p) => `${p.id === h.head ? '<b>' : ''}${esc(p.name)} ${ageOf(v, p)}${p.id === h.head ? '</b>' : ''}`).join(', ');
  return `<div class="house-summary">
    <p class="note">${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} richest of ${aliveHouseholds(v).length}, worth ${fmt(worth(v, h))}. ${planText(v, h) ? planText(v, h).replace(/ · $/, '.') + ' ' : ''}${alive.length} people: ${people}.</p>
    <p class="note">${fields.length} plots (${fields.reduce((a, f) => a + f.ha, 0).toFixed(1)} ha), ${h.sheep} sheep. ${Math.floor(h.stores.grain / Math.max(0.1, eat))} days' grain, ${Math.floor(h.stores.wood / dailyFuel(v))} days' wood, ${Math.round(h.stores.stone || 0)} kg stone, ${h.stores.cloth.toFixed(1)} kg cloth.${owes ? ` Owes ${Math.round(owes)} kg.` : ''}${owed ? ` Is owed ${Math.round(owed)} kg.` : ''}</p>
    ${tiesText(v, h)}
  </div>`;
}

// Leave to clear land can be given for a rent: a share of each harvest the new field gives, a tenth
// being the usual thing.
const feeOf = (p) => app.fees[p.id] ?? COUNCIL.feeUsual;
const feeKg = (p, fee) => Math.round(fee * clearingHarvest(p.ha || 1));

function feeChoice(p) {
  const fee = feeOf(p);
  const feel = fee < COUNCIL.feeUsual ? 'generous: they will think the better of you' : fee > COUNCIL.feeUsual ? 'more than is usual: they will resent it' : 'the usual rent';
  return `<p class="note">An ordinary harvest from it should bring about ${Math.round(clearingHarvest(p.ha || 1))} kg of barley, every other year as it lies fallow between. Ask, as rent to your house, a share of each harvest it gives, whoever holds it:</p>
    <div class="shares" role="group" aria-label="Rent for leave to clear">${COUNCIL.fees.map((x) => `<button data-fee="${x}" data-fee-for="${p.id}" aria-pressed="${Math.abs(x - fee) < 1e-6}">${x ? pctText(x) : 'Nothing'}</button>`).join('')}</div>
    <p class="note">${fee ? `${pctText(fee)} of each harvest, about ${feeKg(p, fee)} kg in an ordinary one: ` : 'Nothing: '}${feel}.</p>`;
}

// For a petition to herd: how short the flock is now, and who else is asking.
function herdNote(v, p) {
  const n = herdingNeed(v, p.house);
  const others = n.asking.length ? ` The house${n.asking.length > 1 ? 's' : ''} of ${n.asking.map((o) => esc(o.name)).join(' and ')} ${n.asking.length > 1 ? 'are' : 'is'} asking too.` : '';
  const now = `The flock of ${v.flock.head} needs ${n.needed} herder${n.needed === 1 ? '' : 's'}; ${n.out} ${n.out === 1 ? 'is' : 'are'} out with it now.`;
  if (!n.short) return `<p class="note"><b>${now} It has enough:</b> granting this would only cost the owners wages for men with nothing to do.${others}</p>`;
  const send = Math.min(n.men, n.short);
  return `<p class="note"><b>${now} It is short by ${n.short}.</b> They would send ${send} of their ${n.men} m${n.men === 1 ? 'an' : 'en'}${send < n.short ? `, leaving it still short by ${n.short - send}` : ''}; the rest go about their usual work.${others}</p>`;
}

// Households asking your leave: on the map, where you will see them.
function renderPetitions() {
  const v = app.v;
  const list = v.petitions || [];
  const box = $('petitions');
  const war = warCard(v) + civicCard(v) + disputeCards(v);
  box.hidden = !list.length && !war;
  if (!list.length) app.councilOpen = false;
  const shown = app.councilOpen ? list.length : war ? 2 : 3;
  const head = app.councilOpen && list.length ? `<p class="petition council-day"><b>Council day.</b> ${list.length} petition${list.length === 1 ? '' : 's'} to hear.</p>` : '';
  box.innerHTML = war + head + list.slice(0, shown).map((p) => {
    const h = v.households[p.house];
    const rivals = rivalsOf(v, p);
    const left = answerWithin(v) - (v.day - p.day);
    return `<div class="petition">
      <p><b>The house of ${esc(h.name)}</b> <span class="mood g${Math.round((h.goodwill ?? 0.6) * 4)}">${goodwillWord(h.goodwill ?? 0.6)}</span> asks your leave ${petitionText(p)}.</p>
      ${houseSummary(v, h)}
      <p class="note">${esc(p.why)}${rivals.length ? ` The house${rivals.length > 1 ? 's' : ''} of ${rivals.map((o) => esc(o.name)).join(' and ')} already cut${rivals.length > 1 ? '' : 's'} wood to sell, and would not welcome it.` : ''}</p>
      ${p.kind === 'clear' ? feeChoice(p) : p.kind === 'herd' ? herdNote(v, p) : ''}
      <div class="petition-actions"><button class="primary" data-grant="${p.id}">Grant${p.kind === 'clear' && feeOf(p) > 0 ? ` for ${pctText(feeOf(p))} of each harvest` : ''}</button><button data-refuse="${p.id}">Refuse</button><small>${left > 0 ? `${left} day${left === 1 ? '' : 's'} to answer` : 'answer today'}</small></div>
    </div>`;
  }).join('') + (list.length > shown ? `<p class="note more">and ${list.length - shown} more waiting${councilEvery(v) > 1 ? ', to be heard on the next council day' : ''}</p>` : '');
}

// ---- the demarch's business: quarrels and the deme's duties ----

// Quarrels brought to you to judge.
function disputeCards(v) {
  return (v.disputes || []).map((d) => {
    const left = DISPUTES.answer - (v.day - d.day);
    return `<div class="petition dispute"><p><b>${esc(d.title)}.</b> ${esc(d.text)}</p>
      <div class="petition-actions">${d.options.map((o, k) => `<button data-dispute="${d.id}:${k}" title="${esc(o.hint || '')}">${esc(o.label)}${o.hint ? ` <small>(${esc(o.hint)})</small>` : ''}</button>`).join('')}<small>${left > 0 ? `${left} day${left === 1 ? '' : 's'} before it festers` : 'answer today'}</small></div></div>`;
  }).join('');
}

// The liturgy laid on your house, or a festival to be kept.
function civicCard(v) {
  const c = v.civic;
  if (!c) return '';
  const left = CIVIC.answer - (v.day - c.day);
  const when = `<small>${left > 0 ? `${left} day${left === 1 ? '' : 's'} to answer` : 'answer today'}</small>`;
  if (c.kind === 'liturgy') {
    const o = c.other >= 0 ? v.households[c.other] : null;
    const dr = (k) => Math.round((c.cost * k) / CITY.drachma);
    return `<div class="petition summons"><p><b>The liturgy.</b> As the richest house in ${esc(v.name)}, yours is to pay for the chorus at the Rural Dionysia: the training, the costumes, the feast after. It is a burden and an honour.</p>
      <ul class="note"><li><b>Lavishly</b> (${dr(CIVIC.lavish)} drachmae): every house will think the better of you, and the city will hear of it.</li><li><b>As is due</b> (${dr(1)} drachmae).</li>${o ? `<li><b>Name the house of ${esc(o.name)} as richer</b>, and offer to exchange property with it if it refuses: if it is found so, it pays; if not, you pay more, and are shamed.</li>` : ''}</ul>
      <div class="petition-actions"><button class="primary" data-civic="lavish">Lavishly</button><button data-civic="due">As is due</button>${o ? '<button data-civic="antidosis">Name a richer man</button>' : ''}${when}</div></div>`;
  }
  const f = CIVIC.festivals[c.i];
  const line = (k) => {
    const x = festivalCost(v, c.i, k);
    return `${x.grain} kg of barley's worth from the houses by their means, ${x.sheep} sheep, ${x.wine} litres of wine`;
  };
  return `<div class="petition summons"><p><b>${esc(f.name.charAt(0).toUpperCase() + f.name.slice(1))}.</b> The deme keeps its festival: sacrifices, a procession, a feast. How grandly is for you to say; every house pays its share by its means.</p>
    <ul class="note">${Object.entries(FESTIVAL_SCALE).map(([k, s]) => `<li><b>${s.label}:</b> ${line(k)}.${s.gw > 0.03 ? ' Remembered for years.' : s.gw < 0 ? ' People will call it mean.' : ''}</li>`).join('')}</ul>
    <div class="petition-actions">${Object.entries(FESTIVAL_SCALE).map(([k, s]) => `<button${k === 'fitting' ? ' class="primary"' : ''} data-civic="${k}">${s.label}</button>`).join('')}${when}</div></div>`;
}

// ---- war ----

const pctText = (x) => `${Math.round(x * 100)}%`;

// The summons, the levy you choose and who it sends; then the army on the march and the battle.
function warCard(v) {
  const w = v.war;
  if (!w) return '';
  return captivesCard(v) + sackCard(v) + siegeCard(v) + fineCard(v) + levyCard(v);
}

// The enemy coming to Oinoe: to the hills, or the walls.
function sackCard(v) {
  const s = v.war.sack;
  if (!s) return '';
  const inside = aliveHouseholds(v).filter((h) => insideWall(v, v.land.houses[h.house])).length;
  const n = defenders(v).length;
  return `<div class="petition summons"><p><b>${s.army} Boeotians are coming to ${esc(v.name)}.</b> ${esc(s.why)}</p>
    <p class="note"><b>Flee to the hills:</b> everyone lives, but the town is razed: every house burned, the fields trampled, the flock, the oxen and the carts lost${v.smith ? ', the forge broken' : ''}. Each house keeps a tenth of what it has, buried in time, to rebuild with.</p>
    <p class="note"><b>Hold the walls:</b> everything outside them is lost: the fields, the flock, the oxen, ${aliveHouseholds(v).length - inside} house${aliveHouseholds(v).length - inside === 1 ? '' : 's'} outside the wall${v.smith ? ', the forge if it is outside' : ''}. Nobody leaves the walls until the autumn, when the army goes home to sow, or until it has lost too many men trying them. A man on the wall is worth ten below it: you have ${n} to man them against ${s.army}${s.army > 10 * n ? ', <b>too few to hold them</b>' : ''}.</p>
    <div class="petition-actions"><button class="primary" data-sack="walls">Hold the walls</button><button data-sack="flee">Flee to the hills</button><small>${Math.max(0, 2 - (v.day - s.day))} day${2 - (v.day - s.day) === 1 ? '' : 's'} to choose</small></div></div>`;
}

function siegeCard(v) {
  const s = v.siege;
  if (!s) return '';
  return `<div class="petition summons"><p><b>${esc(v.name)} is besieged.</b> ${s.army} Boeotians outside the walls, ${defenders(v).length} men on them. ${s.assaults ? `${s.assaults} assault${s.assaults > 1 ? 's' : ''} thrown back: they have lost ${s.lost}, we ${s.killed}.` : 'They have not yet tried the walls.'} They will go home in Pyanepsion, or sooner if they lose many more men. Nobody leaves the walls.</p></div>`;
}

// The city's fine: pay it, or refuse and see what the city does about it.
function fineCard(v) {
  const f = v.war.fine;
  if (!f) return '';
  const left = WAR.fineAnswer - (v.day - f.day);
  const d = v.war.defiance || 0;
  return `<div class="petition summons"><p><b>The city fines ${esc(v.name)} ${f.kg} kg of barley</b> for refusing ${esc(f.general)}' levy. The common granary holds ${Math.round(v.common.grain)} kg${v.common.grain < f.kg ? '; your own house would make up the rest' : ''}.</p>
    <p class="note">${d ? `You have refused the city ${d} time${d > 1 ? 's' : ''} already. ` : ''}A village that keeps defying the city may find it sends men to deal with its leading man.</p>
    <div class="petition-actions"><button class="primary" data-pay-fine="pay">Pay</button><button data-pay-fine="refuse">Refuse</button><small>${left > 0 ? `${left} day${left === 1 ? '' : 's'} to answer` : 'answer today'}</small></div></div>`;
}

// The people of a deme your men broke into: how it went, who is left, and what to do with them.
function captivesCard(v) {
  const q = v.war.captives;
  if (!q) return '';
  const what = {
    none: 'They are left as they are.',
    slaves: `Up to ${q.women} women and ${q.men} men, as slaves, to the houses of the men who went.`,
    brides: `Up to ${Math.min(q.women, q.grooms, q.young ?? q.women)} young women, as wives for the ${q.grooms} men of ${esc(v.name)} who have none, those who went first.`,
    both: `Up to ${q.women} women, wives for the men who have none (${q.grooms}) from the ${q.young ?? q.women} young women left, and slaves of the rest, and ${q.men} men as slaves.`,
  };
  return `<div class="petition summons"><p><b>${esc(q.place)} lies open to your men.</b> ${q.fell} of its men fell defending it${q.ourDead ? `, and ${q.ourDead} of ours fell in the fighting` : ', and none of ours'}${q.best ? `; ${esc(q.best.name)} did most, with ${q.best.kills} struck down` : ''}. Left alive there: ${q.left.men} men, ${q.left.women} women, ${q.left.children} children, ${q.left.old} old.${q.others && q.others.length ? ` The demes that brought more men than yours have chosen first: ${q.others.map(esc).join(' ')}` : ' Your men brought the most, and choose first.'}${q.after && q.after.length ? ` After you, ${q.after.map((t) => esc(t.name)).join(', then ')}.` : ''} What falls to the men of ${esc(v.name)}, by the share they were of the army, is theirs to take, or to leave.</p>
    <ul class="note">${Object.entries(CAPTIVES).map(([k, label]) => `<li><b>${label}.</b> ${what[k]}</li>`).join('')}</ul>
    <div class="petition-actions">${Object.entries(CAPTIVES).map(([k, label], i) => `<button${i ? '' : ' class="primary"'} data-captives-choice="${k}">${label}</button>`).join('')}<small>${Math.max(0, 3 - (v.day - q.day))} days, then they march home</small></div></div>`;
}

function levyCard(v) {
  const w = v.war;
  if (w.summons) {
    const s = w.summons;
    const plan = planLevy(v, app.levyShare);
    const fighters = plan.rows.reduce((a, r) => a + r.fighters, 0);
    const left = WAR.answer - (v.day - s.day);
    const name = (id) => esc(v.households[id].player ? 'yours' : v.households[id].name);
    const own = plan.rows.filter((r) => r.sends).map((r) => `${name(r.h)} ${r.sends}`).join(', ');
    const groups = plan.groups.map((g) => {
      const payers = g.members.filter((m) => m.pays);
      const all = [...new Set(g.members.map((m) => m.h))];
      if (!g.sends) return `<li>${all.map(name).join(', ')} owe ${g.sum.toFixed(1)} of a man between them, too little to send one; they are let off.</li>`;
      return `<li>${all.length > 1 ? `${all.map(name).join(', ')} club together: ` : ''}the house of ${name(g.sender)} sends a man${payers.length ? `, and ${payers.map((m) => `${name(m.h)} pays ${m.pays} kg`).join(', ')}` : ''}.</li>`;
    }).join('');
    const me = plan.men.map((id) => v.people[id]).find((p) => p.player);
    const son = sonToBring(v, plan);
    const bring = son && app.levySon;
    const going = plan.men.length + (bring ? 1 : 0);
    const read = yourRead(v, s);
    return `<div class="petition summons">
      <p><b>A summons from the strategos ${esc(s.general)}.</b> ${esc(s.reason.replace(/^./, (c) => c.toUpperCase()))}. He calls on ${esc(v.name)} for its share of men.</p>
      <div class="shares" role="group" aria-label="Share of the fighting men to send">${WAR.shares.map((x) => `<button data-share="${x}" aria-pressed="${Math.abs(x - app.levyShare) < 1e-6}">${pctText(x)}</button>`).join('')}</div>
      <p class="note">${esc(read.text)}</p>
      <p class="levy-total"><b>${going}</b> of ${fighters} fighting men go${plan.men.length ? `: ${plan.hoplites + (bring && son.shield === 'aspis' ? 1 : 0)} with the hoplite shield, ${plan.lights + (bring && son.shield !== 'aspis' ? 1 : 0)} light-armed` : ''}.${me ? ' You go with them.' : ''}</p>
      ${son ? `<label class="check"><input type="checkbox" data-levy-son${bring ? ' checked' : ''}> Take your son ${esc(son.name)} too, for the experience (the levy does not ask it of your house)</label>` : ''}
      ${plan.men.length ? `<details class="levy-who"><summary>Who sends whom</summary>
        <p class="note">Whole men: ${own || 'none'}.</p>
        ${groups ? `<ul class="note">${groups}</ul>` : ''}
        <p class="note">A household pays ${WAR.shareCost} kg for a whole man sent in its place, in grain or as a debt.</p></details>` : ''}
      <div class="petition-actions"><button class="primary" data-levy="1">${going ? `Send ${going} men` : 'Send no one'}</button><small>${left > 0 ? `${left} day${left === 1 ? '' : 's'} to answer` : 'answer today'}</small></div>
    </div>`;
  }
  const c = w.campaign;
  if (!c) return '';
  if (c.stage === 'marching') return `<div class="petition summons"><p><b>${c.men.length} men are on the march</b> to join ${esc(c.general)}. They reach the army in ${Math.max(1, c.battleDay - v.day)} day${c.battleDay - v.day === 1 ? '' : 's'}.</p></div>`;
  if (c.stage === 'battle') {
    const alive = c.men.filter((id) => v.people[id].alive).length;
    return `<div class="petition summons"><p><b>The army is drawn up facing the Boeotians.</b> Your ${alive} men are in ${esc(c.general)}' line.</p>
      <div class="petition-actions"><button class="primary" data-battle="1">Go to the field</button></div></div>`;
  }
  const last = w.history[w.history.length - 1];
  return `<div class="petition summons"><p><b>The men are coming home</b> from the battle${last && last.dead ? `, ${last.dead} fewer than went` : ''}.</p></div>`;
}

// The battle, in its own page on top of the village, which waits for it.
function openBattle() {
  const v = app.v;
  if (app.battle || !v.war.campaign || v.war.campaign.stage !== 'battle') return;
  const setup = battleSetup(v);
  setSpeed(0);
  const frame = document.createElement('iframe');
  frame.className = 'battle-frame';
  frame.title = 'The battle';
  if (typeof window.PULSY_BATTLE === 'string') frame.srcdoc = window.PULSY_BATTLE;
  else frame.src = 'index.html';
  $('battleBox').hidden = false;
  $('battleBox').appendChild(frame);
  app.battle = { frame, setup };
}

window.addEventListener('message', (e) => {
  const b = app.battle;
  if (!b || e.source !== b.frame.contentWindow || !e.data) return;
  if (e.data.type === 'battleReady') b.frame.contentWindow.postMessage({ type: 'campaign', config: b.setup.config, campaign: b.setup.campaign }, '*');
  if (e.data.type === 'battleOver') {
    applyBattle(app.v, e.data.result);
    b.frame.remove();
    $('battleBox').hidden = true;
    app.battle = null;
    save();
    renderPanels();
  }
});

function renderPanels() {
  renderPetitions();
  renderStores();
  renderHouseholds();
  renderCrews();
  renderInspector();
  renderLog();
}

// ---- orders ----

function sendTo(site) {
  const v = app.v;
  // Only men who can fight drill: a household's men sent there go, and its boys and old men stay
  // home; its women, and anyone chosen singly who cannot fight, are not sent at all.
  const drill = site && site.kind === 'drill';
  for (const { h, half } of app.sel.halves) if (!drill || half === 'm') order(v, v.households[h], half, site);
  // People sent singly: home puts them back with their household, doing as it does.
  for (const id of app.sel.people) {
    const p = v.people[id];
    if (drill && !isDrill(v, p)) continue;
    // Home is back with the household, doing as it does.
    assignPerson(v, p, site || null);
    const h = v.households[p.household];
    if (!h.player) addGoodwill(v, h, -COUNCIL.orderCost / 2);
  }
  app.sel.halves = [];
  app.sel.people = [];
  app.sel.site = site;
  app.sel.person = -1;
  app.sel.from = 'map';
  save();
  renderPanels();
}

document.addEventListener('change', (e) => {
  if (e.target.matches && e.target.matches('[data-levy-son]')) {
    app.levySon = e.target.checked;
    renderPetitions();
  }
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.pick) {
    const id = Number(t.dataset.pick);
    if (app.pick.has(id)) app.pick.delete(id);
    else app.pick.add(id);
    renderHouseholds();
  } else if (t.dataset.pickPerson) {
    const id = Number(t.dataset.pickPerson);
    const i = app.sel.people.indexOf(id);
    if (i >= 0) app.sel.people.splice(i, 1);
    else app.sel.people.push(id);
    app.sel.barAt = app.v.people[id].household;
    renderHouseholds();
    reveal('selBar');
  } else if (t.dataset.payFine) {
    answerFine(app.v, t.dataset.payFine === 'pay');
    save();
    renderPanels();
  } else if (t.dataset.dispute) {
    const [id, k] = t.dataset.dispute.split(':').map(Number);
    decideDispute(app.v, id, k);
    save();
    renderPanels();
  } else if (t.dataset.civic) {
    decideCivic(app.v, t.dataset.civic);
    save();
    renderPanels();
  } else if (t.dataset.captivesChoice) {
    decideCaptives(app.v, t.dataset.captivesChoice);
    save();
    renderPanels();
  } else if (t.dataset.sack) {
    chooseSack(app.v, t.dataset.sack);
    save();
    renderPanels();
  } else if (t.dataset.feeFor) {
    app.fees[Number(t.dataset.feeFor)] = Number(t.dataset.fee);
    renderPetitions();
  } else if (t.dataset.share) {
    app.levyShare = Number(t.dataset.share);
    renderPetitions();
  } else if (t.dataset.levy) {
    answerSummons(app.v, app.levyShare, false, app.levySon);
    app.levySon = false;
    save();
    renderPanels();
  } else if (t.dataset.battle) {
    openBattle();
  } else if (t.dataset.grant || t.dataset.refuse) {
    const id = Number(t.dataset.grant || t.dataset.refuse);
    const p = (app.v.petitions || []).find((x) => x.id === id);
    if (p && t.dataset.grant) grant(app.v, p, false, p.kind === 'clear' ? feeOf(p) : 0);
    else if (p) refuse(app.v, p);
    if (p) delete app.fees[p.id];
    save();
    renderPanels();
  } else if (t.dataset.clear || t.dataset.plan) {
    // Mark out the new work and send the chosen men and women straight to it.
    const x = t.dataset.clear ? planField(app.v, Number(t.dataset.clear)) : planHouse(app.v, Number(t.dataset.plan));
    if (x) sendTo({ kind: 'build', id: x.id });
  } else if (t.id === 'mapCardClose') {
    app.sel.person = -1;
    app.sel.site = null;
    renderInspector();
  } else if (t.dataset.half) {
    const h = Number(t.dataset.h);
    const half = t.dataset.half;
    const i = app.sel.halves.findIndex((x) => x.h === h && x.half === half);
    if (i >= 0) app.sel.halves.splice(i, 1);
    else app.sel.halves.push({ h, half });
    app.sel.barAt = h;
    renderHouseholds();
    reveal('selBar');
  } else if (t.dataset.hold) {
    const id = Number(t.dataset.hold);
    if (app.open.has(id)) app.open.delete(id);
    else app.open.add(id);
    renderHouseholds();
    renderInspector();
    reveal(`hold${id}`);
  } else if (t.dataset.person) {
    const id = Number(t.dataset.person);
    const from = t.dataset.from || 'map';
    const same = app.sel.person === id && app.sel.from === from;
    app.sel.person = same ? -1 : id;
    app.sel.site = null;
    app.sel.from = from;
    renderHouseholds();
    renderCrews();
    renderInspector();
    reveal('inlineCard');
  } else if (t.dataset.site) {
    const [kind, id] = t.dataset.site.split(':');
    const from = t.dataset.from || 'map';
    const same = app.sel.site && app.sel.site.kind === kind && app.sel.site.id === Number(id) && app.sel.from === from;
    app.sel.site = same ? null : { kind, id: Number(id) };
    app.sel.person = -1;
    app.sel.from = from;
    renderHouseholds();
    renderCrews();
    renderInspector();
    reveal('inlineCard');
  }
});

// Scroll the side panel just enough to bring something into view.
function reveal(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function speedText(s) {
  if (s >= 1) return `${s}×`;
  return `1/${Math.round(1 / s)}×`;
}

function setSpeed(s) {
  if (s > 0) app.lastSpeed = s;
  else app.skip = null;
  app.speed = s;
  showSpeed(s > 0 ? s : app.lastSpeed);
  $('pauseBtn').classList.toggle('paused', s === 0);
  $('pauseBtn').textContent = s === 0 ? '▶︎' : '‖';
  $('pauseBtn').setAttribute('aria-label', s === 0 ? 'Resume' : 'Pause');
}

function showSpeed(s) {
  $('speedLabel').textContent = app.skip ? '⏭' : app.auto ? (app.speed > 0 ? `Auto ${speedText(s)}` : 'Auto') : speedText(s);
  $('autoBtn').setAttribute('aria-pressed', String(app.auto));
  $('autoBtn').classList.toggle('on', app.auto);
}

// Choosing a speed yourself ends auto pace and any skip.
function manualSpeed(s) {
  app.auto = false;
  app.skip = null;
  setSpeed(s);
}

function nudgeSpeed(dir) {
  const list = CLOCK.speeds;
  const i = list.indexOf(app.lastSpeed);
  manualSpeed(list[Math.max(0, Math.min(list.length - 1, i + dir))]);
}

function resume() {
  if (app.v.over) return;
  app.councilOpen = false;
  setSpeed(app.lastSpeed);
}

function toggleAuto() {
  app.auto = !app.auto;
  app.skip = null;
  if (app.speed > 0) setSpeed(app.lastSpeed);
  else showSpeed(app.lastSpeed);
}

function skipOn() {
  app.skip = { until: app.v.day + CLOCK.skipDays };
  app.councilOpen = false;
  setSpeed(app.lastSpeed);
}

$('pauseBtn').addEventListener('click', () => (app.speed > 0 ? setSpeed(0) : resume()));
$('slower').addEventListener('click', () => nudgeSpeed(-1));
$('faster').addEventListener('click', () => nudgeSpeed(1));
$('speedLabel').addEventListener('click', () => manualSpeed(1));
$('autoBtn').addEventListener('click', toggleAuto);
$('skipBtn').addEventListener('click', skipOn);

// Auto pace slows down while there is something to watch: men out working the fields, or the
// village going hungry.
const FIELD_WORK = FIELD_TASKS;
function busy(v) {
  return !!v.hungry || !!v.siege || !!(v.war && (v.war.summons || v.war.fine || v.war.sack)) || v.people.some((p) => p.alive && FIELD_WORK.has(p.task) && p.state !== 'home');
}

// What the war asks of you now: a summons, a fine, the army drawn up for battle.
function warKey(v) {
  const w = v.war || {};
  return [w.summons ? 1 : 0, w.fine ? 1 : 0, w.campaign && w.campaign.stage === 'battle' ? 1 : 0, w.sack ? 1 : 0, w.captives ? 1 : 0].join('');
}

function paceNow(v) {
  if (app.skip) return CLOCK.skip;
  if (app.auto) return busy(v) ? CLOCK.auto.busy : CLOCK.auto.quiet;
  return app.speed;
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (app.speed > 0) setSpeed(0);
    else resume();
  } else if (PAN_KEYS[e.code]) {
    e.preventDefault();
    panHeld.add(e.code);
  } else if (e.key === 't' || e.key === 'T') toggleAuto();
  else if (e.key === 'n' || e.key === 'N') skipOn();
  else if (e.key === '-' || e.key === ',') nudgeSpeed(-1);
  else if (e.key === '+' || e.key === '=' || e.key === '.') nudgeSpeed(1);
});

// The council: your standing answers to each kind of petition.
function renderCouncil() {
  const v = app.v;
  v.rules = v.rules || {};
  const every = councilEvery(v);
  $('councilEvery').innerHTML = COUNCIL.councilChoices.map((n) => `<option value="${n}"${n === every ? ' selected' : ''}>${n === 1 ? 'as they come' : n === 30 ? 'once a month' : `every ${n} days`}</option>`).join('');
  $('councilEvery').onchange = () => {
    v.councilEvery = Number($('councilEvery').value);
    save();
    renderPetitions();
  };
  let group = '';
  $('councilRules').innerHTML = RULES.map((r) => {
    const head = r.group !== group ? `<h3>${r.group}</h3>` : '';
    group = r.group;
    const cur = v.rules[r.key] || 'ask';
    const choices = [['ask', 'Ask me'], ['grant', r.fee ? 'Always grant, free' : 'Always grant'], ...(r.fee ? [['grantFee', 'Grant for the usual rent']] : []), ['refuse', 'Always refuse']];
    return `${head}<label class="row">${r.text}<select data-rule="${r.key}">${choices.map(([k, label]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
  }).join('');
  document.querySelectorAll('[data-rule]').forEach((s) => {
    s.onchange = () => {
      v.rules[s.dataset.rule] = s.value;
      save();
    };
  });
}

// Your projects, and the village's: who is working on each, and the hands it hires.
function renderProjects() {
  const v = app.v;
  const me = v.households.find((h) => h.player);
  const list = (v.projects || []).filter((x) => x.done.work < x.needs.work);
  const mine = list.filter((x) => me && x.sponsor === me.id);
  const others = list.filter((x) => !me || x.sponsor !== me.id);
  const pct = (x) => Math.round((100 * x.done.work) / x.needs.work);
  const crewText = (x) => {
    const { own, hired } = crewAt(v, x);
    return `${own.length} of the house's own${hired.length ? `, ${hired.length} hired` : ''} working today`;
  };
  const card = (x) => {
    const hire = hireOf(x);
    const { hired } = crewAt(v, x);
    const cost = hired.length * ECONOMY.wage;
    const warn = hire.from === 'common' && !x.public ? ' The other houses will mind the village\'s grain going on your own work, and think the less of you for every kg spent.' : '';
    return `<div class="house-summary">
      <p><b>${esc(x.name)}</b>: ${pct(x)}% done. ${crewText(x)}.</p>
      <label class="row"><span><input type="checkbox" data-hire-on="${x.id}"${hire.on ? ' checked' : ''}> Hire hands</span>
        <select data-hire-cap="${x.id}"${hire.on ? '' : ' disabled'}>${[1, 2, 3, 4, 6, 8, 10, 12, 16].map((n) => `<option value="${n}"${n === hire.cap ? ' selected' : ''}>up to ${n} men in all</option>`).join('')}</select></label>
      <label class="row">Pay them from<select data-hire-from="${x.id}"${hire.on ? '' : ' disabled'}><option value="house"${hire.from === 'house' ? ' selected' : ''}>your house's grain</option><option value="common"${hire.from === 'common' ? ' selected' : ''}>the common granary</option></select></label>
      <p class="note">${hired.length ? `About ${cost} kg of barley a day in wages.` : hire.on ? 'Nobody hired today: men are hired only when the village\'s fields are done and there is grain to pay them.' : 'Not hiring.'}${warn}</p>
    </div>`;
  };
  // New land for your own house: marked out here, and your men sent to it.
  const wild = freeWild(v);
  const clearing = me && mine.some((x) => x.kind === 'field');
  const newLand = !me ? '' : wild < 0 ? '<p class="note">There is no rough ground left near enough to clear for a field.</p>'
    : `<p class="note">${clearing ? 'Your house is already clearing a field; you can mark out another. ' : ''}${v.land.wild[wild].ha.toFixed(1)} ha of rough ground ${(v.land.wild[wild].dist / 1000).toFixed(1)} km out, about ${Math.round(BUILD.field.work * v.land.wild[wild].ha)} days' work. Your house pays the wages of anyone else's people who work on it, and keeps the brushwood and stones. New land on the margins yields a little less than the old fields.</p>
      <div class="actions"><button data-clear-mine="send">Clear it, and send your men</button><button data-clear-mine="mark">Only mark it out</button></div>`;
  $('projectsList').innerHTML = (mine.length ? `<h3>Yours</h3>${mine.map(card).join('')}` : '<p class="note">You have no work in hand.</p>')
    + (me ? `<h3>New land for your house</h3>${newLand}` : '')
    + (me ? plantingPanel(v, me) : '')
    + (others.length ? `<h3>The other houses'</h3>${others.map((x) => `<p class="note"><b>${esc(x.name)}</b>: ${pct(x)}% done. ${crewText(x)}${hireOf(x).on ? '' : '; not hiring'}.</p>`).join('')}` : '')
    + (me ? publicPanel(v) + cityPanel(v, me) : '');
  const proj = (el, key) => (v.projects || []).find((x) => x.id === Number(el.dataset[key]));
  document.querySelectorAll('[data-hire-on]').forEach((el) => { el.onchange = () => { hireOf(proj(el, 'hireOn')).on = el.checked; save(); renderProjects(); }; });
  document.querySelectorAll('[data-hire-cap]').forEach((el) => { el.onchange = () => { hireOf(proj(el, 'hireCap')).cap = Number(el.value); save(); renderProjects(); }; });
  document.querySelectorAll('[data-plant]').forEach((el) => {
    el.onclick = () => {
      const [where, crop] = el.dataset.plant.split(':');
      const x = where === 'new' ? planClearing(v, me.id, crop) : planPlanting(v, me.id, Number(where), crop);
      if (x) order(v, me, 'm', { kind: 'build', id: x.id });
      save();
      renderProjects();
      renderPanels();
    };
  });
  document.querySelectorAll('[data-clear-mine]').forEach((el) => {
    el.onclick = () => {
      const x = planField(v, me.id);
      if (x && el.dataset.clearMine === 'send') order(v, me, 'm', { kind: 'build', id: x.id });
      save();
      renderProjects();
      renderPanels();
    };
  });
  document.querySelectorAll('[data-public]').forEach((el) => {
    el.onclick = () => {
      if (el.dataset.public === 'tower') planTower(v, me.id);
      else planWall(v, me.id);
      save();
      renderProjects();
      renderPanels();
    };
  });
  const auto = $('cityAuto');
  if (auto) auto.onchange = () => { v.cityAuto = auto.checked; save(); };
  const sk = $('sheepKeep');
  if (sk) sk.onchange = () => { v.sheepKeep = Number(sk.value); save(); renderProjects(); };
  const sa = $('sellAuto');
  if (sa) sa.onchange = () => { v.sellAuto = sa.checked; save(); };
  const sg = $('sellGo');
  if (sg) sg.onclick = () => { me.sellNow = true; save(); renderProjects(); };
  document.querySelectorAll('[data-stock]').forEach((el) => {
    el.onclick = () => {
      const [kind, n] = el.dataset.stock.split(':');
      me.stock = me.stock || [];
      const had = me.stock.find((o) => o.kind === kind);
      if (had && kind === 'sheep') had.n += Number(n);
      else if (!had) me.stock.push(kind === 'sheep' ? { kind, n: Number(n) } : { kind });
      save();
      renderProjects();
    };
  });
  document.querySelectorAll('[data-cancel-stock]').forEach((el) => {
    el.onclick = () => { me.stock.splice(Number(el.dataset.cancelStock), 1); save(); renderProjects(); };
  });
  const go = $('cityGo');
  if (go) go.onclick = () => { me.cityNow = true; save(); renderProjects(); };
  document.querySelectorAll('[data-order-man]').forEach((el) => {
    el.onclick = () => {
      const sel = document.querySelector(`[data-order-for="${el.dataset.orderMan}"]`);
      if (!sel || !sel.value) return;
      const [piece, item] = sel.value.split(':');
      me.orders = me.orders || [];
      me.orders.push({ man: Number(el.dataset.orderMan), piece, item });
      save();
      renderProjects();
    };
  });
  document.querySelectorAll('[data-cancel-order]').forEach((el) => {
    el.onclick = () => { me.orders.splice(Number(el.dataset.cancelOrder), 1); save(); renderProjects(); };
  });
  document.querySelectorAll('[data-hire-from]').forEach((el) => { el.onchange = () => { hireOf(proj(el, 'hireFrom')).from = el.value; save(); renderProjects(); }; });
}

// Public works: raised for the whole village, paid out of the common granary without anyone
// minding. Started here; once started they are listed with your projects above.
// Vines and olives for your own house: what you have, and land you could give over to them.
function plantingPanel(v, me) {
  const year = Math.floor(v.day / 360);
  const own = v.land.fields.filter((f) => f.owner === me.id);
  const have = own.filter((f) => f.kind);
  const fallow = own.filter((f) => !f.kind && f.state === 'stubble' && f.rotation !== year % 2 && !(f.sheaves > 0));
  const o = ORCHARD;
  const planting = (v.projects || []).some((x) => x.sponsor === me.id && (x.kind === 'plant' || (x.kind === 'field' && x.crop)));
  return `<h3>Vines and olives</h3>
    <p class="note">${have.length ? `You have ${have.map((f) => `${esc(f.name)}, ${f.ha.toFixed(1)} ha of ${f.kind} (${bearing(v, f) >= 1 ? 'in full bearing' : bearing(v, f) > 0 ? 'coming into bearing' : 'not yet bearing'})`).join('; ')}.` : 'You have no vines or olives.'} Vines bear after ${o.vines.bears} years and are in full bearing after ${o.vines.full}, about ${o.vines.yield} litres of wine a hectare; olives bear after ${o.olives.bears} years and come fully into their own after ${o.olives.full}, about ${o.olives.yield} kg of oil a hectare, heavier one year and lighter the next. Planting takes ${o.vines.plant} days' work a hectare for vines, ${o.olives.plant} for olives; tending them ${o.vines.tend.reduce((a, t) => a + t.days, 0) + o.vines.gather.days} and ${o.olives.tend.reduce((a, t) => a + t.days, 0) + o.olives.gather.days} days a hectare a year, much of it in the autumn and winter when the barley wants little. Wine fetches ${(v.prices.wine ?? 1).toFixed(2)} kg of barley a litre at the gate, oil ${(v.prices.oil ?? 3.3).toFixed(2)} a kg.</p>
    ${planting ? '<p class="note">Your house is planting already.</p>' : `${fallow.length ? `<p class="note">Your fields lying fallow this year can be planted:</p>${fallow.map((f) => `<div class="actions"><span class="note">${esc(f.name)}, ${f.ha.toFixed(1)} ha</span><button data-plant="${f.id}:vines">Plant vines</button><button data-plant="${f.id}:olives">Plant olives</button></div>`).join('')}` : ''}
    ${freeWild(v) >= 0 ? `<div class="actions"><button data-plant="new:vines">Clear new land for vines</button><button data-plant="new:olives">Clear new land for olives</button></div>` : ''}`}`;
}

function publicPanel(v) {
  const doing = (k) => (v.projects || []).some((x) => x.kind === k);
  const wage = ECONOMY.wage;
  const tower = v.tower ? '<p class="note">The watchtower on the hill toward Boeotia is built.</p>'
    : doing('tower') ? '' : `<p class="note">A watchtower on the hill toward Boeotia: ${PUBLIC.tower.work} days' work, about ${PUBLIC.tower.work * wage} kg in wages.</p><div class="actions"><button data-public="tower">Mark out a watchtower</button></div>`;
  let wall = '';
  if (!doing('wall')) {
    if (wallWanted(v)) {
      const len = Math.round(wallLength(curtainWall(v)));
      const work = Math.round(len * PUBLIC.wall.perMetre);
      wall = `<p class="note">A curtain wall round every house there is now, outside the old wall: ${len} m, ${work} days' work, about ${work * wage} kg in wages. If the enemy comes to Oinoe, only what is inside the walls can be held.</p><div class="actions"><button data-public="wall">Mark out a curtain wall</button></div>`;
    } else wall = '<p class="note">Every house stands inside the wall. New houses are built outside it; once there are some, a curtain wall can be raised round them.</p>';
  }
  return `<h3>Public works</h3><p class="note">Paid for from the common granary (${Math.round(v.common.grain)} kg in it), which is what it is for: nobody minds. Men are hired at the usual wage, up to ${PUBLIC.cap} at a time unless you set otherwise above.</p>${tower}${wall}`;
}

// Your tools, the smith, and the trip to the city: what to bring back, and kit to order for your
// men.
function cityPanel(v, me) {
  const t = toolsOf(me);
  const smith = hasSmith(v);
  const mul = cityPrice(v, 100);
  const out = (v.trips || []).filter((x) => x.house === me.id);
  const men = me.members.map((id) => v.people[id]).filter((p) => p.alive && canFight(v, p) && p.weapon);
  const options = (p) => ['shield', 'helmet', 'armour', 'greaves'].map((piece) => {
    const item = upgradeOf(p, piece);
    if (!item || (piece !== 'shield' && p.shield !== 'aspis') || (me.orders || []).some((o) => o.man === p.id && o.piece === piece)) return '';
    return `<option value="${piece}:${item}">${KIT_NAMES[item]}, ${kitPrice(v, piece, item)} kg</option>`;
  }).join('');
  const orders = me.orders || [];
  return `<h3>Your tools</h3>
    <p class="note">${Object.keys(TOOLS.names).map((k) => `${TOOLS.names[k]}: <b>${toolWord(t[k])}</b>`).join(' · ')}</p>
    <p class="note">${smith ? `The smith, ${esc(v.people[v.smith.man].name)}, mends them once they are worn, for ${SMITH.mend.price} kg, and makes new ones for ${SMITH.make.price} kg.` : `There is no smith in the village: tools are bought new in Athens, ${CITY.days} days there and back, once they are worn out or broken.`}</p>
    <h3>The city</h3>
    <p class="note">With the city, ${esc(v.name)} is <b>${standingWord(v.war ? v.war.standing : 0.5)}</b>: its prices are ${mul}% of the usual. A new sickle costs ${cityPrice(v, CITY.tool.sickle)} kg there, iron ${cityPrice(v, CITY.iron * 10) / 10} kg a kg.</p>
    ${out.length ? `<p class="note"><b>On the road now:</b> ${out.map((x) => `${x.men.map((id) => esc(v.people[id].name)).join(' and ')}, for ${esc(x.items.map(describe).join(', '))}; home in ${Math.max(1, x.back - v.day)} days`).join('. ')}.</p>` : ''}
    <label class="row"><span><input type="checkbox" id="cityAuto"${v.cityAuto !== false ? ' checked' : ''}> Your house goes to the city when it needs to</span></label>
    ${out.length ? '' : `<div class="actions"><button id="cityGo"${me.cityNow ? ' disabled' : ''}>${me.cityNow ? 'Setting out at dawn' : 'Send to the city now'}</button></div>`}
    <h3>Beasts, carts and slaves</h3>
    <p class="note">You have ${me.sheep} sheep${v.yokes.some((y) => y.owner === me.id) ? ', a yoke of oxen' : ''}${v.cartOwners.includes(me.id) ? ', a cart' : ''}${slavesOf(v, me) ? `, ${slavesOf(v, me)} slave${slavesOf(v, me) === 1 ? '' : 's'}` : ''}, and ${Math.round(me.stores.coin || 0)} drachmae (a drachma is ${CITY.drachma} kg of barley). Bought in the city, they walk home with the men. ${(me.behind || 0) >= 0.1 ? ` Lately your house has left about ${me.behind.toFixed(1)} ha's worth of its work undone.` : ''} The other houses buy a slave when their own work goes undone for want of hands, and they can spare the price.</p>
    ${(me.stock || []).length ? `<p class="note">To buy on the next trip: ${me.stock.map((o, i) => `${o.kind === 'sheep' ? `${o.n} sheep` : o.kind === 'yoke' ? 'a yoke of oxen' : o.kind === 'slave' ? 'a slave' : 'a cart'} <button class="linkish" data-cancel-stock="${i}">cancel</button>`).join('; ')}.</p>` : ''}
    <div class="actions">
      <button data-stock="sheep:5">5 sheep, ${cityPrice(v, CITY.beasts.sheep * 5)} kg</button>
      <button data-stock="sheep:15">15 sheep, ${cityPrice(v, CITY.beasts.sheep * 15)} kg</button>
      ${v.yokes.some((y) => y.owner === me.id) ? '' : `<button data-stock="yoke">A yoke of oxen, ${cityPrice(v, CITY.beasts.yoke)} kg</button>`}
      ${v.cartOwners.includes(me.id) ? '' : `<button data-stock="cart">A cart, ${cityPrice(v, CITY.beasts.cart)} kg</button>`}
      ${(me.stock || []).some((o) => o.kind === 'slave') ? '' : `<button data-stock="slave">A slave, ${cityPrice(v, CITY.slave)} kg</button>`}
    </div>
    <h3>Selling in the city</h3>
    <p class="note">The city pays coin for barley, wool, cloth and sheep: ${Math.round(CITY.sells * (200 - mul))}% of what they are worth at home, as it regards ${esc(v.name)}. Coin keeps: a house that has to flee buries it and keeps most of it.${sellable(v, me).length ? ` Yours to spare: ${sellable(v, me).map((g) => g.good === 'sheep' ? `${g.kg} sheep` : `${Math.round(g.kg)} kg ${g.good}`).join(', ')}.` : ' You have nothing to spare.'}</p>
    <label class="row">Keep a flock of<select id="sheepKeep">${[...new Set([0, 5, 10, 15, 20, 30, 40, 60, 80, 120, sheepKeep(v, me)])].sort((a, b) => a - b).map((n) => `<option value="${n}"${n === sheepKeep(v, me) ? ' selected' : ''}>${n} head</option>`).join('')}</select></label>
    <p class="note">You have ${me.sheep}. Any over that are driven to the city with the rest of your surplus. The other houses keep a flock by their means, and sell when they have a quarter more than that.</p>
    <label class="row"><span><input type="checkbox" id="sellAuto"${v.sellAuto !== false ? ' checked' : ''}> Your house sells its surplus in the city when it has a good deal of it</span></label>
    ${sellable(v, me).length ? `<div class="actions"><button id="sellGo"${me.sellNow ? ' disabled' : ''}>${me.sellNow ? 'Setting out at dawn' : 'Take the surplus to sell now'}</button></div>` : ''}
    <h3>Kit to order from the city</h3>
    ${orders.length ? `<p class="note">Ordered, to be brought back on the next trip: ${orders.map((o, i) => `${KIT_NAMES[o.item]} for ${esc(v.people[o.man].name)} (${kitPrice(v, o.piece, o.item)} kg) <button class="linkish" data-cancel-order="${i}">cancel</button>`).join('; ')}.</p>` : ''}
    ${men.map((p) => {
      const opts = options(p);
      return opts ? `<label class="row">${esc(p.name)}<span><select data-order-for="${p.id}">${opts}</select> <button data-order-man="${p.id}">Order</button></span></label>` : '';
    }).join('') || '<p class="note">Your men have the best kit there is.</p>'}`;
}

// The neighbouring demes and the Boeotian peoples, as they now are.
function renderNeighbours() {
  const v = app.v;
  initNeighbours(v);
  const row = (d) => {
    const s = Math.round(strengthOf(v, d.name) * 100);
    const news = d.news && d.news.length ? ` <i>${esc(d.news[0].text)}</i>` : '';
    const terms = ` <span class="mood g${Math.round((d.regard ?? 0.6) * 4)}">${regardWord(d.regard ?? 0.6)}</span>${d.feud > 0.15 ? ' <b>bad blood</b>' : ''}${d.undercut ? ` <b>selling ${d.undercut.good} under Oinoe</b>` : ''}`;
    return `<p class="note"><b>${esc(d.side === 'boeotia' ? `${d.name}, of ${d.town}` : d.name)}</b>${terms}: ${peopleOfDeme(d)} people; ${d.men} men of fighting age (${s}% of what it had), ${d.women} women, ${d.boys + d.girls} children; ${d.sheep} sheep${d.burned ? '; <b>its fields burned this year</b>' : ''}.${d.slaves ? ` ${d.slaves} slave${d.slaves === 1 ? '' : 's'}.` : ''}${d.year ? ` Last year ${d.year.born} born, ${d.year.died} died.` : ''}${d.unwedWomen ? ` ${d.unwedWomen} girl${d.unwedWomen === 1 ? '' : 's'} to marry.` : ''}${news}</p>`;
  };
  const ds = Object.values(v.demes);
  const m = v.market || { oil: 1, wine: 1 };
  $('neighboursList').innerHTML = `<p class="note">In Athens oil fetches ${Math.round(m.oil * 100)}% of its usual price this year, and wine ${Math.round(m.wine * 100)}%, as the demes bring in more or less of it; your dealer pays ${athensPrice(v, 'oil').toFixed(2)} kg of barley's worth a kg of oil and ${athensPrice(v, 'wine').toFixed(2)} a litre of wine before his cut.</p><h3>The Athenian demes</h3>${ds.filter((d) => d.side === 'athens').map(row).join('')}<h3>The Boeotians</h3>${ds.filter((d) => d.side === 'boeotia').map(row).join('')}`;
}

$('neighboursBtn').addEventListener('click', () => {
  renderNeighbours();
  $('councilBox').hidden = true;
  $('projectsBox').hidden = true;
  $('neighboursBox').hidden = !$('neighboursBox').hidden;
});
$('neighboursClose').addEventListener('click', () => { $('neighboursBox').hidden = true; });

$('projectsBtn').addEventListener('click', () => {
  renderProjects();
  $('councilBox').hidden = true;
  $('projectsBox').hidden = !$('projectsBox').hidden;
});
$('projectsClose').addEventListener('click', () => { $('projectsBox').hidden = true; });

$('councilBtn').addEventListener('click', () => {
  renderCouncil();
  $('projectsBox').hidden = true;
  $('councilBox').hidden = !$('councilBox').hidden;
});
$('councilClose').addEventListener('click', () => { $('councilBox').hidden = true; });

// Founding a village: you choose your name.
function askFounding(first) {
  $('foundBox').hidden = false;
  $('foundCancel').hidden = first;
  $('foundName').value = '';
  $('foundName').focus();
}

$('newBtn').addEventListener('click', () => askFounding(false));
$('foundCancel').addEventListener('click', () => { $('foundBox').hidden = true; });
$('foundForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('foundName').value.trim().replace(/\s+/g, ' ').slice(0, 24);
  const name = raw ? raw[0].toUpperCase() + raw.slice(1) : 'Philon';
  $('foundBox').hidden = true;
  start(createVillage((Math.random() * 2 ** 31) >>> 0, name));
  setSpeed(1);
  save();
});

// ---- the map ----

const canvas = $('map');
const ctx = canvas.getContext('2d');
let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, cx: app.cam.x, cy: app.cam.y, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  if (drag.moved) {
    app.cam.x = drag.cx - dx / app.cam.scale;
    app.cam.y = drag.cy - dy / app.cam.scale;
  }
});
canvas.addEventListener('pointerup', (e) => {
  const was = drag;
  drag = null;
  if (!was || was.moved) return;
  const r = canvas.getBoundingClientRect();
  const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
  const land = toLand(app.cam, r.width, r.height, pt);
  const v = app.v;
  const site = siteAt(v, land);
  const inVillage = Math.hypot(land.x, land.y) < 90;
  if (app.sel.halves.length) {
    if (site) sendTo(site);
    else if (inVillage) sendTo(null);
    return;
  }
  const p = pickPerson(v, app.cam, r.width, r.height, pt);
  app.sel.from = 'map';
  if (p) {
    app.sel.person = p.id;
    app.sel.site = null;
  } else {
    app.sel.person = -1;
    app.sel.site = site;
  }
  renderHouseholds();
  renderCrews();
  renderInspector();
});
// What is under the pointer, in a word or two: whose house, which field, what the small things on
// the ground are.
function describeAt(v, land, pt, r) {
  const near = (p, m) => Math.hypot(land.x - p.x, land.y - p.y) < Math.max(m, 6 / app.cam.scale);
  const p = pickPerson(v, app.cam, r.width, r.height, pt);
  if (p) {
    const h = v.households[p.household];
    return `<b>${esc(p.name)}</b>, ${ageOf(v, p)}, of the house of ${esc(h.name)}${h.player ? ' (yours)' : ''}<br>${personText(v, p)}`;
  }
  for (const [i, hs] of v.land.houses.entries()) {
    if (Math.abs(land.x - hs.x) > hs.w / 2 + 1 || Math.abs(land.y - hs.y) > hs.h / 2 + 1) continue;
    const h = aliveHouseholds(v).find((o) => o.house === i);
    const x = (v.projects || []).find((o) => o.kind === 'house' && o.plot === i);
    const where = insideWall(v, hs) ? 'inside the wall' : 'outside the wall';
    if (h) return `<b>${hs.great ? 'The great house' : `The house of ${esc(h.name)}`}</b>${h.player ? ' (yours)' : ''}<br>${h.members.filter((id) => v.people[id].alive).length} people, ${where}`;
    if (x) return `<b>${esc(x.name)}</b>, being built: ${Math.round((100 * x.done.work) / x.needs.work)}% done`;
    if (hs.built) return `<b>An empty house</b>, ${where}`;
    return `<b>A plot for a new house</b>, ${where}`;
  }
  for (const h of aliveHouseholds(v)) {
    if (near(woodpileOf(v, h.id), 4)) return `<b>The woodpile of the house of ${esc(h.name)}</b><br>${Math.round(h.stores.wood)} kg of firewood${h.stores.stone ? `, ${Math.round(h.stores.stone)} kg of stone` : ''}`;
  }
  const L = v.land;
  if (near(L.well, 4)) return '<b>The well</b>';
  if (near(L.washing, 6)) return '<b>The washing place</b>, on the stream';
  if (near(L.threshing, L.threshing.r + 2)) return '<b>The threshing floor</b>, where the reaped barley is threshed';
  if (Math.abs(land.x - L.fold.x) < 16 && Math.abs(land.y - L.fold.y) < 12) return `<b>The fold</b>, where the flock (${v.flock.head} head) is penned at night`;
  if (near(L.woodpile, 8)) return '<b>The cart yard</b>, where carts unload wood outside the gate';
  if (near(L.gate, 6)) return '<b>The gate</b>';
  const site = siteAt(v, land);
  if (site && site.kind === 'field') {
    const f = L.fields[site.id];
    const owner = f.owner >= 0 ? v.households[f.owner] : null;
    return `<b>Field ${f.id + 1}</b>, ${f.ha.toFixed(1)} ha, ${owner ? `the house of ${esc(owner.name)}'s` : 'the village\'s'}<br>${esc(f.kind ? `${f.kind}${f.state === 'ripe' ? ', ripe' : ''}` : f.state === 'stubble' && f.rotation !== Math.floor(v.day / 360) % 2 ? 'fallow' : f.state)}${f.rent ? ` · rent to you: ${Math.round(f.rent.share * 100)}% of each harvest` : ''}`;
  }
  if (site) return `<b>${esc(siteLabel(v, site)).replace(/^./, (c) => c.toUpperCase())}</b>`;
  return '';
}

canvas.addEventListener('pointermove', (e) => {
  const tip = $('mapTip');
  if (drag || e.pointerType === 'touch') {
    tip.hidden = true;
    return;
  }
  const r = canvas.getBoundingClientRect();
  const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
  const html = describeAt(app.v, toLand(app.cam, r.width, r.height, pt), pt, r);
  tip.hidden = !html;
  if (!html) return;
  tip.innerHTML = html;
  // Beside the pointer, kept inside the map.
  tip.style.left = `${Math.min(pt.x + 14, r.width - tip.offsetWidth - 6)}px`;
  tip.style.top = `${Math.min(pt.y + 14, r.height - tip.offsetHeight - 6)}px`;
});
canvas.addEventListener('pointerleave', () => { $('mapTip').hidden = true; });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}, { passive: false });

function zoomAt(pt, f) {
  const r = canvas.getBoundingClientRect();
  const before = toLand(app.cam, r.width, r.height, pt);
  app.cam.scale = Math.max(0.05, Math.min(12, app.cam.scale * f));
  const after = toLand(app.cam, r.width, r.height, pt);
  app.cam.x += before.x - after.x;
  app.cam.y += before.y - after.y;
}
$('zoomIn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1.5));
$('zoomOut').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1 / 1.5));
$('home').addEventListener('click', () => fitCamera(app.cam, canvas.clientWidth, canvas.clientHeight));

// Labels for the places people are working today.
function labels(v) {
  const out = [];
  const at = new Map();
  for (const p of v.people) {
    if (!p.alive || (p.state !== 'working' && p.state !== 'out')) continue;
    let key;
    let pos;
    const close = app.cam.scale > 0.45;
    if (p.field != null && FIELD_TASKS.has(p.task) && p.task !== 'thresh' && close) {
      const f = v.land.fields[p.field];
      key = `f${f.id}`;
      pos = { x: f.x, y: f.y - f.h / 2 };
    } else if (p.field != null && FIELD_TASKS.has(p.task)) {
      // From far off, all the field work is one label.
      key = 'fields';
      pos = v.land.farm;
    } else {
      const s = siteOfPerson(v, p);
      if (!s) continue;
      const site = siteOf(v, s);
      if (!site || !TASKS[p.task]) continue;
      key = `${s.kind}${s.id}`;
      pos = { x: site.x, y: site.y - (site.r || (site.h ? site.h / 2 : 0)) };
    }
    if (!at.has(key)) at.set(key, { at: pos, n: 0, task: key === 'fields' ? 'farm' : p.task });
    at.get(key).n++;
  }
  for (const l of at.values()) out.push({ at: l.at, text: `${TASKS[l.task].text[0].toUpperCase()}${TASKS[l.task].text.slice(1)} · ${l.n}` });
  return out;
}

// WASD (or the arrow keys) move the view over the land while held.
const PAN_KEYS = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const panHeld = new Set();
window.addEventListener('keyup', (e) => panHeld.delete(e.code));
window.addEventListener('blur', () => panHeld.clear());

let pal = null;
let last = performance.now();
// Each frame: the village moves on and the screen follows. Whatever goes wrong in one frame is
// reported and the next frame carries on, so the village never freezes.
function frame(now) {
  requestAnimationFrame(frame);
  try {
    tick(now);
  } catch (e) {
    console.error(e);
  }
}

function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const v = app.v;
  for (const code of panHeld) {
    const [dx, dy] = PAN_KEYS[code];
    const step = (0.6 * canvas.clientWidth * dt) / app.cam.scale;
    app.cam.x += dx * step;
    app.cam.y += dy * step;
  }
  let pace = 0;
  if (app.speed > 0 && !app.battle) {
    pace = paceNow(v);
    const dayBefore = v.day;
    stepVillage(v, dt * pace * hoursPerSecond(v));
    if (app.auto && !app.skip) showSpeed(pace);
    // News that needs you stops the clock: always when you are skipping ahead to it, otherwise if
    // you have asked for it. Petitions wait for the council day, unless you hear them as they come.
    const every = councilEvery(v);
    const stopFor = (e) => e.pause && (app.skip || $('autopause').checked) && !(e.kind === 'petition' && every > 1);
    let stop = false;
    for (const e of v.log) if (e.seq > app.logSeen && stopFor(e)) stop = true;
    // A call to war, a fine, or the army drawn up for battle always stops the clock: they need an
    // answer from you, and at speed they would be gone before you saw them.
    const wk = warKey(v);
    if (wk !== app.warKey && /1/.test(wk)) stop = true;
    app.warKey = wk;
    // A council day, with petitions waiting.
    if (every > 1 && (v.petitions || []).length && (app.skip || $('autopause').checked)) {
      for (let d = dayBefore + 1; d <= v.day; d++) {
        if (d % every !== 0) continue;
        stop = true;
        app.councilOpen = true;
        renderPetitions();
      }
    }
    if (app.skip && v.day >= app.skip.until) stop = true;
    if (stop) setSpeed(0);
    if (v.over) showOver(v);
    if ((v.logSeq || 0) !== app.logSeen) {
      renderLog();
      renderPetitions();
    }
    app.logSeen = v.logSeq || 0;
  }
  if (v.day !== app.day) {
    app.day = v.day;
    renderPanels();
    if (!$('projectsBox').hidden) renderProjects();
    save();
  }
  $('date').textContent = `${dateText(v)} · ${timeText(v)}`;
  // What the chosen person, or place, is doing now.
  if (now - app.inspectedAt > 250 && (app.sel.person >= 0 || app.sel.site)) {
    app.inspectedAt = now;
    renderInspector();
  }
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    pal = null;
  }
  if (!pal) pal = readVillagePalette(document.documentElement);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  app.sel.labels = labels(v);
  // At high speeds the days flash by; leave the land in daylight.
  app.sel.noNight = (pace || app.speed) > 8;
  drawVillage(ctx, v, app.cam, w, h, pal, app.sel);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { pal = null; });

// A saved village carries on; otherwise found a new one, under a name you choose. The village
// behind the dialog waits, paused.
const saved = load();
if (saved) start(saved);
else {
  start(createVillage((Math.random() * 2 ** 31) >>> 0));
  setSpeed(0);
  askFounding(true);
}
requestAnimationFrame(frame);

// The side panels fold away, so the news is not far below; each remembers whether it was open.
document.querySelectorAll('details.fold').forEach((d) => {
  const key = `fold:${d.dataset.fold}`;
  try {
    const was = localStorage.getItem(key);
    if (was !== null) d.open = was === '1';
  } catch (e) { /* no storage: start open */ }
  d.addEventListener('toggle', () => {
    try { localStorage.setItem(key, d.open ? '1' : '0'); } catch (e) { /* not remembered */ }
  });
});
