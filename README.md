# Pulsy

A top-down simulation of ancient infantry battle, built from individual soldiers up.
Fighting comes in pulses: men step into the gap, fight, and fall back, until one side's nerve gives out.
See [DESIGN.md](DESIGN.md) for what it is meant to be.

## Run it

- **Quickest:** open `dist/pulsy.html` in a browser. It's a single self-contained file.
- **While developing:** `npm run serve`, then open http://localhost:8000.
  (Opening `index.html` directly won't work, because browsers block ES modules from `file://`.)
- **Rebuild `dist/`** after changing code: `npm run build`

## Balance testing

```
node tools/headless.js [battles] [blueFiles] [redFiles] [bluePlacement] [redPlacement]
node tools/headless.js 120 10 10 xenophon random
```

Prints endings, time from contact to decision, surges per battle, and casualties.
With no frontages given it runs the default setup (veteran, green, veteran Athenian tribes against
two regular Boeotian cities); with them, two plain 40-man units.
Placements: `xenophon` (best front and rear), `front`, `rear`, `random`.

## Contingents

Before the battle, each side can be built from up to five contingents (tribes, cities) that
stand side by side at the same depth: "Add contingent", then set its men, quality and kit.
The phalanx still fights as one body under one commander; a contingent decides only where a man
stands, and next to whom. A weak one shows through its men: they waver, give ground and run first.
Each contingent can also form at its own depth ("Ranks"); "Depth, all" sets every contingent at once.

## Battle records

"Copy battle record" (under the battle log, and in the end report) copies everything needed to
replay a battle exactly: the setup, any men swapped before it, and every order given, each
stamped with the simulation step it happened on. It also carries a timeline of both sides
and the log, so an old battle can still be explained after the simulation has changed.

```
node tools/replay.js record.json
```

Replays the battle, confirms it matches the record, and prints the setup, the player's
orders, the log, a timeline of both sides and why it ended. Bump `SIM_VERSION` in
`src/sim/rules.js` whenever a change alters how battles play out.

## Layout

- `src/sim/` simulation (no DOM), `src/render/` canvas drawing, `src/ui/` page wiring
- `src/sim/rules.js` all tuning numbers and equipment
- `legacy/` the first prototype, kept for reference
