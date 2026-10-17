import { TUNING, WEAPONS, SHIELDS, ARMOUR, HELMETS } from '../sim/rules.js';
import { createBattle, startBattle, stepBattle, DEFAULT_CONFIG } from '../sim/world.js';
import { PLACEMENTS, swapMen } from '../sim/unit.js';
import { playerOrder } from '../sim/ai.js';
import { isFormed, isRunning } from '../sim/core.js';
import { SIDES } from '../sim/names.js';
import { drawBattle, readPalette, makeCamera, updateCamera, pickSoldier, unitLabel } from '../render/draw.js';

const $ = (id) => document.getElementById(id);
const canvas = $('field');
const ctx = canvas.getContext('2d');

const app = {
  config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  world: null,
  running: false,
  speed: 1,
  selected: -1,
  showFear: false,
  cam: makeCamera(),
  acc: 0,
  last: 0,
  uiT: 0,
  palT: 0,
  palette: null,
  logged: 0,
  reportShown: false,
};

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const pct = (x) => `${Math.round(x * 100)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const playerCommands = () => app.config.sides[0].ai === false;

// ---- Battle lifecycle ----

function newBattle(keepSeed) {
  if (!keepSeed) app.config.seed = 1 + Math.floor(Math.random() * 99999);
  app.world = createBattle(app.config);
  app.running = false;
  app.selected = -1;
  app.acc = 0;
  app.logged = 0;
  app.reportShown = false;
  app.cam.init = false;
  $('log').innerHTML = '';
  $('report').hidden = true;
  $('playBtn').textContent = 'Start battle';
  renderSetup();
  renderAll();
}

function startOrToggle() {
  const w = app.world;
  if (w.phase === 'setup') {
    startBattle(w);
    app.running = true;
    renderSetup();
  } else {
    app.running = !app.running;
  }
  $('playBtn').textContent = app.running ? 'Pause' : 'Resume';
  renderAll();
}

// ---- Setup panel ----

function renderSetup() {
  const box = $('setup');
  const w = app.world;
  box.hidden = w.phase !== 'setup';
  $('orders').hidden = !(playerCommands() && w.phase === 'battle');
  if (box.hidden) return;
  const sideHtml = app.config.sides.map((side, i) => {
    const roster = SIDES[i];
    const ranks = Math.ceil(side.count / side.files);
    const placement = Object.entries(PLACEMENTS)
      .map(([k, v]) => `<option value="${k}"${k === side.placement ? ' selected' : ''}>${v}</option>`).join('');
    const sizes = [24, 32, 40, 48, 60]
      .map((n) => `<option value="${n}"${n === side.count ? ' selected' : ''}>${n}</option>`).join('');
    const command = i === 0
      ? `<label for="cmd0">Command</label>
         <select id="cmd0"><option value="ai"${side.ai ? ' selected' : ''}>Your second (AI)</option><option value="you"${side.ai ? '' : ' selected'}>You</option></select>`
      : '';
    return `<div class="setup-side">
      <h3 style="color: var(--side-${i ? 'b' : 'a'})">${roster.name}</h3>
      <label for="count${i}">Men</label><select id="count${i}">${sizes}</select>
      <label for="files${i}">Frontage</label><input id="files${i}" type="number" min="4" max="20" value="${side.files}" aria-describedby="depth${i}">
      <span></span><span class="note" id="depth${i}">${side.files} wide, ${ranks} deep</span>
      <label for="place${i}">Placement</label><select id="place${i}">${placement}</select>
      ${command}
    </div>`;
  }).join('');
  box.innerHTML = `<h2>Before the battle</h2>${sideHtml}
    <p class="note">Tap a man to see who he is. Then tap another man of the same side to swap their places in the line.</p>`;
  app.config.sides.forEach((side, i) => {
    $(`count${i}`).addEventListener('change', (e) => { side.count = Number(e.target.value); newBattle(true); });
    $(`files${i}`).addEventListener('change', (e) => {
      side.files = Math.max(4, Math.min(20, Number(e.target.value) || side.files));
      newBattle(true);
    });
    $(`place${i}`).addEventListener('change', (e) => { side.placement = e.target.value; newBattle(true); });
  });
  $('cmd0').addEventListener('change', (e) => { app.config.sides[0].ai = e.target.value !== 'you'; newBattle(true); });
}

// ---- Side panel ----

function meter(label, value, colour) {
  return `<div class="meter" style="--c:${colour}"><span>${label}</span><span class="track"><span class="fill" style="width:${pct(Math.max(0, Math.min(1, value)))}%"></span></span><span class="num">${pct(value)}</span></div>`;
}

function renderUnits() {
  const w = app.world;
  $('units').innerHTML = w.units.map((u) => {
    const men = u.members.map((id) => w.soldiers[id]);
    const inLine = men.filter(isFormed).length;
    const wounded = men.filter((s) => s.state !== 'dead' && s.wounds.length).length;
    const dead = men.filter((s) => s.state === 'dead').length;
    const away = men.filter((s) => isRunning(s) || s.state === 'escaped').length;
    const label = w.phase === 'setup' ? 'Waiting' : unitLabel(w, u);
    const bad = u.mode === 'routed' || u.mode === 'withdrawing';
    const colour = `var(--side-${u.side ? 'b' : 'a'})`;
    const who = u.side === 0 && playerCommands() ? ' (you)' : '';
    return `<div class="unit-card" style="--c:${colour}">
      <div class="unit-head"><strong>${u.name}${who}</strong><span class="chip${bad ? ' bad' : ''}">${label}</span></div>
      ${meter('Nerve', u.nerve, colour)}
      ${meter('Stamina', u.stamina, colour)}
      ${meter('Cohesion', u.cohesion, colour)}
      <div class="counts">
        <div><b>${inLine}</b><span>in line</span></div>
        <div><b>${wounded}</b><span>wounded</span></div>
        <div><b>${dead}</b><span>dead</span></div>
        <div><b>${away}</b><span>run off</span></div>
      </div>
    </div>`;
  }).join('');
}

const STATE_TEXT = {
  inRank: 'Holding his place in the line',
  surging: 'Stepping into the gap',
  recoiling: 'Stepping back to the line',
  returning: 'Making his way back to his place',
  wavering: 'Wavering, hanging back',
  fleeing: 'Running for his life',
  rallying: 'Catching his breath behind the lines',
  pursuing: 'Chasing the beaten enemy',
  dead: 'Dead',
  escaped: 'Escaped from the field',
};

const REASON_TEXT = {
  turned: 'went for an enemy stepping back',
  wavering: 'went for a wavering enemy',
  wounded: 'went for a wounded enemy',
  exhausted: 'went for an exhausted enemy',
  gap: 'went for a gap in the enemy line',
  follow: 'followed the men beside him',
  called: 'answered the call forward',
  counter: 'threw back the attack',
  pushed: 'was driven on by the men behind',
  pressed: 'was pushed within spear reach by the men behind',
  fresh: 'pushed through to take a tired man\'s place',
  'worked up': 'worked himself up to it',
};

function stateText(s) {
  const why = s.surgeReason && REASON_TEXT[s.surgeReason] ? ` (he ${REASON_TEXT[s.surgeReason]})` : '';
  if (s.state === 'fighting') return s.aggressor ? `Fighting in the gap${why}` : 'Defending his place';
  if (s.state === 'surging') return `Stepping into the gap${why}`;
  if (s.wantsOut && s.pinnedT > 1) return 'Spent, calling "enough!", but the men behind will not give way';
  if (s.state === 'inRank' && s.slot && s.slot.r > 0) {
    if (s.halt > 0.5) return 'Has heard the word to step back and is easing off';
    if (s.resolve > 0.6) return 'Pushing forward, eager to get into the fight';
    if (s.resolve > 0.3) return 'Restless, waiting his turn';
  }
  if (s.state === 'inRank' && s.breathT > 0 && s.slot && s.slot.r === 0) return 'Catching his breath in the line';
  if (s.state === 'inRank' && s.resolve > 0.4 && s.slot && s.slot.r === 0) return 'Working up his courage';
  return STATE_TEXT[s.state] || s.state;
}

function word(v, words) {
  const cuts = [0.8, 0.62, 0.42, 0.25];
  for (let i = 0; i < cuts.length; i++) if (v >= cuts[i]) return words[i];
  return words[4];
}

function roleOf(u, s) {
  if (!s.slot) return 'Out of the line';
  const { f, r } = s.slot;
  const rank = r === 0 ? 'Front rank' : r === u.ranks - 1 ? 'Rear rank, file-closer' : `Rank ${r + 1} of ${u.ranks}`;
  const file = f === 0 ? 'left end' : f === u.files - 1 ? 'right end' : `file ${f + 1} of ${u.files}`;
  return `${rank}, ${file}`;
}

function renderInspector() {
  const box = $('inspector');
  const w = app.world;
  const s = app.selected >= 0 ? w.soldiers[app.selected] : null;
  if (!s) {
    box.innerHTML = `<h2>A man in the line</h2><p class="note">Tap any man on the field to see who he is and what he is doing.</p>`;
    return;
  }
  const u = w.units[s.unit];
  const badges = [
    s.id === u.leaderId ? 'Leader' : s.id === u.secondId ? 'Second' : '',
    s.veteran ? 'Veteran' : '',
  ].filter(Boolean).map((b) => `<span class="badge">${b}</span>`).join('');
  const colour = `var(--side-${s.side ? 'b' : 'a'})`;
  const wounds = s.wounds.length
    ? s.wounds.map((x) => `${x.where} (from ${esc(x.by)})`).join(', ')
    : 'None';
  const rec = s.record;
  const kit = `${WEAPONS[s.weapon].name}, ${SHIELDS[s.shield].name}, ${ARMOUR[s.armour].name}, ${HELMETS[s.helmet].name} helmet`;
  const swapNote = w.phase === 'setup'
    ? `<p class="note">Tap another ${u.adjective} to swap places with ${esc(s.name)}.</p>` : '';
  box.innerHTML = `<h2>A man in the line</h2>
    <div class="who" style="color:${colour}">${esc(s.name)} of ${esc(s.origin)}${badges}</div>
    <p class="note">${stateText(s)}. ${roleOf(u, s)}.</p>
    ${meter('Nerve', s.nerve, colour)}
    ${meter('Stamina', s.stamina, colour)}
    ${meter('Health', Math.max(0, s.health), colour)}
    ${s.slot ? meter(s.slot.r === 0 ? 'Resolve' : 'Eagerness', Math.min(1, Math.max(0, s.resolve)), colour) : ''}
    <dl>
      <dt>Age</dt><dd>${s.age}, ${s.battles} battle${s.battles === 1 ? '' : 's'} before this</dd>
      <dt>Courage</dt><dd>${word(s.courage, ['fearless', 'brave', 'steady', 'nervous', 'timid'])}</dd>
      <dt>Skill</dt><dd>${word(s.skill, ['master', 'skilled', 'competent', 'green', 'raw'])}</dd>
      <dt>Name</dt><dd>${word(s.reputation, ['renowned', 'respected', 'known', 'little known', 'unknown'])}</dd>
      <dt>Kit</dt><dd>${kit}</dd>
      <dt>Wounds</dt><dd>${wounds}</dd>
      <dt>Today</dt><dd>${rec.kills} killed, ${rec.woundsGiven} wounded, ${rec.blocks} blow${rec.blocks === 1 ? '' : 's'} taken on the shield${rec.fled ? `, ran ${rec.fled}×` : ''}</dd>
    </dl>
    ${swapNote}`;
}

function renderLog() {
  const w = app.world;
  const list = $('log');
  const big = new Set(['rout', 'end', 'leader', 'contact', 'withdraw', 'overlap', 'charge', 'impact']);
  while (app.logged < w.events.length) {
    const e = w.events[app.logged++];
    const li = document.createElement('li');
    if (e.unit != null) li.dataset.side = String(w.units[e.unit].side);
    if (big.has(e.kind)) li.className = 'big';
    li.innerHTML = `<time>${fmtTime(e.t)}</time><span>${esc(e.text)}</span>`;
    list.prepend(li);
  }
  while (list.children.length > 120) list.lastChild.remove();
}

function renderHint() {
  const w = app.world;
  const hint = $('hint');
  let text = '';
  if (w.phase === 'setup') text = 'Set up both sides on the right, then press Start battle.';
  else if (!app.running && !w.result) text = 'Paused.';
  else if (playerCommands() && !w.result && w.contactT == null) text = 'You command the Athenians. Press W to march; within about 40 m, C charges.';
  hint.hidden = !text;
  hint.textContent = text;
}

function chargeText(r) {
  const w = app.world;
  const first = r.charges.find((c) => !c.counter);
  if (!first) return 'Neither side charged.';
  const counter = r.charges.find((c) => c.counter);
  const name = (c) => w.units[c.unit].short;
  return counter
    ? `The ${name(first)} charged from ${Math.round(first.distance)} m and the ${name(counter)} ran out to meet them.`
    : `The ${name(first)} charged from ${Math.round(first.distance)} m.`;
}

function renderReport() {
  const w = app.world;
  const r = w.result;
  const box = $('report');
  const rows = r.sides.map((s) => `<tr><td>${s.name}</td><td>${s.start}</td><td>${s.killedFight}</td><td>${s.killedPursuit}</td><td>${s.wounded}</td><td>${s.fled}</td></tr>`).join('');
  const focus = r.loser >= 0 ? [r.loser] : [0, 1];
  const causes = focus.map((i) => {
    const u = w.units[i];
    const items = r.sides[i].causes.map((c) => `<li>${c.text} (${Math.round(c.share * 100)}%)</li>`).join('');
    const title = r.loser >= 0 ? `What broke the ${u.short}` : `What wore down the ${u.short}`;
    return `<div><h3>${title}</h3><ul>${items}</ul></div>`;
  }).join('');
  const heroes = r.heroes.length
    ? `<div><h3>Men of the day</h3><ul>${r.heroes.map((h) => `<li>${esc(h.name)} of ${esc(h.origin)} (${SIDES[h.side].short}): ${h.kills} killed${h.alive ? '' : ', fell himself'}</li>`).join('')}</ul></div>`
    : '';
  const vets = r.fallenVeterans.length
    ? `<p class="note">Veterans lost: ${r.fallenVeterans.map((v) => esc(v.name)).join(', ')}.</p>` : '';
  box.innerHTML = `<h2>${esc(r.headline)}</h2>
    <p class="facts">${r.beforeContact ? 'The lines never met. ' : `Contact to decision: ${fmtTime(r.duration)}. `}${chargeText(r)}</p>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>Men</th><th>Killed fighting</th><th>Killed running</th><th>Wounded</th><th>Ran</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${causes}${heroes}${vets}
    <div class="actions">
      <button id="repSame" class="primary">Same men again</button>
      <button id="repNew">New men</button>
      <button id="repClose">Watch the aftermath</button>
    </div>`;
  box.hidden = false;
  $('repSame').addEventListener('click', () => newBattle(true));
  $('repNew').addEventListener('click', () => newBattle(false));
  $('repClose').addEventListener('click', () => { box.hidden = true; });
}

function renderAll() {
  const w = app.world;
  $('clock').textContent = fmtTime(w.t);
  renderUnits();
  renderInspector();
  renderLog();
  renderHint();
  const pursue = $('ordPursue');
  if (pursue) {
    const u = w.units[0];
    pursue.textContent = '';
    pursue.innerHTML = u.mode === 'pursuing' ? 'Call back <kbd>P</kbd>' : 'Pursue <kbd>P</kbd>';
  }
  if (w.result && !app.reportShown) {
    app.reportShown = true;
    renderReport();
  }
}

// ---- Orders ----

function order(name) {
  const w = app.world;
  if (w.phase !== 'battle' || !playerCommands()) return;
  const u = w.units[0];
  if (name === 'pursue' && u.mode === 'pursuing') name = 'recall';
  playerOrder(w, u, name);
  renderAll();
}

function setTurn(v) {
  if (app.world && playerCommands()) app.world.units[0].turn = v;
}

document.querySelectorAll('#orders [data-order]').forEach((b) => b.addEventListener('click', () => order(b.dataset.order)));
document.querySelectorAll('#orders [data-turn]').forEach((b) => {
  const v = Number(b.dataset.turn);
  b.addEventListener('pointerdown', () => setTurn(v));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => setTurn(0));
});

const KEYS = { KeyW: 'advance', Space: 'hold', KeyS: 'back', KeyR: 'withdraw', KeyF: 'surge', KeyE: 'ease', KeyP: 'pursue', KeyC: 'charge' };
window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select')) return;
  if (!playerCommands() || app.world.phase !== 'battle') return;
  if (KEYS[e.code]) {
    e.preventDefault();
    if (!e.repeat) order(KEYS[e.code]);
  }
  if (e.code === 'KeyA') setTurn(-1);
  if (e.code === 'KeyD') setTurn(1);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyA' || e.code === 'KeyD') setTurn(0);
});

// ---- Field interaction ----

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const w = app.world;
  const picked = pickSoldier(w, app.cam, rect.width, rect.height, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  if (!picked) {
    app.selected = -1;
  } else if (w.phase === 'setup' && app.selected >= 0 && app.selected !== picked.id && w.soldiers[app.selected].side === picked.side) {
    swapMen(w, w.units[picked.unit], w.soldiers[app.selected], picked);
    app.selected = -1;
  } else {
    app.selected = picked.id;
  }
  renderInspector();
});

$('playBtn').addEventListener('click', startOrToggle);
$('restartBtn').addEventListener('click', () => newBattle(true));
$('newBtn').addEventListener('click', () => newBattle(false));
$('fearToggle').addEventListener('change', (e) => { app.showFear = e.target.checked; });
$('zoomIn').addEventListener('click', () => { app.cam.zoom = Math.min(3, app.cam.zoom * 1.25); });
$('zoomOut').addEventListener('click', () => { app.cam.zoom = Math.max(0.3, app.cam.zoom / 1.25); });
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  app.speed = Number(b.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
}));

// ---- Main loop ----

function frame(ts) {
  const dt = Math.min(0.1, (ts - app.last) / 1000 || 0);
  app.last = ts;
  const w = app.world;
  if (app.running && w.phase === 'battle') {
    app.acc += dt * app.speed;
    let n = 0;
    while (app.acc >= TUNING.dt && n < 40) {
      stepBattle(w);
      app.acc -= TUNING.dt;
      n++;
    }
  }
  const alpha = app.running ? app.acc / TUNING.dt : 1;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  app.palT -= dt;
  if (!app.palette || app.palT <= 0) {
    app.palette = readPalette(document.documentElement);
    app.palT = 1;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateCamera(app.cam, w, rect.width, rect.height);
  drawBattle(ctx, w, app.cam, rect.width, rect.height, app.palette, alpha, { selected: app.selected, showMood: app.showFear });

  app.uiT -= dt;
  if (app.uiT <= 0) {
    app.uiT = 0.25;
    renderAll();
  }
  requestAnimationFrame(frame);
}

newBattle(true);
requestAnimationFrame(frame);
