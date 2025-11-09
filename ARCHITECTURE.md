# Ancient Warfare Prototype — Code Architecture and Behavior Guide

This document explains the current codebase (index.html + main.js + combat_rules.json), what the game is trying to achieve, and how the systems work together. It reflects all changes implemented through updates 1–29 in design.txt.

## High‑Level Overview

- Top‑down 2D ancient warfare sandbox in HTML5 Canvas.
- Player controls a single formation (unit) using WASD “tank” controls; AI controls an enemy formation.
- Individual soldiers belong to formations and try to maintain their assigned formation slots but can leave to fight or flee.
- Melee combat is pairwise “duel” driven with timers and probabilistic outcomes, affected by orders, equipment, and numerical advantage.
- Morale is dynamic: wounds, deaths, nearby losses, and state transitions (fleeing/recovering/rejoining) alter behavior.
- Debug HUD, sliders, selectors, and logs are provided for tuning and observability.

## Files and Entry Points

- index.html
  - Declares the canvas (`#field`) and HUD containers (e.g., `#hud`, `#debug`, `#info`).
  - Includes a control panel with sliders (unit sizes, power, movement, combat speed, charge multiplier) and equipment/shield selectors.
  - Loads `main.js` as an ES module.

- main.js
  - Contains the entire game model, render loop, input handling, and all gameplay systems.

- combat_rules.json
  - Defines a catalog of weapons, armour, and shields. Loaded at runtime to parameterize reach, damage blend, resistances, two‑handed restrictions, and shield HP/blocking.

## Core Systems

### Rendering and Game Loop

- Canvas and DPR‑aware sizing are initialized; `resizeCanvas` keeps the backing buffer in sync with CSS size.
- A single main loop runs at animation‑frame cadence:
  - `updateWorld(dt)` updates both formations, resolves formation overlap/push, applies ward effects, handles melee, then updates HUD and debug controls.
  - `drawWorld()` clears the canvas, draws ground grid, optional ranged arc for the player, both formations (OBB + soldiers), and over‑unit status bars.

### Input and Orders

- Input is recorded via global listeners; `Input` exposes `isDown`, `pressed`, `consume`.
- Player orders (1,3–5) select March/Ranged/Shield/Ward; Charge engages when holding Shift while moving forward.
- Stance toggle (`F`):
  - defensive: soldiers keep formation unless directly engaged.
  - aggressive: near contact, idle soldiers pursue nearby enemy targets to initiate combat.

### Data Model

- World: `{ player, enemy, target, engagedChars, selected, infoExpanded, prev }`.
- Formation encapsulates:
  - Name, color/accent, center/heading, rows/cols, slots (grid of local coordinates), radius, per‑tick velocity, order/energy/morale/ammo.
  - Soldiers array; each soldier has position, velocity, assigned slotIndex, engagement fields, equipment/armour/shield, vitals (hp/energy/morale), state flags (alive/wounded/fleeing/recovering/rejoining/fled), attack animation state, and morale caps (`maxMorale`).
  - Runtime caches: `bbHalfExtents` (bounding box of alive & active slots), minor timers for reformation/compression.

### Formation Geometry and Flow‑Around

- Slots are generated as a centered grid (rows × cols) with `SLOT_SPACING`.
- Soldiers map to the closest available preferred slot order (rear rows fill first, center columns preferred).
- The formation OBB is reconstructed from alive, non‑fleeing, non‑recovering soldiers’ slots to tightly bound the current frontage.
- Formation/formation collision uses oriented rectangle overlap; overlap depth is applied to separate.
- “Flow‑around” pathing: when the defender’s active density is low and the attacker is significantly wider, the attacker slides tangentially along the defender rather than stopping hard. This allows big frontages to seep into gaps.

### Movement and Orders

- Player’s formation accelerates/turns based on order parameters (speed, accel, turn rate). Turning is slower for wider formations.
- AI formation auto‑faces the opponent to keep frontage aligned.
- Stationary, non‑engaged formations periodically compress their front ranks (`reformFrontRanks`) so empty slots fill forward.
- A global compression pass now runs every 0.4s for all formations to keep the line tight even during contact.

### Ranged (Visual Aid Only)

- The only ranged visualization left is a translucent arc rendered when the player selects the “Ranged” order; no projectile logic is active.

## Combat and Interaction

### Target Acquisition

- Engagement is strictly based on soldier‑to‑soldier proximity (formation proximity no longer gates it):
  - Prefer unbroken targets: alive and not fleeing/recovering.
  - If none available, can engage fleeing targets (to detain and, after a short delay, kill).
  - Aggressive stance adds a small buffer to the seek radius.

### Melee Resolution

- Once a pair is engaged and within range (melee base + weapon reach), an attack timer accumulates per soldier. When attacker’s timer reaches the combat threshold, `resolveDuel` computes the outcome with weighted probabilities modified by orders, equipment, and a steep “multi‑attacker” bonus.
- Duel outcomes:
  - Both die; One dies; Both wounded; One wounded; No change (energy cost).
  - On kill/wound, morale is affected for the victim, their nearby allies, and attackers (small boosts). Shields lose HP when hits land.

### Numerical Advantage

- Multi‑attacker advantage is exponential (`3^(n-1)`), making 4v1+ essentially lethal.

### Morale and States

States per soldier:

- Active: Holds/returns to slot, fights normally. Passive morale regen when not engaged.
- Fleeing: Runs away from the enemy; morale regenerates faster. Each time a soldier flees, `maxMorale` drops by 15–25.
  - If `maxMorale < 40`, the soldier flees indefinitely and never enters recovery.
  - Fleeing units can be detained (see below) and will not transition while held.
