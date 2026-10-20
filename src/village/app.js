import { createVillage, stepVillage, saveVillage, loadVillage } from './village.js';
import { readVillagePalette, fitCamera, drawVillage, toLand, pickPerson } from './draw.js';
import { dateText, timeText, hoursPerSecond, monthOf } from './clock.js';
import { siteAt, siteOf } from './land.js';
import { assign, crews, siteTask, sameSite, TASKS, HALVES, canWork, fieldTask, assignPerson, siteOfPerson, peopleAt, isDrill } from './work.js';
import { ageOf, lifeStage, kinOf, canFight } from './people.js';
import { MONTHS, DAYS_IN_MONTH, CLOCK } from './rules.js';
import { totals, aliveHouseholds, dailyGrain, dailyFuel, owedBy, owedTo, worth } from './economy.js';
import { houseName, headOf, freeHouse } from './family.js';
import { grant, refuse, order, release, rivalsOf, goodwillWord, PETITION_TEXT, tie, RULES, addGoodwill } from './council.js';
import { planHouse, freePlot, planField, freeWild } from './building.js';
import { BUILD } from './rules.js';
import { WEAPONS, SHIELDS, ARMOUR, HELMETS, GREAVES } from '../sim/rules.js';
import { WAR, COUNCIL } from './rules.js';
import { planLevy, answerSummons, answerFine, battleSetup, applyBattle, standingWord, yourRead, sonToBring } from './war.js';

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
  levySon: false, // bring your grown son along though the levy does not take him
  battle: null, // the battle frame, while you are on the field
};

