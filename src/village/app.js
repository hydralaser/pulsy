import { createVillage, stepVillage, saveVillage, loadVillage } from './village.js';
import { readVillagePalette, fitCamera, drawVillage, toLand, pickPerson } from './draw.js';
import { dateText, timeText, hoursPerSecond, monthOf } from './clock.js';
import { siteAt, siteOf } from './land.js';
import { assign, crews, siteTask, sameSite, TASKS, HALVES, canWork, fieldTask } from './work.js';
import { ageOf, lifeStage, kinOf, canFight } from './people.js';
import { VILLAGE, MONTHS, DAYS_IN_MONTH, CLOCK } from './rules.js';
import { WEAPONS, SHIELDS, ARMOUR, HELMETS, GREAVES } from '../sim/rules.js';

const SAVE_KEY = 'pulsy-village';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const app = {
  v: null,
  cam: { x: 0, y: 0, scale: 1 },
  speed: 1,
  lastSpeed: 1,
  sel: { halves: [], person: -1, site: null, household: -1, labels: [] },
  open: new Set(),
  logSeen: 0,
  day: -1,
  inspectedAt: 0,
};

function start(v) {
  app.v = v;
  app.sel = { halves: [], person: -1, site: null, household: -1, labels: [] };
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
    // An unreadable save starts a new village.
  }
  return createVillage((Math.random() * 2 ** 31) >>> 0);
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
  return siteOf(v, site).name;
}

function renderStores() {
  const v = app.v;
  const living = v.people.filter((p) => p.alive);
  const eat = living.reduce((a, p) => a + VILLAGE.ration[rationKey(p)], 0);
  const winter = MONTHS[monthOf(v)].season === 'winter';
  const burn = v.households.filter((h) => h.members.some((id) => v.people[id].alive)).length * (winter ? VILLAGE.fuel.winter : VILLAGE.fuel.summer);
  const days = (store, use) => (use > 0 ? Math.floor(store / use) : '∞');
  const grainDays = days(v.stores.grain, eat);
  const woodDays = days(v.stores.wood, burn);
  const cloth = v.households.reduce((a, h) => a + h.cloth, 0);
  $('stores').innerHTML = `
    <div class="${grainDays < 30 ? 'warn' : ''}"><b>${fmt(v.stores.grain)}</b><span>kg grain · ${grainDays} days</span></div>
    <div class="${woodDays < 20 ? 'warn' : ''}"><b>${fmt(v.stores.wood)}</b><span>kg firewood · ${woodDays} days</span></div>
    <div><b>${v.flock.head}</b><span>sheep and goats · ${v.flock.herders} herding</span></div>
    <div><b>${living.length}</b><span>people · ${living.filter((p) => canFight(v, p)).length} men of fighting age</span></div>
    <div><b>${v.oxen}</b><span>yokes of oxen</span></div>
    <div><b>${cloth.toFixed(0)}</b><span>kg of cloth woven</span></div>`;
}

function rationKey(p) {
  const s = lifeStage(app.v, p);
  if (s === 'infant') return 'infant';
  if (s === 'child' || s === 'youth') return 'child';
  if (s === 'elder') return 'elder';
  return p.sex === 'm' ? 'man' : 'woman';
}

function isChosen(h, half) {
  return app.sel.halves.some((x) => x.h === h && x.half === half);
}

function renderHouseholds() {
  const v = app.v;
  $('holds').innerHTML = v.households.map((h) => {
    const alive = h.members.map((id) => v.people[id]).filter((p) => p.alive);
    if (!alive.length) return '';
    const half = (sex) => {
      const n = alive.filter((p) => p.sex === sex && canWork(v, p)).length;
      const c = sex === 'm' ? 'var(--man)' : 'var(--woman)';
      const word = n === 1 ? (sex === 'm' ? 'man' : 'woman') : HALVES[sex];
      return `<button class="half" style="--c:${c}" data-h="${h.id}" data-half="${sex}" aria-pressed="${isChosen(h.id, sex)}">
        <b>${n} ${word}</b><span>${esc(siteLabel(v, h.assign[sex]))}</span></button>`;
    };
    const members = app.open.has(h.id)
      ? `<div class="members">${alive.map((p) => `<button data-person="${p.id}">${esc(p.name)} ${ageOf(v, p)}</button>`).join('')}</div>` : '';
    return `<div class="hold">
      <div class="hold-head"><button data-hold="${h.id}">House of ${esc(h.name)}</button><small>${alive.length} people${h.cloth >= 1 ? ` · ${h.cloth.toFixed(0)} kg cloth` : ''}</small></div>
      <div class="halves">${half('m')}${half('f')}</div>${members}</div>`;
  }).join('');
  const n = app.sel.halves.length;
  $('selBar').innerHTML = n
    ? `<p class="note">${n} chosen. Tap a field, a wood or the pasture on the map to send them there.</p>
       <button id="toFields">To the fields, wherever needed</button><button id="toHome">Home</button><button id="selClear">Clear</button>`
    : '<p class="note">Tap a household\'s men or women to choose them, then a place on the map.</p>';
  if (n) {
    $('toFields').onclick = () => sendTo({ kind: 'farm', id: 0 });
    $('toHome').onclick = () => sendTo(null);
    $('selClear').onclick = () => {
      app.sel.halves = [];
      renderPanels();
    };
  }
  $('hint').hidden = !n;
  $('hint').textContent = n ? 'Tap a field, a wood or the pasture to send them there.' : '';
}

