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
Placements: `xenophon` (best front and rear), `front`, `rear`, `random`.

## Layout

- `src/sim/` simulation (no DOM), `src/render/` canvas drawing, `src/ui/` page wiring
- `src/sim/rules.js` all tuning numbers and equipment
- `legacy/` the first prototype, kept for reference
