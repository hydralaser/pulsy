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

## Light troops

Each side can field peltasts ("Peltasts" in the setup: how many, and their quality). They
skirmish in front of their phalanx before the lines meet, then work round the ends of the enemy
line and throw at men whose sides and backs are turned to them, which is the answer to being
overlapped.

## Cavalry

Each side can field horsemen ("Add cavalry" in the setup), in contingents on the right or left
wing. All the horse on one wing is one squadron. They fight the enemy horse first; once it is
beaten or far enough off, they ride down light troops caught in the open or fall on the flank
and rear of a phalanx locked in the fight, and are away before they can be caught. They will not
ride into a hedge of spears, and come off badly if they are caught standing among the enemy.

## Wounds

There are no hit points. A blow or a javelin that gets past the shield gives a man one wound
from a table for that kind of weapon (spear-point, blade, thrown javelin, heavy blow, or a wound
to his horse): where it is, how bad, and what it does. Most are grazes, cuts and bruises.
Armour covers particular places (a Corinthian helmet the face but not the eye-slits, greaves
the shins) and turns or blunts what meets it. Men bleed, drop back, go down and may die where
they lie or after the battle; some carry a mark for life. Tap a man to see his wounds; the
report counts the killed, the dead of wounds and the marked.

## The village

`village.html` (built to `dist/village.html`, which carries the battle page inside it) is the start of the campaign: Oinoe, a walled
village of about a hundred people on the Boeotian border. A year takes about forty minutes at 1×,
with pause (space) and faster speeds. You give work to households: tap a household's men or its
women, several households if you like, then a place on the map. They walk out at dawn, work, and
are home by dark. Plough and sow in autumn, reap in early summer, keep the woodpile up through the
winter, keep the flock watched. You are the village's leading man; each household owns its own land, sheep and stores, trades
at the gate, hires out, borrows, and pays a levy you set into a common granary. The village saves
itself in the browser as it goes. What is planned next is in ROADMAP.md.

Every year or two a strategos calls on the village for men against the Boeotians. You choose what
share of the fighting men go; the card shows how many that is and who sends whom, households
owing part of a man clubbing together and paying the one who sends him. The battle then opens
over the village with your men as their own contingent in the general's line. If they are its
largest contingent you command the phalanx; if not, you lead only them: steady, at them!, hang back,
or run. Your men wear a gold pennant on the field. The other contingents' leaders do the same by
their own tempers, which you get to know battle by battle. Shouting your men on makes better
soldiers of them; the best fighter on the field, if he is yours, is called the hero of the place.
Refuse the city's fines often enough and it will send men to kill you. Men can also be chosen one
by one and sent to drill for war at the drill ground outside the gate; households drill of their own
accord when their work is done, the rich most. Contingent leaders are men in the line and can fall;
the next man of standing takes over.
Who died, who was wounded, who ran and how the village bore itself come home with the survivors.
`node tools/campaign.js [villages] [share] [stance]` sends villages to war headless.

## Command

"Command" in the Athenian setup chooses what you command: the phalanx, the peltasts, or the horse
on one wing. Your officers command the rest, or all of it if you leave it to them. The orders
panel shows the orders and their keys for whatever you command.

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