function renderCrews() {
  const v = app.v;
  const list = crews(v);
  if (!list.length) {
    $('crews').innerHTML = '<p class="note">Everyone is working at home.</p>';
    return;
  }
  $('crews').innerHTML = `<ul>${list.map(({ site, halves }) => {
    const people = v.people.filter((p) => p.alive && canWork(v, p) && halves.some((x) => x.h.id === p.household && x.half === p.sex));
    const task = siteTask(v, site);
    const what = task === 'farm' ? 'wherever the fields need hands' : TASKS[task].text;
    return `<li><button data-site="${site.kind}:${site.id}" class="linkish">${esc(siteOf(v, site).name)}</button><small>${people.length} people from ${new Set(halves.map((x) => x.h.id)).size} household${new Set(halves.map((x) => x.h.id)).size === 1 ? '' : 's'} · ${what}</small></li>`;
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
  const her = p.sex === 'f' ? 'her' : 'his';
  const site = v.households[p.household].assign[p.sex];
  if (p.state === 'returning') {
    if (p.task === 'wood' && p.load > 0) return `Dragging a log of ${Math.round(p.load)} kg home to the woodpile.`;
    if (p.task === 'herd') return 'Bringing the flock home to the fold.';
    return p.load > 0 ? `Walking home with ${Math.round(p.load)} kg of grain.` : 'Walking home.';
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

function renderInspector() {
  const v = app.v;
  const box = $('inspector');
  const s = app.sel;
  if (s.person >= 0) {
    const p = v.people[s.person];
    const h = v.households[p.household];
    const colour = p.sex === 'm' ? 'var(--man)' : 'var(--woman)';
    const fighter = p.weapon && canFight(v, p);
    const kit = fighter ? [WEAPONS[p.weapon].name, p.shield !== 'none' ? SHIELDS[p.shield].name : 'no shield', p.armour !== 'none' ? ARMOUR[p.armour].name : 'no armour', p.helmet !== 'none' ? `${HELMETS[p.helmet].name} helmet` : 'no helmet', p.greaves !== 'none' ? GREAVES[p.greaves].name.toLowerCase() : ''].filter(Boolean).join(', ') : '';
    const word = (x, words) => words[x > 0.8 ? 0 : x > 0.62 ? 1 : x > 0.42 ? 2 : x > 0.25 ? 3 : 4];
    box.innerHTML = `<h2>${p.slave ? 'A slave' : p.sex === 'm' ? 'A man' : 'A woman'} of the village</h2>
      <div class="who" style="color:${colour}">${esc(p.name)}${p.veteran ? '<span class="badge">Veteran</span>' : ''}</div>
      <p class="note">${p.alive ? `${ageOf(v, p)} years old. ` : ''}${esc(kinOf(v, p).replace(/^./, (c) => c.toUpperCase()))}${kinOf(v, p) ? '. ' : ''}House of ${esc(h.name)}.</p>
      <p class="note">${personText(v, p)}</p>
      ${p.alive ? `${meter('Fed', p.fed, colour)}${meter('Health', p.health, colour)}${meter('Strength', p.strength, colour)}
      <h3 class="wounds-head">Skill</h3>
      <div class="skills">${meter('Farming', p.skills.farm, colour)}${meter('Woodcraft', p.skills.wood, colour)}${meter('Herding', p.skills.herd, colour)}${meter('Housework', p.skills.house, colour)}</div>` : ''}
      ${fighter ? `<h3 class="wounds-head">In war</h3><dl>
        <dt>Courage</dt><dd>${word(p.courage, ['fearless', 'brave', 'steady', 'nervous', 'timid'])}</dd>
        <dt>Skill</dt><dd>${word(p.skill, ['master', 'skilled', 'competent', 'green', 'raw'])}</dd>
        <dt>Name</dt><dd>${word(p.reputation, ['renowned', 'respected', 'known', 'little known', 'unknown'])}</dd>
        <dt>Battles</dt><dd>${p.battles}</dd>
        <dt>Kit</dt><dd>${kit}</dd></dl>` : ''}`;
    return;
  }
  if (s.site) {
    const site = siteOf(v, s.site);
    let body = '';
    if (s.site.kind === 'field') {
      const f = site;
      const year = Math.floor(v.day / 360);
      const state = f.state === 'ripe' ? `Ripe: about ${Math.round(f.crop * (1 - f.reaped))} kg of barley still standing.`
        : f.state === 'sown' ? `Sown${f.weeded > 0 ? `, ${Math.round(f.weeded * 100)}% hoed` : ''}. The barley ripens in ${MONTHS[7].name}.`
        : f.rotation === year % 2 ? `To be sown this year: ${Math.round(f.ploughed * 100)}% ploughed, ${Math.round(f.sown * 100)}% sown.` : 'Lying fallow this year.';
      const task = fieldTask(v, f);
      body = `<p class="note">${f.ha.toFixed(1)} hectares, ${(f.dist / 1000).toFixed(1)} km from the gate. ${state}</p><p class="note">${task ? `Work to do now: ${TASKS[task].text}.` : 'Nothing to do here now.'}</p>`;
    } else if (s.site.kind === 'grove') {
      const trees = site.trees.map((t) => v.land.trees[t]);
      const wood = trees.reduce((a, t) => a + t.wood, 0);
      body = `<p class="note">${(Math.hypot(site.x, site.y) / 1000).toFixed(1)} km away. About ${Math.round(wood / 1000)} tonnes of wood standing; ${trees.filter((t) => t.wood <= 50).length} of ${trees.length} stands cut down, growing back as coppice.</p>`;
    } else if (s.site.kind === 'pasture') {
      body = `<p class="note">${(Math.hypot(site.x, site.y) / 1000).toFixed(1)} km away. Rough grazing for the flock. One herder can keep about fifty head together; more than that and some stray.</p>`;
    } else if (s.site.kind === 'farm') {
      body = '<p class="note">Households sent here go each day to whichever field most needs hands: reaping first, then ploughing and sowing, then hoeing.</p>';
    }
    const who = crews(v).find((c) => sameSite(c.site, s.site));
    const list = who ? who.halves.map((x) => `the ${HALVES[x.half]} of the house of ${esc(x.h.name)}`).join('; ') : 'nobody';
    box.innerHTML = `<h2>${esc(site.name)}</h2>${body}<p class="note">Sent here: ${list}.</p>`;
    return;
  }
  box.innerHTML = '<h2>A closer look</h2><p class="note">Tap anyone on the map, or a field, a wood or the pasture, to see more.</p>';
}

function renderLog() {
  const v = app.v;
  const items = v.log.slice(-60).reverse();
  $('log').innerHTML = items.map((e) => {
    const d = `${(e.day % DAYS_IN_MONTH) + 1} ${MONTHS[Math.floor((e.day % 360) / DAYS_IN_MONTH)].name.slice(0, 5)}`;
    return `<li class="${e.kind === 'alarm' ? 'alarm' : ''}"><time>${d}</time><span>${esc(e.text)}</span></li>`;
  }).join('');
}

function renderPanels() {
  renderStores();
  renderHouseholds();
  renderCrews();
  renderInspector();
  renderLog();
}

// ---- orders ----

function sendTo(site) {
  const v = app.v;
  for (const { h, half } of app.sel.halves) assign(v, v.households[h], half, site);
  app.sel.halves = [];
  app.sel.site = site;
  app.sel.person = -1;
  save();
  renderPanels();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.half) {
    const h = Number(t.dataset.h);
    const half = t.dataset.half;
    const i = app.sel.halves.findIndex((x) => x.h === h && x.half === half);
    if (i >= 0) app.sel.halves.splice(i, 1);
    else app.sel.halves.push({ h, half });
    renderHouseholds();
  } else if (t.dataset.hold) {
    const id = Number(t.dataset.hold);
    if (app.open.has(id)) app.open.delete(id);
    else app.open.add(id);
    renderHouseholds();
  } else if (t.dataset.person) {
    app.sel.person = Number(t.dataset.person);
    app.sel.site = null;
    renderInspector();
  } else if (t.dataset.site) {
    const [kind, id] = t.dataset.site.split(':');
    app.sel.site = { kind, id: Number(id) };
    app.sel.person = -1;
    renderInspector();
  }
});

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

$('newBtn').addEventListener('click', () => {
  if (!confirm('Start a new village? This one will be lost.')) return;
  start(createVillage((Math.random() * 2 ** 31) >>> 0));
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
  if (p) {
    app.sel.person = p.id;
    app.sel.site = null;
  } else {
    app.sel.person = -1;
    app.sel.site = site;
  }
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
      const s = v.households[p.household].assign[p.sex];
      if (!s) continue;
      const site = siteOf(v, s);
      key = `${s.kind}${s.id}`;
      pos = { x: site.x, y: site.y - (site.r || 0) };
    }
    if (!at.has(key)) at.set(key, { at: pos, n: 0, task: key === 'fields' ? 'farm' : p.task });
    at.get(key).n++;
  }
  for (const l of at.values()) out.push({ at: l.at, text: `${TASKS[l.task].text[0].toUpperCase()}${TASKS[l.task].text.slice(1)} · ${l.n}` });
  return out;
}

let pal = null;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const v = app.v;
  if (app.speed > 0) {
    stepVillage(v, dt * app.speed * hoursPerSecond(v));
    // News that needs you stops the clock.
    for (let i = app.logSeen; i < v.log.length; i++) if (v.log[i].pause && $('autopause').checked) setSpeed(0);
    if (v.log.length !== app.logSeen) renderLog();
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
  drawVillage(ctx, v, app.cam, w, h, pal, app.sel);
  requestAnimationFrame(frame);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { pal = null; });

start(load());
requestAnimationFrame(frame);