function start(v) {
  app.v = v;
  app.sel = { halves: [], people: [], person: -1, site: null, from: 'map', barAt: -1, labels: [] };
  app.logSeen = v.log.length;
  app.day = -1;
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
  // land, paid for by the first household chosen.
  const chosen = [...new Set([...app.sel.halves.map((x) => x.h), ...singles.map((p) => p.household)])].map((id) => v.households[id]);
  // Men of fighting age, armed, among those chosen: they can be sent to drill for war.
  const fighters = singles.filter((p) => isDrill(v, p)).length + app.sel.halves.filter((x) => x.half === 'm').reduce((a, x) => a + v.households[x.h].members.filter((id) => isDrill(v, v.people[id]) && !v.people[id].assign).length, 0);
  const payer = chosen[0];
  const houseFor = chosen.find((h) => h.waiting >= 0 && freeHouse(v) < 0 && !(v.projects || []).some((x) => x.sponsor === h.id && x.kind !== 'field'));
  const newWork = [
    houseFor && freePlot(v) >= 0 ? `<button data-plan="${houseFor.id}">Build a house for ${esc(v.people[houseFor.waiting].name)}</button>` : '',
    payer && freeWild(v) >= 0 ? `<button data-clear="${payer.id}" title="About ${Math.round(BUILD.field.work * 1.2)} days' work for 1.2 ha. ${payer.player ? 'Your house pays' : `The house of ${esc(payer.name)} pays`} the wages of anyone else's people who work on it, and keeps the brushwood and stones.">Clear new land for ${payer.player ? 'your house' : `the house of ${esc(payer.name)}`}</button>` : '',
  ].join('');
  const bar = n
    ? `<div class="sel-bar" id="selBar"><p class="note">${n} chosen. Tap a field, a wood, the quarry or the pasture on the map to send them there, or:</p>
       <button id="toFields">To the fields, wherever needed</button>${(v.projects || []).map((x) => `<button data-to-build="${x.id}">To ${x.kind === 'field' ? 'clear' : 'build'} ${esc(x.name)}</button>`).join('')}${fighters ? `<button id="toDrill">Drill for war (${fighters} m${fighters === 1 ? 'an' : 'en'})</button>` : ''}<button id="toHome">Home</button>${app.sel.halves.some((x) => v.households[x.h].ordered && v.households[x.h].ordered[x.half]) ? '<button id="toSelf">Let them decide</button>' : ''}${singles.some((p) => p.assign) ? '<button id="toHousehold">Back with their household</button>' : ''}<button id="selClear">Clear</button>
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
        ? `<p class="note">${fields.length} plots (${fields.reduce((a, f) => a + f.ha, 0).toFixed(1)} ha): ${fields.map((f) => `<button class="linkish" data-site="field:${f.id}" data-from="hold:${h.id}">${f.id + 1}</button>`).join(', ')}. ${h.sheep} sheep. ${Math.round(h.stores.grain)} kg barley, ${Math.round(h.stores.wood)} kg firewood, ${Math.round(h.stores.stone || 0)} kg stone, ${h.stores.wool.toFixed(1)} kg wool, ${h.stores.cloth.toFixed(1)} kg cloth${v.yokes.some((y) => y.owner === h.id) ? ', a yoke of oxen' : ''}${v.cartOwners.includes(h.id) ? ', a cart' : ''}.${owes ? ` Owes ${Math.round(owes)} kg.` : ''}${owed ? ` Is owed ${Math.round(owed)} kg.` : ''}</p>
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
        <small class="${h.hungry || h.stores.grain < eat * 15 ? 'bad' : ''}">${planText(v, h)}worth ${fmt(w)} · ${alive.length} people · ${Math.floor(h.stores.grain / Math.max(0.1, eat))} days' grain · ${Math.floor(h.stores.wood / dailyFuel(v))} days' wood${owes > 1 ? ` · owes ${Math.round(owes)}` : ''}</small></div>
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
  if (!p.alive) return `Died of ${p.cause}.`;
  if (p.away) return `Away with the army under ${esc(v.war.campaign ? v.war.campaign.general : 'the general')}.`;
  const her = p.sex === 'f' ? 'her' : 'his';
  const site = v.households[p.household].assign[p.sex];
  if (p.state === 'returning') {
    if (p.task === 'wood' && p.load > 0) return `Dragging a log of ${Math.round(p.load)} kg home to the woodpile.`;
    if (p.task === 'herd') return 'Bringing the flock home to the fold.';
    return p.load > 0 ? `Walking home with ${Math.round(p.load)} kg of grain.` : 'Walking home.';
  }
  if (p.task === 'clear' && (p.state === 'out' || p.state === 'working')) {
    return p.state === 'out' ? 'Walking out to the rough ground to clear it.' : 'Clearing new land: cutting scrub, grubbing out roots, carrying off stones.';
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
  if (p.field != null && ['plough', 'sow', 'weed', 'reap'].includes(p.task) && (p.state === 'out' || p.state === 'working')) {
    const f = v.land.fields[p.field];
    if (p.state === 'out') return `On ${her} way to ${f.name}.`;
    const what = p.task === 'plough' ? (p.yoke ? 'Ploughing behind a yoke of oxen' : 'Breaking the ground with a mattock') : TASKS[p.task].text.replace(/^./, (c) => c.toUpperCase());
    const key = { plough: 'ploughed', sow: 'sown', weed: 'weeded', reap: 'reaped' }[p.task];
    return `${what} on ${f.name}: ${Math.round(f[key] * 100)}% done.`;
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
        <dt>Name</dt><dd>${word(p.reputation, ['renowned', 'respected', 'known', 'little known', 'unknown'])}</dd>
        <dt>Battles</dt><dd>${p.battles}</dd>
        <dt>Affairs</dt><dd>${word(p.politics ?? 0.4, ['shrewd', 'well informed', 'informed', 'poorly informed', 'ignorant'])}</dd>
        <dt>Kit</dt><dd>${kit}</dd></dl>` : ''}
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
      const state = f.state === 'ripe' ? `Ripe: about ${Math.round(f.crop * (1 - f.reaped))} kg of barley still standing.`
        : f.state === 'sown' ? `Sown${f.weeded > 0 ? `, ${Math.round(f.weeded * 100)}% hoed` : ''}. The barley ripens in ${MONTHS[7].name}.`
        : f.rotation === year % 2 ? `To be sown this year: ${Math.round(f.ploughed * 100)}% ploughed, ${Math.round(f.sown * 100)}% sown.` : 'Lying fallow this year.';
      const task = fieldTask(v, f);
      const owner = f.owner >= 0 ? (v.households[f.owner].player ? 'yours' : `owned by the house of ${esc(v.households[f.owner].name)}`) : 'the village\'s common land';
      body = `<p class="note">${f.ha.toFixed(1)} hectares, ${(f.dist / 1000).toFixed(1)} km from the gate, ${owner}. ${state}</p><p class="note">${task ? `Work to do now: ${TASKS[task].text}.` : 'Nothing to do here now.'}</p>`;
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

// Households asking your leave: on the map, where you will see them.
function renderPetitions() {
  const v = app.v;
  const list = v.petitions || [];
  const box = $('petitions');
  const war = warCard(v);
  box.hidden = !list.length && !war;
  box.innerHTML = war + list.slice(0, war ? 2 : 3).map((p) => {
    const h = v.households[p.house];
    const rivals = rivalsOf(v, p);
    const left = 12 - (v.day - p.day);
    return `<div class="petition">
      <p><b>The house of ${esc(h.name)}</b> <span class="mood g${Math.round((h.goodwill ?? 0.6) * 4)}">${goodwillWord(h.goodwill ?? 0.6)}</span> asks your leave ${PETITION_TEXT[p.kind]}.</p>
      ${houseSummary(v, h)}
      <p class="note">${esc(p.why)}${rivals.length ? ` The house${rivals.length > 1 ? 's' : ''} of ${rivals.map((o) => esc(o.name)).join(' and ')} already cut${rivals.length > 1 ? '' : 's'} wood to sell, and would not welcome it.` : ''}</p>
      <div class="petition-actions"><button class="primary" data-grant="${p.id}">Grant</button><button data-refuse="${p.id}">Refuse</button><small>${left > 0 ? `${left} day${left === 1 ? '' : 's'} to answer` : 'answer today'}</small></div>
    </div>`;
  }).join('') + (list.length > 3 ? `<p class="note more">and ${list.length - 3} more waiting</p>` : '');
}

// ---- war ----

const pctText = (x) => `${Math.round(x * 100)}%`;

// The summons, the levy you choose and who it sends; then the army on the march and the battle.
function warCard(v) {
  const w = v.war;
  if (!w) return '';
  return fineCard(v) + levyCard(v);
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
  // People sent singly: home means home, not with the household.
  for (const id of app.sel.people) {
    const p = v.people[id];
    if (drill && !isDrill(v, p)) continue;
    assignPerson(v, p, site || { kind: 'home', id: 0 });
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
    if (p) (t.dataset.grant ? grant : refuse)(app.v, p);
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
  app.speed = s;
  $('speedLabel').textContent = speedText(s > 0 ? s : app.lastSpeed);
  $('pauseBtn').classList.toggle('paused', s === 0);
  $('pauseBtn').textContent = s === 0 ? '▶︎' : '‖';
  $('pauseBtn').setAttribute('aria-label', s === 0 ? 'Resume' : 'Pause');
}

function nudgeSpeed(dir) {
  const list = CLOCK.speeds;
  const i = list.indexOf(app.lastSpeed);
  setSpeed(list[Math.max(0, Math.min(list.length - 1, i + dir))]);
}

$('pauseBtn').addEventListener('click', () => setSpeed(app.speed > 0 ? 0 : app.lastSpeed));
$('slower').addEventListener('click', () => nudgeSpeed(-1));
$('faster').addEventListener('click', () => nudgeSpeed(1));
$('speedLabel').addEventListener('click', () => setSpeed(1));

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setSpeed(app.speed > 0 ? 0 : app.lastSpeed);
  } else if (e.key === '-' || e.key === ',') nudgeSpeed(-1);
  else if (e.key === '+' || e.key === '=' || e.key === '.') nudgeSpeed(1);
});

// The council: your standing answers to each kind of petition.
function renderCouncil() {
  const v = app.v;
  v.rules = v.rules || {};
  let group = '';
  $('councilRules').innerHTML = RULES.map((r) => {
    const head = r.group !== group ? `<h3>${r.group}</h3>` : '';
    group = r.group;
    const cur = v.rules[r.key] || 'ask';
    return `${head}<label class="row">${r.text}<select data-rule="${r.key}">${[['ask', 'Ask me'], ['grant', 'Always grant'], ['refuse', 'Always refuse']].map(([k, label]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
  }).join('');
  document.querySelectorAll('[data-rule]').forEach((s) => {
    s.onchange = () => {
      v.rules[s.dataset.rule] = s.value;
      save();
    };
  });
}

$('councilBtn').addEventListener('click', () => {
  renderCouncil();
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
    if (p.field != null && ['plough', 'sow', 'weed', 'reap'].includes(p.task) && close) {
      const f = v.land.fields[p.field];
      key = `f${f.id}`;
      pos = { x: f.x, y: f.y - f.h / 2 };
    } else if (p.field != null && ['plough', 'sow', 'weed', 'reap'].includes(p.task)) {
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
  if (app.speed > 0 && !app.battle) {
    stepVillage(v, dt * app.speed * hoursPerSecond(v));
    // News that needs you stops the clock.
    for (let i = app.logSeen; i < v.log.length; i++) if (v.log[i].pause && $('autopause').checked) setSpeed(0);
    if (v.log.length !== app.logSeen) {
      renderLog();
      renderPetitions();
    }
    app.logSeen = v.log.length;
  }
  if (v.day !== app.day) {
    app.day = v.day;
    renderPanels();
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
  app.sel.noNight = app.speed > 8;
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
