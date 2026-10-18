import { SIM_VERSION } from './rules.js';
import { createBattle, startBattle, stepBattle } from './world.js';
import { swapMen } from './unit.js';
import { playerOrder } from './ai.js';

// Everything the player does goes through applyInput, which also writes it into the battle's
// record with the simulation step it happened on. Because the simulation is deterministic,
// the starting setup plus these inputs reproduce the battle exactly.

export function applyInput(world, input) {
  const u = world.units[input.unit ?? 0];
  let ok = true;
  if (input.type === 'swap') {
    swapMen(world, world.units[world.soldiers[input.a].unit], world.soldiers[input.a], world.soldiers[input.b]);
  } else if (input.type === 'turn') {
    u.turn = input.value;
  } else if (input.type === 'order') {
    ok = playerOrder(world, u, input.name);
  }
  world.inputs.push({ step: world.step, ...input });
  return ok;
}

// A battle record: enough to replay the battle exactly, plus a readable account of it in case
// the simulation has changed since and an exact replay is no longer possible.
export function recordOf(world) {
  return {
    pulsy: SIM_VERSION,
    step: world.step,
    config: world.config,
    inputs: world.inputs,
    result: world.result,
    timeline: world.timeline,
    events: world.events.map((e) => [Math.round(e.t * 10) / 10, e.kind, e.text]),
  };
}

// Rebuild a battle from its record, step for step, up to the moment the record was taken.
export function replay(record, onStep) {
  const world = createBattle(record.config);
  const inputs = [...record.inputs];
  let i = 0;
  while (i < inputs.length && inputs[i].type === 'swap') applyInput(world, inputs[i++]);
  if (record.step > 0 || i < inputs.length) startBattle(world);
  while (world.step < record.step) {
    while (i < inputs.length && inputs[i].step === world.step) applyInput(world, inputs[i++]);
    stepBattle(world);
    if (onStep) onStep(world);
  }
  return world;
}
