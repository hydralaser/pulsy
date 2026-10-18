# Pulsy — Design

A top-down simulation of ancient infantry battle, built from individual soldiers up.
This document is the spec. Code changes should be checked against it; if the game
needs to behave differently, change this document first.

Supersedes `design.txt` (kept for history) and `ARCHITECTURE.md` (describes the old prototype).

---

## 1. Vision

Two bodies of men meet. Nobody wants to be in the gap between the lines, so most
of the battle is two shield walls a few paces apart, with fighting coming in
**pulses**: brave men step in and the men beside them follow, there are a few
seconds of real violence, then a lull while both sides catch their breath. Every
pulse wears down nerve. Eventually one side stops coming back. Sometimes it
**routs**, sometimes it **withdraws** in order, and sometimes both sides are spent
and **pull apart**.

The battle is decided by **nerve, cohesion, depth, flanks and fatigue**, carried
by named individuals whose courage and reputation matter. Equipment adjusts the
odds; it does not decide them.

Historical stance: the heterodox reading of hoplite and ancient infantry combat
(Krentz, van Wees; popularised by Bret Devereaux). There is **no literal mass shove
(othismos)**. Depth matters for nerve and replacement, not for physical weight.
The setting is "ancient" broadly; Greek kit is the first content set, not a limit.

## 2. Pillars

1. **Fear is the main mechanic.** Men choose how close to get. Most of the time
   they choose not to.
2. **Pulses, not a grind.** Contact is intermittent: surge, lull, surge.
3. **Every man is someone.** Named soldiers with courage, skill and reputation,
   and a record of what they've done. Where you place them is a real decision.
4. **Explainable outcomes.** After a battle you can say *why* it went that way.
5. **Not always a rout.** Rout, withdrawal and mutual disengagement are all
   normal endings.

## 3. The battle, beat by beat

1. **Approach.** Units march, keeping their ranks. The enemy AI turns to meet the
   threat, holds, advances, or tries to overlap a flank.
2. **Closing.** Somewhere around spear reach plus a pace, the lines stop on their
   own: the men's willingness to get closer runs out. This **gap** is the resting
   state of contact.
3. **Surge.** Front-rank men whose courage beats the current fear step into the
   gap and attack. Neighbours are pulled along by a man stepping forward,
   especially a man with a reputation. A surge spreads along the line from where
   it started.
4. **Fighting.** During a surge, men in reach trade blows. Most blows are stopped
   by shields or armour. Some wound and a few kill.
5. **Lull.** As fatigue and fear build, men ease back to the gap. Both sides
   steady, shout, recover a little stamina and nerve, and replace the fallen from
   the rank behind.
6. **Repeat.** About 4–8 surges in a 1–3 minute fight. Each one costs both sides
   nerve and stamina, and only partly recovers in the lull.
7. **Ending.** When a unit's nerve fails it either:
   - **routs** (fast collapse, men run, pursuers kill many),
   - **withdraws** (backs away still formed, few losses, can rally), or
   - both units **disengage** by mutual exhaustion (standoff).
8. **Pursuit.** Winners may chase. Pursuit is where most of the killing happens,
   but pursuers lose formation and become vulnerable.

### What drives a surge

- Front-rank men build **resolve** during a lull: faster if brave, rested and steady, next to
  a veteran or the leader, and when the men beside them are working up too (shouting each
  other on). You can see it: they lean forward out of their places.
- An **opening** across the gap gives a sharp boost and a specific target: a man stepping
  back with his guard down, a wavering or badly wounded man, a hole in the enemy line.
- Stepping into the gap alone is terrifying, so a man waits for the men beside him unless he
  is brave enough for the opening he sees. When one goes, his neighbours are pulled after him
  and the surge spreads along the line.
- Fighting burns resolve, faster for the timid, the tired and a man left on his own. When it
  is gone he steps back, and he must catch his breath before he can work himself up again.
  Surge length and lull length both come out of this.

### The ranks behind, and agreeing to a lull

- The men behind the front rank are fresh and can hear the fight. They work themselves up to
  get into it and, once really eager, press forward, closing up behind the men in front and
  driving the front rank on.
- Nobody can step back through the man behind him. A tired front rank calls "enough, step
  back!", but it is held in the fight until the ranks behind give way.
- That call is passed back rank by rank and takes a moment to sink in. Veterans pass it on and
  heed it; raw men pass on only part of it and are slow to listen. The leader can shout the whole
  unit back, and the respect he commands decides how far it carries.
