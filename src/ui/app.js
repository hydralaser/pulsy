import { TUNING, WEAPONS, SHIELDS, ARMOUR, HELMETS, QUALITIES, KITS } from '../sim/rules.js';
import { createBattle, startBattle, stepBattle, DEFAULT_CONFIG } from '../sim/world.js';
import { PLACEMENTS } from '../sim/unit.js';
import { applyInput, recordOf } from '../sim/record.js';
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

function options(list, current) {
  return list.map(([value, label]) => `<option value="${value}"${String(value) === String(current) ? ' selected' : ''}>${label}</option>`).join('');
}

function renderSetup() {
  const box = $('setup');
  const w = app.world;
  box.hidden = w.phase !== 'setup';
  $('orders').hidden = !(playerCommands() && w.phase === 'battle');
  if (box.hidden) return;
  const sideHtml = app.config.sides.map((side, i) => {
    const roster = SIDES[i];
    const total = side.contingents.reduce((a, c) => a + c.count, 0);
    const width = side.contingents.reduce((a, c) => a + Math.ceil(c.count / (c.depth ?? side.depth)), 0);
    const command = i === 0
      ? `<label for="cmd0">Command</label>
         <select id="cmd0">${options([['ai', 'Your second (AI)'], ['you', 'You']], side.ai ? 'ai' : 'you')}</select>`
      : '';
    const rows = side.contingents.map((c, k) => `<div class="cont-row">
        <input id="cname${i}_${k}" value="${esc(c.name)}" aria-label="Name of contingent ${k + 1}">
        <select id="ccount${i}_${k}" aria-label="Men in ${esc(c.name)}">${options([8, 12, 16, 20, 24, 32, 40, 48, 64].map((n) => [n, n]), c.count)}</select>
        <select id="cdepth${i}_${k}" aria-label="Ranks deep for ${esc(c.name)}">${options([2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => [n, n]), c.depth ?? side.depth)}</select>
        <select id="cqual${i}_${k}" aria-label="Quality of ${esc(c.name)}">${options(Object.entries(QUALITIES).map(([key, q]) => [key, q.name]), c.quality)}</select>
        <select id="ckit${i}_${k}" aria-label="Kit of ${esc(c.name)}">${options([['well', 'Well'], ['standard', 'Standard'], ['poor', 'Poor']], c.kit)}</select>
        <button id="cdel${i}_${k}" aria-label="Remove ${esc(c.name)}"${side.contingents.length < 2 ? ' disabled' : ''}>×</button>
      </div>`).join('');
    return `<div class="setup-side">
      <h3 style="color: var(--side-${i ? 'b' : 'a'})">${roster.name}</h3>
      <label for="depth${i}">Depth, all</label><select id="depth${i}" aria-describedby="shape${i}">${options([2, 3, 4, 5, 6, 8].map((n) => [n, `${n} ranks`]), side.depth)}</select>
      <span></span><span class="note" id="shape${i}">${total} men, ${width} wide</span>
      <label for="place${i}">Placement</label><select id="place${i}">${options(Object.entries(PLACEMENTS), side.placement)}</select>
      <label for="lights${i}">Peltasts</label><span class="pair"><select id="lights${i}" aria-label="Number of peltasts">${options([0, 8, 12, 16, 24, 32, 48].map((n) => [n, n ? `${n} men` : 'None']), side.lights ? side.lights.count : 0)}</select><select id="lightq${i}" aria-label="Quality of the peltasts">${options(Object.entries(QUALITIES).map(([key, q]) => [key, q.name]), side.lights ? side.lights.quality : 'regular')}</select></span>
      ${command}
      <div class="conts horse-conts">
        <div class="cont-row cont-head"><span>Cavalry</span><span>Riders</span><span>Wing</span><span>Quality</span><span></span><span></span></div>
        ${(side.cavalry || []).map((c, k) => `<div class="cont-row">
          <input id="hname${i}_${k}" value="${esc(c.name)}" aria-label="Name of cavalry contingent ${k + 1}">
          <select id="hcount${i}_${k}" aria-label="Riders in ${esc(c.name)}">${options([4, 8, 12, 16, 20, 24, 32, 40].map((n) => [n, n]), c.count)}</select>
          <select id="hwing${i}_${k}" aria-label="Wing for ${esc(c.name)}">${options([['right', 'Right'], ['left', 'Left']], c.wing)}</select>
          <select id="hqual${i}_${k}" aria-label="Quality of ${esc(c.name)}">${options(Object.entries(QUALITIES).map(([key, q]) => [key, q.name]), c.quality)}</select>
          <span></span>
          <button id="hdel${i}_${k}" aria-label="Remove ${esc(c.name)}">×</button>
        </div>`).join('')}
        <button id="hadd${i}"${(side.cavalry || []).length >= 4 ? ' disabled' : ''}>Add cavalry</button>
      </div>
      <div class="conts">
        <div class="cont-row cont-head"><span>Contingent</span><span>Men</span><span>Ranks</span><span>Quality</span><span>Kit</span><span></span></div>
        ${rows}
        <button id="cadd${i}"${side.contingents.length >= 5 ? ' disabled' : ''}>Add contingent</button>
      </div>
    </div>`;
  }).join('');
  box.innerHTML = `<h2>Before the battle</h2>${sideHtml}
    <p class="note">Each contingent is a tribe or a city whose men fall into the line together, side by side, in the order listed from the left as the men face the enemy. The phalanx still fights as one body under one commander; a contingent decides only where a man stands, and next to whom.</p>
    <p class="note">Each contingent can form at its own depth. A shaky one formed deeper puts fewer of its men in the front rank and more behind each of them, but makes the line shorter and easier to overlap.</p>
    <p class="note">Peltasts are light troops with javelins. They skirmish in front of their phalanx before the lines meet, then work round the ends of the enemy line and throw at men whose sides and backs are turned to them.</p>
    <p class="note">Cavalry form beyond the end of their phalanx, on the wing you choose, one squadron for each wing under one commander. They go for the enemy horse first. Once it is beaten or far enough off, they ride down light troops caught in the open, or ride round and fall on the flank and rear of a phalanx locked in the fight, and are away again before they can be caught. They will not ride into a hedge of spears.</p>
    <p class="note">Tap a man to see who he is, then tap another man of his contingent to swap their places.</p>`;
  app.config.sides.forEach((side, i) => {
    $(`depth${i}`).addEventListener('change', (e) => {
      side.depth = Number(e.target.value);
      for (const c of side.contingents) delete c.depth;
      newBattle(true);
    });
    $(`place${i}`).addEventListener('change', (e) => { side.placement = e.target.value; newBattle(true); });
    $(`lights${i}`).addEventListener('change', (e) => { side.lights = { ...(side.lights || { quality: 'regular' }), count: Number(e.target.value) }; newBattle(true); });
    $(`lightq${i}`).addEventListener('change', (e) => { side.lights = { ...(side.lights || { count: 0 }), quality: e.target.value }; newBattle(true); });
    side.contingents.forEach((c, k) => {
      $(`cname${i}_${k}`).addEventListener('change', (e) => { c.name = e.target.value.trim() || c.name; newBattle(true); });
      $(`ccount${i}_${k}`).addEventListener('change', (e) => { c.count = Number(e.target.value); newBattle(true); });
      $(`cdepth${i}_${k}`).addEventListener('change', (e) => { c.depth = Number(e.target.value); newBattle(true); });
      $(`cqual${i}_${k}`).addEventListener('change', (e) => { c.quality = e.target.value; newBattle(true); });
      $(`ckit${i}_${k}`).addEventListener('change', (e) => { c.kit = e.target.value; newBattle(true); });
      $(`cdel${i}_${k}`).addEventListener('click', () => { side.contingents.splice(k, 1); newBattle(true); });
    });
    (side.cavalry || []).forEach((c, k) => {
      $(`hname${i}_${k}`).addEventListener('change', (e) => { c.name = e.target.value.trim() || c.name; newBattle(true); });
      $(`hcount${i}_${k}`).addEventListener('change', (e) => { c.count = Number(e.target.value); newBattle(true); });
      $(`hwing${i}_${k}`).addEventListener('change', (e) => { c.wing = e.target.value; newBattle(true); });
      $(`hqual${i}_${k}`).addEventListener('change', (e) => { c.quality = e.target.value; newBattle(true); });
      $(`hdel${i}_${k}`).addEventListener('click', () => { side.cavalry.splice(k, 1); newBattle(true); });
    });
    $(`hadd${i}`).addEventListener('click', () => {
      side.cavalry = side.cavalry || [];
      const wing = side.cavalry.some((c) => c.wing === 'right') && !side.cavalry.some((c) => c.wing === 'left') ? 'left' : 'right';
      side.cavalry.push({ name: `${SIDES[i].adjective} horse ${side.cavalry.length + 1}`, count: 16, quality: 'regular', wing });
      newBattle(true);
    });
    $(`cadd${i}`).addEventListener('click', () => {
      const used = new Set(side.contingents.map((c) => c.name));
      const name = SIDES[i].contingents.find((n) => !used.has(n)) || `Contingent ${side.contingents.length + 1}`;
      side.contingents.push({ name, count: 16, quality: 'regular', kit: 'standard' });
      newBattle(true);
    });
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
      ${lightLine(w, u)}
      ${horseLine(w, u)}
      ${u.contingents.length > 1 ? `<div class="cont-list">${u.contingents.map((c) => `<div class="cont-line">
        <span class="cont-name">${esc(c.name)} <small>${QUALITIES[c.quality].name.toLowerCase()}, ${KITS[c.kit].short}</small></span>
        <span class="track" title="Nerve"><span class="fill" style="width:${pct(Math.max(0, Math.min(1, c.nerve)))}%"></span></span>
        <span class="cont-state">${c.present} ${w.phase === 'setup' ? 'men' : 'in line'}</span>
      </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

const LIGHT_MODE = {
  screen: 'skirmishing in front',
  clear: 'clearing the front',
  flank: 'round the enemy flanks',
  leave: 'making off the field',
  fallback: 'fallen back',
  broken: 'driven off',
};

// The side's light troops, in one line on its card.
function lightLine(w, u) {
  const g = w.lights[u.id];
  if (!g || !g.members.length) return '';
  const men = g.members.map((id) => w.soldiers[id]);
  const out = men.filter((s) => s.state === 'skirmishing' || s.state === 'retiring' || s.state === 'resting').length;
  const dead = men.filter((s) => s.state === 'dead').length;
  const doing = w.phase === 'setup' ? 'waiting' : LIGHT_MODE[g.mode] || g.mode;
  return `<p class="light-line"><b>Peltasts</b> ${out} of ${men.length}${dead ? `, ${dead} dead` : ''} · ${doing}</p>`;
}

const HORSE_MODE = {
  form: 'formed up on the wing',
  engage: 'charging the enemy horse',
  screen: 'covering their flank',
  hunt: 'riding down light troops',
  raid: 'raiding the enemy rear',
  pursue: 'pursuing',
  rest: 'resting the horses',
  broken: 'routed',
  leave: 'riding off the field',
};

// The side's cavalry, a line on its card for each squadron.
function horseLine(w, u) {
  return (w.horse || []).filter((b) => b.side === u.id).map((b) => {
    const men = b.members.map((id) => w.soldiers[id]);
    const out = men.filter((s) => ['riding', 'charging', 'melee', 'wheeling'].includes(s.state)).length;
    const dead = men.filter((s) => s.state === 'dead').length;
    const doing = w.phase === 'setup' ? 'waiting' : HORSE_MODE[b.mode] || b.mode;
    const which = w.horse.filter((o) => o.side === u.id).length > 1 ? ` (${b.wing})` : '';
    return `<p class="light-line"><b>Cavalry${which}</b> ${out} of ${men.length}${dead ? `, ${dead} dead` : ''} · ${doing}</p>`;
  }).join('');
}

const STATE_TEXT = {
  riding: 'Riding with his squadron',
  charging: 'Riding at an enemy',
  melee: 'At grips with the enemy, keeping his horse moving',
  wheeling: 'Wheeling away to come again',
  skirmishing: 'Skirmishing, keeping his distance',
  retiring: 'Backing away from the hoplites',
  resting: 'Out of range, picking up javelins',
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
  if (s.state === 'yielding') return 'Stepping back behind his shield, refusing the fight';
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
  if (s.kind === 'light') return `Peltast, ${s.javelins} javelin${s.javelins === 1 ? '' : 's'} left`;
  if (s.kind === 'horse') return `Horseman on the ${app.world.horse[s.wing].wing} wing${s.javelins ? ', a palton still to throw' : ''}`;
  if (!s.slot) return 'Out of the line';
  const { f, r } = s.slot;
  const depth = u.contingents[s.contingent].depth;
  const rank = r === 0 ? 'Front rank' : r === depth - 1 ? 'Rear rank, file-closer' : `Rank ${r + 1} of ${depth}`;
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
  const swapNote = w.phase === 'setup' && s.kind === 'hoplite'
    ? `<p class="note">Tap another man of the ${esc(u.contingents[s.contingent].name)} to swap places with ${esc(s.name)}.</p>` : '';
  box.innerHTML = `<h2>A man in the line</h2>
    <div class="who" style="color:${colour}">${esc(s.name)} of ${esc(s.origin)}${badges}</div>
    <p class="note">${stateText(s)}. ${roleOf(u, s)}.</p>
    ${meter('Nerve', s.nerve, colour)}
    ${meter('Stamina', s.stamina, colour)}
    ${meter('Health', Math.max(0, s.health), colour)}
    ${s.slot ? meter(s.slot.r === 0 ? 'Resolve' : 'Eagerness', Math.min(1, Math.max(0, s.resolve)), colour) : ''}
    <dl>
      <dt>${s.kind === 'hoplite' ? 'Contingent' : 'Serves with'}</dt><dd>${s.kind === 'horse' ? esc(w.horse[s.wing].contingents.find((c) => c.index === s.contingent)?.name || w.horse[s.wing].name) : s.kind === 'light' ? esc(w.lights[s.side].name) : `${esc(u.contingents[s.contingent].name)} (${QUALITIES[u.contingents[s.contingent].quality].name.toLowerCase()}, ${KITS[u.contingents[s.contingent].kit].short})`}</dd>
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
  const big = new Set(['rout', 'end', 'leader', 'contact', 'withdraw', 'overlap', 'charge', 'impact', 'yield', 'apart']);
  while (app.logged < w.events.length) {
    const e = w.events[app.logged++];
    const li = document.createElement('li');
    if (e.unit != null && w.units[e.unit]) li.dataset.side = String(w.units[e.unit].side);
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
  const rows = r.sides.map((s) => `<tr><td>${s.name}</td><td>${s.start}</td><td>${s.killedFight}</td><td>${s.killedPursuit}</td><td>${s.wounded}</td><td>${s.fled}</td></tr>`
    + (s.lights && s.lights.start ? `<tr class="sub"><td>Peltasts</td><td>${s.lights.start}</td><td colspan="2">${s.lights.killed} killed</td><td>${s.lights.wounded}</td><td>${s.lights.fled}</td></tr>` : '')
    + (s.cavalry && s.cavalry.start ? `<tr class="sub"><td>Cavalry</td><td>${s.cavalry.start}</td><td colspan="2">${s.cavalry.killed} killed</td><td>${s.cavalry.wounded}</td><td>${s.cavalry.fled}</td></tr>` : '')
    + (s.contingents.length > 1 ? s.contingents.map((c) => `<tr class="sub"><td>${esc(c.name)}</td><td>${c.start}</td><td>${c.killedFight}</td><td>${c.killedPursuit}</td><td>${c.wounded}</td><td>${c.fled}</td></tr>`).join('') : '')).join('');
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
    ${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>Men</th><th>Killed fighting</th><th>Killed running</th><th>Wounded</th><th>Ran</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${causes}${heroes}${vets}
    <div class="actions">
      <button id="repSame" class="primary">Same men again</button>
      <button id="repNew">New men</button>
      <button id="repClose">Watch the aftermath</button>
      <button id="repCopy">Copy battle record</button>
    </div>`;
  box.hidden = false;
  $('repSame').addEventListener('click', () => newBattle(true));
  $('repNew').addEventListener('click', () => newBattle(false));
  $('repClose').addEventListener('click', () => { box.hidden = true; });
  $('repCopy').addEventListener('click', (e) => copyRecord(e.currentTarget));
}

// The battle record goes to the clipboard so it can be pasted to Claude, who can replay the
// battle exactly and explain it. If the clipboard is refused, show the text to copy by hand.
function copyRecord(button) {
  const text = JSON.stringify(recordOf(app.world));
  const label = button.textContent;
  const done = (msg) => {
    button.textContent = msg;
    setTimeout(() => { button.textContent = label; }, 2000);
  };
  const fallback = () => {
    const box = $('recordBox');
    const area = $('recordText');
    area.value = text;
    box.hidden = false;
    area.focus();
    area.select();
    done('Select and copy below');
  };
  try {
    navigator.clipboard.writeText(text).then(() => done('Copied'), fallback);
  } catch {
    fallback();
  }
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
  applyInput(w, { type: 'order', unit: 0, name });
  renderAll();
}

function setTurn(v) {
  const w = app.world;
  if (w && playerCommands() && w.phase === 'battle' && w.units[0].turn !== v) applyInput(w, { type: 'turn', unit: 0, value: v });
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
  } else if (w.phase === 'setup' && app.selected >= 0 && app.selected !== picked.id && w.soldiers[app.selected].side === picked.side && w.soldiers[app.selected].contingent === picked.contingent && picked.kind === 'hoplite' && w.soldiers[app.selected].kind === 'hoplite') {
    applyInput(w, { type: 'swap', a: app.selected, b: picked.id });
    app.selected = -1;
  } else {
    app.selected = picked.id;
  }
  renderInspector();
});

$('playBtn').addEventListener('click', startOrToggle);
$('copyRecord').addEventListener('click', (e) => copyRecord(e.currentTarget));
$('recordClose').addEventListener('click', () => { $('recordBox').hidden = true; });
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