- Recovering: Stops fleeing at morale ≥ 20; stands still. At morale ≥ 40, reassigns a rear‑rank slot and starts rejoining the formation. Recovering is fragile — if engaged during recovery, the soldier immediately flees again and takes another morale‑cap penalty.
- Rejoining: Navigates back to the assigned slot; once reached, resumes Active state.
- Dead: Rendered as a faint circle; no weapon/shield visuals.

Morale propagation:

- Wounds reduce own morale; kills slightly boost killer morale.
- Nearby allied deaths apply a strong local morale penalty and a small global penalty within the unit.
- Nearby enemy deaths provide a small local morale boost.

### Detaining Fleeing Targets

- If the only target is fleeing, an attacker can “hold” that target (sets `held=true`) without allowing the target to move.
- A detainment timer (3–5 seconds) runs; upon completion, the fleeing target is killed, the defender’s formation ripples slots, and the attacker is freed to retarget.
- This creates a small window for other fleeing troops to escape.

### Breaking and Disbanding Units

- A formation is considered “broken” when there are no fully active soldiers (everyone dead or in fleeing/recovering states).
- When broken for the first time, the unit disbands:
  - All remaining soldiers are forced to flee permanently (no rejoin), slots are cleared, collision/OBB stops being drawn, and formation/formation push/combat are skipped for that unit.
  - A debug log line notes the disbanding event.

### Round Pushes

- While formations overlap, the system runs round timers that collect engagement outcomes across the line. At each threshold, the side with more kills+wounds applies a small “retreat push” to the other formation.

## Equipment, Shields, and Rules

- Equipment and armor are defined in `combat_rules.json` and loaded at startup. Each soldier references `equipment`, `armourType`, and `shieldType`.
- Two‑handed weapons suppress shields; shield HP rings are drawn and degrade on hits.
- Weapon reach feeds into melee range; simple damage channels (impact/slash/pierce) are blended through armour conversion and resistances.

## UI, HUD, and Debugging

- HUD displays player order, energy/morale, formation dimensions, target, enemy morale, and current stance.
- Debug controls (sliders/selectors) tune unit sizes, combat power, speeds/turning, and equipment/shields. Actions to randomize or set equipment/shields are wired.
- Debug log (`#debug`) displays a scrolling feed of combat/morale events and small system messages (e.g., stance toggles, round pushes, disband messages).
- Info panel shows details for a clicked soldier: health, energy, morale, equipment/shield (with HP), action, and extended stats (kills, wounds, fled, etc.).
- Over‑unit bars: three compact bars above each formation show total Health (relative to original total HP), and average Morale/Energy across currently active (non‑fleeing, non‑recovering, non‑rejoining) soldiers.

## Important Utilities

- Geom helpers: `angleWrap`, `mixAngle`, oriented overlap test, formation `forwardVec`/`rightVec`.
- Interpolation: `mix`, clamping, and easing for movement and timers.
- Slot/footprint maintenance: `rebuildSlots`, `remapSoldiersToClosestSlots`, `reformFrontRanks`, and `recomputeBBFromAliveSlots`.
- Global debug constants in `DEBUG` allow runtime tuning.

## Controls Summary

- Movement: W/A/S/D
- Orders: 1 March, 3 Ranged, 4 Shield, 5 Ward
- Charge: Hold Shift while pressing W
- Stance toggle: F (Defensive/Aggressive)
- Formation depth: ArrowUp/ArrowDown or E/Q when stationary
- Target select: Space (or click near enemy OBB)
- Click a soldier to inspect in the info panel.

## Design Intent and Outcome

The code aims to approximate the “feel” of ancient formations clashing:

- Individuals try to maintain a coherent frontage but peel out to fight or fall back.
- Weight of numbers matters dramatically; isolated soldiers die quickly.
- Morale and cohesion create cascading effects — recover → rejoin → fight, or flee repeatedly until morale caps make breaking inevitable.
- Large frontages can press into or around crumbling lines instead of being pinned by a single blocker.
- The player can bias behavior with stance and orders but must manage cohesion and contact.

## Known Limitations / Future Work

- Ranged and ammunition are visual only; no projectiles/aiming.
- Detainment kill is simplified (no separate animation/hit), applied after a short timer.
- Disbanded formations still exist to let remaining soldiers flee off map; a cleanup pass could remove the whole unit after everyone exits.
- AI behavior is minimal (face and stand ground unless disbanded).
- Balance values (morale deltas, detain duration, push speeds, etc.) are tuned heuristically and may need further iteration.

## Quick Map of Key Functions (main.js)

- Loop and render: `updateWorld`, `drawWorld`, `drawFormation`, `drawUnitBars`, `drawRangeArc`, `drawGround`
- Formation API: constructor, `rebuildSlots`, `remapSoldiersToClosestSlots`, `reformFrontRanks`, `recomputeBBFromAliveSlots`, `update`, `applyInput`, `updateSoldier`, `onSoldierDeathByIndex`
- Combat: `handleMelee`, `resolveDuel` (probabilistic outcomes), `effectiveDamage`, `applyRoundPush`, `updateContactRound`
- Interaction: `resolvePush` (with flow‑around), `applyWardZone`
- Rules: `loadRules` (sets shields for two‑handers), equipment/armour/shield helpers
- UI/Debug: `updateHUD`, `updateInfoPanel`, `updateDebugControls`, `logDebug`

---

This document is intended to help you navigate, tune, or extend the prototype quickly. If you’d like, I can add inline JSDoc style comments to `main.js` next for editor tooltips and better IDE navigation.