- A lull is the whole file agreeing: the rear eases off first, which makes room, and then the
  front steps back. A unit without veterans tends not to agree, and its front rank is pressed
  into the fight until it is exhausted.
- With a veteran on hand to organise it, a spent front-rank man can swap places with an eager
  fresh man behind him. In an undisciplined crush the tired man is simply stuck.

### Refusing the fight

- A surge does not have to be accepted. A tired or resting front-rank man who is attacked steps
  back behind his shield rather than trade blows, if there is room behind him; he is hard to
  hit and strikes back only now and then. A fresh man fights back; a pinned man has to.
- A disciplined unit whose front rank is spent can give ground as a whole: it steps back in
  order behind its shields, its rear making room, and lets the enemy push run out. Following
  up loosens the attacker's ranks. When the push is spent, a well-led unit turns on the tired
  enemy. An undisciplined unit cannot make room to do this.
- Exhaustion bites hard: tired men hit and block much worse, and a man crushed between the
  enemy and his own rear blocks worse still.

### The formation moves as a body

- Each man keeps a body's length behind the man in front of him, reacting to where that man
  was a moment ago. A step back at the front ripples back through the file; a surge draws
  the ranks behind up after it.
- A man taking blows is driven back a step at a time and the ranks behind give with him. If a
  line is pushed back along its whole front it gives ground as a unit, and the enemy takes it.
- A charge's impact drives the struck front rank back and the shove travels through the ranks;
  the charging side's rear ranks carry on into the men in front of them.

### Charges

- In the last ~30 m a confident unit may break into a run. Running costs stamina and
  **cohesion** (how well men keep their places). A disordered line shields worse, lets an
  extra attacker reach each man, and frightens more easily.
- A charge frightens the men it is coming at: more if it is ordered, fresh and bigger than
  them. Men standing braced behind their shields are less shaken; men running to meet it least.
- **Counter-charge:** answering a charge by running out to meet it cancels most of the
  one-sided shock of impact. Both lines crash together disordered and the first exchange is
  more violent for both, but neither gets the upper hand from the charge itself.
- **Bracing:** holding still keeps cohesion and blunts the impact, but men endure the fear
  of watching the charge come on.
- **Breaking before contact** is possible but rare: a line that loses heart as a charge
  comes on turns before impact. It breaks from the rear; the front ranks are boxed in and
  are the ones caught (as observed in the Sur le Champ hoplite experiment, 2025).
- Each side also has a **spirit** for the day (omens, hunger, a long march) that shifts every
  man's nerve slightly, so evenly matched units are not identical.

### Why it ended

- A commander pulls his unit out when his men are badly shaken, unless he can see the enemy is
  worse off (lower nerve, more men running), in which case he holds on a little longer.
- The end report says which decision ended the battle and on what evidence, for example: "The
  Athenian commander pulled his men back when their nerve fell to 45% (the Boeotians were at
  54%), though the Boeotians had lost more men."
- Every battle can be copied as a record that replays it exactly, player orders included.

## 4. Soldiers

Each soldier is generated with:

| Attribute | Meaning |
|---|---|
| Name, origin | Flavour, shown in the inspector |
| **Courage** | Willingness to close and stay; resistance to fear |
| **Skill** | Fighting ability in an exchange |
| **Reputation** | How much his presence steadies, and pulls forward, the men near him. Grows with deeds |
| **Stamina** | Drains during surges, recovers in lulls |
| Nerve (current) | Moment-to-moment fear budget, from courage, what he sees and who is near |
| Equipment | Weapon, shield, armour (data-driven, see §8) |
| Wounds | Specific wounds with lasting effects (arm: skill cap, leg: speed, etc.) |
| Record | Kills, wounds given and taken, battles fought, times fled, notable moments |

**Veterans** are soldiers with high reputation and a battle record. They persist
between battles once there is a campaign layer (later).

### Soldier states

One explicit state machine. No ad-hoc flags.

```
InRank ──► Surging ──► Fighting ──► Recoiling ──► InRank
   │                                              ▲
   ├──► Wavering ──► Fleeing ──► Rallying ────────┘ (rejoins at rear)
   │                     │
   └──────────────────── ┴──► Dead / Captured
```

- **InRank:** holds his slot, or the gap line if he's in the front rank.
- **Surging / Fighting / Recoiling:** one cycle of contact.
- **Wavering:** nerve low; won't surge, drifts back, spreads fear.
- **Fleeing:** runs. Very vulnerable.
- **Rallying:** got clear, recovering; may rejoin his unit at the rear.

## 5. Units and formation

- A unit is a grid of **slots** (files × ranks) that move together.
- **Slot roles matter:**
  - **Front rank:** fights; starts and joins surges.
  - **Rear rank (file-closers):** don't fight much; strongly steady the men in front
    of them and make it harder for the file to run.
  - **Ends of the line:** exposed if overlapped; fear builds faster there.
  - **Middle:** shielded on all sides; the safest place for weak men.
- Xenophon's advice (best men front and rear, weakest in the middle) should be a
  *good* setup, but not the only good one.
- **Losses close forward.** When a front man falls or flees, the man behind steps
  up and walks into the slot. Files get shorter from the back.
- **Unit nerve** is the aggregate of its men's nerve, weighted by rank and role. It
  drives unit-level decisions (hold, give ground, withdraw, break).
- **Cohesion:** how well men are in their slots. Low cohesion amplifies fear and
  exposes men to multiple attackers.

### Contingents

A phalanx is rarely one body of equal men. Athenian hoplites stood by tribe, Boeotians by
city: a man who turned up for the battle fell into the line, but he stood with his friends
and neighbours. So a line can be a veteran tribe, then a green and poorly armed one, then
another veteran tribe. A side can be built from up to five **contingents** that stand side
by side at the same depth, each holding a block of files, with no gap between them.

**The phalanx still fights as one body.** It has one commander, one set of orders, and it
advances, charges, gives ground, withdraws and breaks as a whole. A contingent decides only
**where a man stands, and next to whom**:

- Each contingent has its own **quality** (veteran, regular, green: veterans in its ranks,
  courage, skill, reputation) and **kit** (well equipped, standard, poor), and its men come
  from its own towns.
- Men are placed (and can be swapped) only **within** their contingent. Losses close forward
  from the man's own contingent first, from the files beside it only if it has no one to
  spare. A man coming back to the line looks for a place among his own people first.
- A man's own tribesmen running frightens him more than strangers from further down the line.
- Each contingent's most respected man stands for its leader **in the story**: he is named
  in the log when he falls, and wears a thin ring on the field. He gives no orders. Nobody
  waits for him to join a charge.
- **A charge spreads along the line.** It starts where the commander stands, and each man
  breaks into a run when he sees the man beside him or in front of him go: the brave and
  keen at once, the timid a moment later (about 0.3 s a man, before courage and nerve). The
  run takes 2 to 3 seconds to cross the whole line, and late starters catch up because a
  running man is faster than the line's charge pace.
- **You should be able to see the weak contingent without being told**, from its men: they
  waver more (about one man at a time wavering among the green Aigeis, almost none among
  the veterans), get pushed back further, fall more often, and are nearly always the first
  to run. Because the line is one body, the rest of it has to hold that stretch up, and a
  weak stretch can drag the whole line down with it.
- "Why it ended" says where the break began ("It began among the Aigeis: 5 of their 16 men
  had run before the rest gave way") and notes a weak stretch the winning side survived.

An earlier version made contingents bodies of their own, with their own leaders and
decisions, able to break separately, fall out of step and wheel onto flanks. It made the
line fight like several small armies, which is not what a phalanx was, so it was taken out.

### Exposure

How many enemies can reach a man depends on his neighbours:
- Friends on both sides: at most ~2 attackers (more only with long reach from
  behind the enemy front).
- One open side: more attackers, more fear.
- Alone: anyone can reach him, and he knows it.

Overlap at the end of a line is dangerous mainly because of this fear, and only
then because of the blows.

## 6. Nerve

Nerve is the core system. Each soldier's nerve moves with:

| Lowers nerve | Raises nerve |
|---|---|
| Being wounded; wounds nearby | Enemy falling nearby |
| Friends falling or fleeing nearby | A man of reputation nearby |
| Exposed side or rear; being overlapped | Friends close on both sides and behind |
| Fatigue | Lulls (partial recovery) |
| The unit giving ground | The unit gaining ground |
| The commander falling | Commander nearby; good orders |

Fear **spreads** from wavering and fleeing men to their neighbours. Courage
**spreads** from steady veterans. A break is a cascade, often starting at the rear
or an exposed end rather than the front.

**Ending selection:** a failing unit routs when the cascade is fast (low cohesion,
exposed, little depth); it withdraws when nerve is low but the rear ranks and
officers still hold; both units disengage when both are below a willingness-to-surge
threshold for a sustained time.

## 7. Command

**Version 1:** you command one unit. Orders: Advance, Halt, Give ground,
Withdraw, Close up, Widen/Deepen, and Surge ("follow me!") as a deliberate push
on nerve that triggers a surge at the cost of stamina.

**Later:** you are one soldier in the formation (§10). Orders spread from your
position by voice, so men near you respond first. Orders to other units go by
runner, with delay and some risk of not arriving.

**If your soldier dies,** the unit passes to your designated **second** under AI
command, with a nerve shock across the unit (larger if men near you saw it). You
continue as an observer or, later, as someone else.

The enemy unit uses the same AI as "your second".

## 8. Equipment

Data-driven (`rules.json`). Starting content is broadly ancient with Greek first:

- **Weapons:** dory (thrusting spear), xiphos, kopis, javelins (later), sarissa
  (later). Properties: reach, damage type mix, one or two handed, how well it can
  be used from the second rank.
- **Shields:** aspis, pelte, none. Properties: block, coverage of the man to the
  left, weight/fatigue.
- **Armour:** none, linothorax, bronze cuirass, helmet types. Properties:
  protection by damage type, fatigue cost, vision/hearing penalty (helmets dull
  orders and awareness).

Equipment changes exchange odds and fatigue; nerve, cohesion and position matter
more.

## 9. Version 1 scope (unit vs unit)

**In:**
- Two units of 20–60 men, one player-commanded, one AI.
- Formation movement, facing, resizing, losses closing forward.
- Gap, surge and lull, with exchanges, wounds and deaths.
- Nerve system with spreading fear and courage; rout, withdrawal and disengagement.
- Pursuit and rallying.
- Named soldiers, inspector panel, battle record.
- Pre-battle placement: drag named men into slots.
- Debug overlay: nerve heat map, surge markers, state labels, event log.
- **Headless runner** for balance testing (see §11).

**Out (later):** player as a soldier in the ranks, runners, multiple units per side,
ranged troops, cavalry, terrain, campaign and persistent veterans.

## 10. Later phases

1. **Embodied commander:** your man stands in a slot; orders spread by voice;
   death passes command to the second.
2. **Multiple units and runners.**
3. **Troop types:** skirmishers, javelins, archers, cavalry, other cultures' kit.
4. **Terrain and battlefield scale.**
5. **Campaign:** veterans persist, reputations grow, men retire, die and are mourned.

## 11. Success criteria

Checked with the headless runner (seeded, many battles per matchup):

- **Duration:** contact to decision usually 1–3 minutes of game time.
- **Pulses:** typically 4–8 surges per engagement, with visible lulls.
- **Endings:** in an even matchup, a mix of routs, withdrawals and disengagements
  (no single outcome over ~70%).
- **Casualties:** low during the fighting; the bulk of a losing side's dead come in
  pursuit. Rough historical anchor: victors ~5%, losers ~15% in hoplite battles
  (Krentz).
- **Placement matters:** the same men arranged differently produce measurably
  different win and casualty rates.
- **Explainability:** the end-of-battle report names the main causes (flank
  turned, cascade from the rear, stamina exhausted, commander fell, ...).
- **Determinism:** the same seed and inputs give the same battle.

## 12. Technical approach

- Plain JS modules, no build step needed to develop; serve the folder with any static server.
- **Fixed-step simulation** (20 Hz), separate from rendering; seeded RNG; processing order
  alternates each step so neither side acts first.
- Layout:
  - `src/sim/`: `world` (battle setup, soldier state machine, movement, ending), `unit`
    (formation, slots, closing ranks), `combat`, `nerve`, `ai` (unit commands and the AI
    second), `rules` (all tuning numbers and equipment), `names`, `rng`, `core`
  - `src/render/draw.js`: canvas drawing
  - `src/ui/app.js`: page wiring, setup, orders, inspector, log, report
  - `tools/headless.js`: runs battles in Node and prints statistics
  - `tools/bundle.js`: builds single-file pages into `dist/`
- The simulation never touches the DOM, so it runs headless.
- Tuning values live in `src/sim/rules.js`, not in the logic.

## 13. Open questions

- How visible should the pulse rhythm be: subtle, or obvious enough to read and
  time your own "follow me!"?
- Can units interpenetrate, or relieve a tired front by passing a fresh unit through,
  in later phases?
- Should captured men be a thing (ransom, campaign consequences)?
