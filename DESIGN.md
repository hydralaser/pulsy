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
   - both lines **draw apart** by mutual exhaustion. This is not the end: they step
     back about 45 m, out of reach, and rest. Strength comes back slowly (a spent man
     needs a minute and more), so the pause is long, and the light troops go back out
     between the lines and skirmish as they did before the battle. A line goes in again
     only once it is rested and has its heart back. Rest does not give everything
     back: a man recovers, in nerve and in strength, three quarters of the way from the
     lowest the fight brought him to towards what he went into it with. A man who went
     in at 100 and was brought to 40 can rest back to 85; if the next fight brings him
     from 85 to 30, he can rest back to 71. Then the approach, the charge and
     the fight start over. If neither will go in again within 150 s, the battle ends
     as a standoff.
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
  Men further back feel it less: they see less of it and have ranks of their own between them
  and it. Only the front rank takes its full fright; each man in front of a man takes away a
  little, and five or more take away 60%. The middle of a deep column hears the charge more
  than sees it.
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
| Wounds | Each one a specific wound from the tables (§4a): where, how bad, who gave it, what it does to him |
| Blood | Lost to wounds, at once and as they bleed. Out of the fight when he has lost too much; dead at none |
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
   └──────────────────── ┴──► Down ──► Dead
```

- **InRank:** holds his slot, or the gap line if he's in the front rank.
- **Surging / Fighting / Recoiling:** one cycle of contact.
- **Wavering:** nerve low; won't surge, drifts back, spreads fear.
- **Fleeing:** runs. Very vulnerable.
- **Rallying:** got clear, recovering; may rejoin his unit at the rear.
- **Down:** on the ground and out of the fight, but alive. He may bleed to death, be
  finished off where he lies if the enemy is standing over him, or live to be carried
  off.

### 4a. Wounds

There is no hit-point pool. A blow that gets past the shield picks one wound from a
table, and that wound is what happens to the man.

- **Tables by kind of wound,** about a hundred entries each: *thrust* (spear, palton,
  javelin in hand), *cut* (xiphos, kopis), *missile* (thrown javelins), *blunt* (a blow the
  armour stops but that still hurts, being ridden down, a fall from a horse) and *horse*
  (wounds to the mount). Each entry has a weight, a place on the body (skull, face, eye,
  neck, shoulder, armpit, chest, ribs, belly, groin, back, arm, hand, thigh, knee, shin,
  foot...), a grade, the words for it and any special effect.
- **Grades:** slight (a graze or bruise: it stings and shakes him), light (a flesh wound
  that bleeds for a while), serious (deep, or a part of him stops working), grave (he
  will soon be on the ground), mortal. Most blows are slight or light; armour turns many
  more of them into bruises.
- **Where blows land** depends on where they come from: face to face, over the front
  man's shoulder from the second rank (head and shoulders), from behind (the back), up at a
  horseman (his legs) or down from one (head and shoulders). From the front, the side
  away from the shield is hit more often. A skilled man looks for the gaps in the armour.
  A kopis, or a javelin thrown from close by, makes the worse wounds likelier.
- **Armour covers places, not a percentage.** A Corinthian helmet covers the skull, face,
  jaw and part of the neck, but not the eye-slits or the mouth; a pilos only the skull. A
  bronze cuirass covers chest, belly and back; a linothorax also the shoulders, and its
  pteruges the groin. Greaves cover knee and shin. A blow that meets armour may be turned
  (a glance, or for a heavy blow a bruise, cracked rib or ringing head from the blunt
  table) or get through one grade less bad. The armpit, the groin under a bronze
  cuirass, the thigh, the arms and the eyes are always open.
- **What a wound does:** blood lost at once and bleeding after, slowing as it clots (a
  great vessel bleeds far faster); pain (nerve) and wind (stamina); the right arm wounded
  spoils his fighting, the left his shield; a leg slows him; a torso wound lowers the
  stamina he can get back. Some wounds put him down outright (a shattered knee, a hamstring
  cut, knocked senseless), some kill at once (a spear through the throat). An eye lost
  leaves a blind side that blows come from; both, and he is out.
- **His blood** is what used to be health: as it goes he fights worse, a front-rank man
  drops back, and when he has lost too much he goes down. The wounds keep bleeding.
- **A horse** takes its own wounds: it slows, and its rider's nerve with it, and a horse
  brought down throws him.
- **After the battle,** a man down on a field the enemy holds may be killed where he lies.
  The rest are bound up, but some have already bled too much, and belly wounds kill many
  men in the days after. The report counts the dead of wounds apart from the killed.
- **Lasting marks:** some wounds leave something for life: one eye, a lame leg, missing
  fingers, a ruined face. The inspector says so when it happens; a veteran or a leader
  gets a name from it (Hypatodoros the One-eyed), and the report lists the marked.

Tuned so a man takes about as many blows to put out of action, and loses about as much nerve
to each, as under the old health model, but not held to its numbers: few blows put a man
straight out, most bad wounds give him time to drop back first, and what follows from the
wounds is allowed to follow. Blows between two horsemen on the move glance; a horseman's thrust
down at a man on foot has the horse's weight behind it; blows from behind find the backs of the
legs and the neck as often as the armoured back. One result is that cavalry kill fewer
hoplites than before: a raid on the rear of a phalanx meets a lot of bronze.

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
- **Each contingent can form at its own depth** (at Delion the Thebans stood 25 deep and the
  rest "as they pleased"). The front rank stays straight, so a deeper contingent is narrower
  and reaches further back. A shaky contingent formed deeper puts fewer of its men in the
  front rank and more men behind each of them. With 40-man contingents (veteran, green,
  veteran against regulars), the green one formed 4 deep ran 32% of its men and the line
  lost 15–25; formed 8 deep it ran 18% and the line won 24–15.
  The price is a shorter line that is easier to overlap.
- **Overlapping ends wrap round.** Once the lines are locked together, the whole overhanging
  end of a line, with nobody in front of it, wraps round the enemy's end like a rope round a
  post: in an arc a spear's length off his front corner, down his flank, and, if it is long
  enough, round his rear corner and along his back. Each file takes the next place along
  the curve, its ranks trailing outward; the files nearest his corner bend first and those
  further out follow. It is the line itself bending, not a body leaving it, and there is no
  limit on how far it wraps. The enemy's outermost file turns its shields outward to meet it
  ("refusing the flank"); its men then count the men in front of and behind them in their
  file as the friends at their side.
  Without light troops, overlap is decisive (4 deep beats 8 deep 20–3 with 48 regulars a
  side). The counter is light troops: their presence alone stops men wrapping round (see
  **Light troops** below).
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

### Light troops

Each side can field **peltasts**: light men with a wicker pelte and a bundle of javelins, no
armour, in loose order. They are their own bodies, not part of the phalanx: each man moves on
his own, keeps his own distance and picks his own target; the group only decides what they
are about.

- **The skirmish.** They start in a loose screen about 16 m in front of their phalanx, so
  the two screens begin just out of each other's reach (javelins carry about 24 m). Against
  men who can throw back, nobody stands in range and lobs: each man waits just out of the
  enemy's reach, runs in when he has a javelin ready, throws from the edge of range (about
  22 m) and runs straight back out while he readies the next, about five seconds later.
  Darting in puts him within reach of enemy men waiting at their own spots, who can throw
  if they are ready, and a man on the move is harder to hit. A man spends about a fifth of
  the skirmish inside enemy reach; two equal screens of 24 lose about one man each.
  Against hoplites, who cannot throw back, he simply stands at a comfortable range and
  keeps throwing. A man keeps out of reach of hoplites, backing off if one comes within 10 m.
  In the skirmish he keeps his last two javelins back for when the lines meet: down to two,
  he goes back behind his own line on his own (round its end, never through it), gathers
  more and comes out again. Nobody waits for the others: each man goes back, and later
  clears the front, when he himself is ready, taking his shot first if he has one to hand.
- **Light troops do not shake the hoplites.** Hoplites are frightened by their own kind
  falling or running beside them, not by skirmishers passing through or falling nearby. He carries 6
  javelins; when they are gone he drops back toward his own line and picks up spent ones.
  A screen that is outnumbered, badly shaken or losing men falls back behind its phalanx,
  or is driven off; it rallies and comes out again when it has its nerve back.
- **The phalanx's choice.** A phalanx with its screen out waits behind it while the light
  troops fight (longer if its screen is winning). Once its own screen is gone and the
  enemy's javelins are reaching its men, its leader has to choose: stand behind the shields
  and take it, or advance to drive them off. Advancing makes the peltasts melt away behind
  their own line, and brings his men within charging distance of the enemy phalanx. A
  shield turned toward the thrower stops most javelins, so standing costs men slowly;
  being thrown at frightens men more where their shields do not face.
- **When the phalanxes close**, the light troops clear the front to the wings. Once the
  lines are locked they work round the ends of the enemy line and throw at the men whose
  sides and backs are turned to them. **They keep to their own side of the line** while
  the enemy still has light troops about: beyond the enemy's end but a little behind
  their own front, where nobody can get behind them. Only when the enemy's light troops
  have left the field do they go round behind his line. **Javelins come up by relay**:
  about one man in seven does no throwing. These carriers shuttle between the spares
  behind their own line and a point halfway to the men throwing on their side, three
  loads at a time, and a man who runs dry runs to the nearest carrier with a load (or to
  where one is coming) rather than all the way back. The least eager men carry at first;
  a carrier who is lost is replaced by a man who has run dry. If no carriers are left, a
  man who runs dry goes back himself and takes the word from up to three friends who are
  nearly out too; they wait for him out of reach while he fetches loads for all of them.
- **A line resting with no screen of its own** will not stand and be picked off by the
  enemy's light troops. Its commander either goes forward to drive them off, though not
  near enough to bring on the enemy phalanx, or gives the day up and marches off. Having
  gone forward once and still been stung, he is likelier to give it up. **Enemy light troops come first**: a man goes
  after any enemy peltast within a short run of him (about 50 m) before he troubles the
  hoplites, and picks a light man over a hoplite when both are in reach. Equal screens
  out on the flanks mostly tie each other up, so they kill fewer hoplites than one side's
  peltasts alone would. The first javelins reach the phalanx about 12 s after contact.
- **They watch how the battle goes.** When their own phalanx pulls back, the light troops
  fall back with it and do not go out again until it stands formed. When it breaks, there
  is nothing left to screen and nobody to rally behind: they make off the field to the
  rear, quickly but not in panic, still throwing at anyone who follows.
- **A beaten body that does not rally goes home.** Peltasts driven off have 90 s, a broken
  squadron of horse 75 s, to get their nerve and numbers back behind their own line. If
  they have not by then, they are done for the day and make off the field; the men leave
  the battle at the field edge instead of loitering just out of it.
- **The counter to overlap.** Men will not wrap round into a place where enemy light troops
  would have their backs. Each end of an overlapping line looks at the enemy peltasts out
  on its own flank: the more of them there are, the less far it goes round, and four or
  more stop it altogether (a hook already formed unwinds when they arrive). The log says
  when an end holds back. If men do end up wrapped round with peltasts about, those
  peltasts pick them out first and frighten them four times as much. With 48 regulars a
  side, a wide line with no light troops beats a deep line 20–3 when neither has peltasts,
  but loses 7–19 to a deep line with 24 peltasts. With 24 peltasts each the wide line has a
  slight edge (11–6), and many such battles end with the lines drawn apart.
- On an equal frontage, 24 peltasts against none win about 20–3; 24 against 12, about 14–10;
  equal screens cancel out.
- Light troops running do not panic the hoplites: skirmishers falling back is expected.

### Cavalry

Each side can field **horsemen**, in one or more contingents, each on the right or the left
wing. All the horse on one wing is one squadron under one commander; as with the phalanx, a
contingent only says who rides with whom. A squadron forms beyond the end of its own
phalanx, a little back from the front.

Cavalry are not knights. They will not ride into a hedge of spears, and a horseman has no
shield and no ranks around him. What they have is speed: a horse at the gallop goes about
10 m/s, nearly three times as fast as a running man. Riders carry a palton to throw and
another to fight with.

- **The enemy horse first.** While enemy cavalry is in the field nothing else is safe, so
  a squadron rides at it. If it is clearly weaker it does not: it falls back behind the end
  of its own line, among its own foot, whose spears and javelins the enemy horse will not
  ride into. A squadron that has been beaten once needs a clear advantage to go out again.
- **Cavalry fights are passes, not a standing fight.** A rider throws on the way in, rides
  into his man, has a few seconds at grips and wheels away to come again. A rider on the
  move is hard to hit. Being ridden at faster than you are moving is frightening. In the
  thick of it every man down from his own squadron weighs on a rider, and a shaken rider
  hangs back rather than go in again. A squadron gives way as a body once its riders are
  shaken on average, or a quarter of them have turned: horsemen do not stand once the men
  beside them go. Horsemen chase a fleeing horseman only when they are almost on him, since
  his horse is as fast as theirs.
- **Then the commander picks his prey.** Once the enemy horse is beaten, or sheltering with
  too few men to matter, or far enough off that it could not come back before a raid is
  done (80 m):
  - **A raid** on a phalanx locked in the fight (or withdrawing): the squadron rides round
    wide, comes in behind the enemy's end, and its riders go for men whose backs or
    unshielded sides are towards them. A rider stays at grips with a hoplite for 3 s at
    most, then wheels away and comes again. After 14 s the squadron pulls out, re-forms and
    the commander decides afresh. **Light troops guard the ends:** horsemen will not ride
    round an end of the line where enemy light troops with javelins are gathered, more than
    about six for every ten riders (never fewer than four); they try the other end, and if
    both are watched they think better of it. A squadron arriving to find them waiting
    turns away.
  - **Hunting light troops** caught in the open, but only those who cannot get to the cover
    of their own hoplites before they are ridden down.
- **Hoplites and horsemen.** Being ridden into at the gallop is a shock, worse from where
  the shield is not, and shakes the men beside too. Horsemen at a man's side or back
  frighten him while they are there. A hoplite attacked by a horseman turns and fights him,
  and a horse is a big target for a spear. A rider caught with his horse at a stand among
  hoplites loses his nerve fast.
- **Light troops and horsemen.** A light man with horsemen coming at him runs for the cover
  of his own hoplites and throws from there. Caught in the open, his back is turned and he
  is cut down like a man in flight. Peltasts throw at horsemen readily: no shield, and a
  big target.
- **The pursuit.** When the enemy phalanx breaks, the horse rides down the fugitives for up
  to 25 s, and the battle goes on until they are called back. A man running cannot stop to
  rally with horsemen about.
- **Not standing to be shot at.** A squadron under javelin fire goes for the throwers if any
  are out in the open, away from their own hoplites; if none are, it draws back out of their
  reach rather than stand there being picked off.
- **The horse is the bigger target.** Much of what hits a horseman hits his horse, which
  slows him and shakes him; less than a third of it tells on the man himself.
- **Watching the battle.** A squadron rests its horses when they are blown, and rides off
  the field if its own phalanx breaks.

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

**What you command.** Before the battle you choose one body of your side to command: the
phalanx, the peltasts, or the horse on one wing (a wing's squadron is one body however many
contingents ride in it; so is the phalanx). Everything else on your side is left to your
officers, the same AI as before; or you can leave all of it to them.

- **The phalanx:** the orders above (keys W, Space, S, R, C, F, E, P; A and D wheel).
- **The peltasts:** skirmish in front (1), go round the enemy flanks (2), or fall back
  behind the line (3). The men still get out of the way when the phalanxes close, run when
  they are driven off, rally behind their own line, and make off if their phalanx breaks.
- **A squadron of horse:** charge their horse (1), raid their rear (2), ride down light
  troops (3), form up on the wing (4), pull back behind the line (5), pursue (P). The riders
  still fight their own fights, break if their nerve goes, and leave if their phalanx breaks;
  a raid you order goes in whatever is watching.

Orders go into the battle record with the step they were given, so a battle replays exactly.

## 8. Equipment

Data-driven (`rules.json`). Starting content is broadly ancient with Greek first:

- **Weapons:** dory (thrusting spear), xiphos, kopis, javelins (later), sarissa
  (later). Properties: reach, damage type mix, one or two handed, how well it can
  be used from the second rank.
- **Shields:** aspis, pelte, none. Properties: block, coverage of the man to the
  left, weight/fatigue.
- **Armour:** none, linothorax, bronze cuirass, helmet types, greaves. Properties: the
  places it covers, how often it holds by kind of wound (§4a), fatigue cost.

Equipment changes exchange odds and fatigue; nerve, cohesion and position matter
more.

## 8a. The village (campaign layer)

The campaign is a village to run, not a map to conquer. It runs on the same idea as the battle:
real people doing real work in real places, and what happens is what follows from that. Every
so often the city calls on the village for men, and then it is the battle model, fought by the
men of the village with the kit they own; the best man in the front rank may also be the best
ploughman.

- **Setting:** Oinoe, a walled village on the Attic side of the Boeotian border, 5th century BC.
  Sixteen households, about a hundred people: men, women, children, the old, a few slaves.
- **Time:** an Attic year of twelve months of thirty days, starting in Pyanepsion when the rains
  come and the ploughing starts. At 1× the daylight of a day passes in about five and a half
  seconds and the night in about one, so a year takes about forty minutes. Pause and speeds up to
  8×; news that needs you (the grain running low, the barley ripe) stops the clock.
- **Land, in real distances:** about fifty-six plots of barley land on the plain (1.2-1.5 ha each,
  half sown each year, half fallow), woods on the hills (each tree on the map a stand of several
  tonnes, cut stands growing back as coppice over eight years), pasture, a stream, roads south to
  Attica and north over the hills to Boeotia.
- **Households are the unit of command.** Each has its men and its women; you send either half
  somewhere, and everyone in it old enough goes (children from seven at half rate, the old at what
  they can). Several households sent to one place work it together. "The fields" sends them
  wherever the fields need hands that day; a household's half works one field together.
- **No work is closed to either sex.** How well someone does a job is their strength, for heavy
  work (ploughing, felling), and their skill, which starts where their upbringing put it and
  grows with practice. Whoever stays home does the housework: grinding, baking, water, then
  spinning and weaving with the time left.
- **The day:** out at dawn, home by dark, so distant work loses hours to walking.
- **What you see is the work.** A field is worked strip by strip along its length: a plough team
  walks it furrow by furrow behind its oxen (several teams one behind the other), men without
  oxen break it with mattocks, sowers, hoers and reapers go up and down in a line abreast. How much
  is done says where the working edge is, and so where everyone stands. Woodcutters fell a stand,
  cut a log and drag it home to the woodpile; with a free yoke and a cart, the crew drags logs
  only to a landing at the edge of the wood and one of them carts them home a load at a time.
  Herders walk round the flock as it drifts across the pasture. Those at home go to the well
  morning, midday and evening, take the washing down to the stream every few days, fetch
  firewood from the pile, and carry a meal out at midday to their men at work.
- **Time:** from 1/16× (a day's daylight in a minute and a half) to 64× (a year in under a minute).
- **The year:** plough (with oxen if a yoke is free, by mattock if not) and sow in autumn, hoe in
  late winter, reap and thresh when the barley ripens in Thargelion before it sheds. The size of
  the harvest is the land sown, how late, how well hoed, and the year's rain. The flock lambs in
  winter and gives milk in spring and summer; it needs herders or it strays.
- **Life:** everyone eats from the stores by age and sex; hunger weakens and then kills, the young
  and old first, and a starving village eats its flock. Firewood for cooking and, in winter,
  warmth. Births, deaths from sickness and age, marriages in Gamelion (men near thirty, girls in
  their late teens; the bride joins her husband's household). Boys come of age at eighteen and take
  up a hoplite's shield or javelins by what their household can afford.
- **You** are the leading man of the village: you choose your name, and your household is the
  richest, in the big house at the head of the square. You set the levy and answer the households'
  petitions, and can order any household about.
- **Households run their own lives.** The routine of the year needs nobody's leave and happens on
  its own, for your house too: the men plough, sow and reap their own fields when they need it
  and hire out on others' when they do not, the women keep house, and at harvest every hand goes
  out. Anything more, a household asks your blessing for, when it has a reason: to cut wood (its
  woodpile is low with winter coming, or wood is dear at the gate), to build a house (a married
  son wants one and none stands empty), to clear new land (a well-off house with too little land
  for its mouths and hands to spare), to take the flock out (it is short of herders and a poorer
  house wants the pay). Petitions appear on the map and stop the clock. A granted plan runs until
  its goal is met (a house plan goes from quarry to woods to walls as it needs), giving way to the
  household's own fields at sowing and harvest. A petition left unanswered for twelve days is taken
  as no. Each petition shows the household in full: its standing, people, land, stores, debts and
  friendships. In the council you can give a standing answer to each kind of petition, for their
  own use (wood for their hearth, a house for a son, land for their farm) or to make a living
  (wood to sell, herding for pay): ask me, always grant, always refuse. Answers given this way
  count just as your own.
- **Time:** above 8× the land stays in daylight, so the days do not flash by as light and dark.
- **Goodwill and ties.** Each household's goodwill toward you rises when you grant and falls when you
  refuse, the more if it was in need, and a little when you order it about over its own plans.
  Letting a house cut wood to sell where others already do sets those others against you and
  against it. Households that work side by side or marry into one another grow closer; brothers'
  households start close. Grudges and gratitude fade slowly.
- **Each household owns its own:** its land (pairs of plots, one sown each year, more for the
  better off), its sheep (herded together in one flock), its grain, firewood, wool and cloth; the
  richest own the yokes of oxen and the carts. What a household produces is its own: the harvest of
  its fields, the wood its men cut (dragged to its own woodpile), the milk and wool of its sheep,
  the cloth its women weave from its wool.
- **Paying for work:** a household working another's land is paid, a day wage in barley for
  ploughing, sowing and hoeing and an eighth of the sheaves for reaping. Oxen and carts used by
  another household are hired for the day. Herders are paid by the sheep's owners in shares.
  Households sent to "the fields" work their own land first, then hire out.
- **The market at the gate:** each evening households short of firewood, wool or cloth buy from
  those with more than they need, paying in barley. Prices move with supply and demand but drift
  back toward the customary price.
- **Credit:** a household close to running out of food borrows barley from those with grain to
  spare, at interest; debts are paid back when the debtor has grain beyond what it needs to reach
  the harvest. Small households with little land live close to the edge and slide into debt to the
  rich: the old Attic problem.
- **Households over the generations:** the head is the senior man; when he dies, or past 65 hands
  the farm to a grown son, the eldest son takes over and the household takes his name. Sons stay
  in their father's household when they marry; brothers go their own ways once their father no
  longer runs the house and there is a house for them, each taking his share of the land (Attic
  land was partible, so farms shrink over the generations) and his family's share of the sheep and
  stores. A bride brings a dowry of grain, cloth and sheep. A dead man's armour stays in the house
  for his sons when they come of age. When you die your heir carries on as you; if your house
  dies out, the head of the richest house left becomes the leading man and moves into the great
  house.
- **Building:** a man who wants a house of his own shows on his household's card. A house takes
  4 tonnes of stone (from the quarry on the hillside, broken out and carried or carted home like
  wood), 1.5 tonnes of timber and 90 days' work; the household it is for pays out of its own
  stores as the walls go up, and anyone you send to the site builds it. Plots are left inside the
  wall, then outside it.
- **New land:** a household can clear rough ground beyond the old fields (the eschatia, the land at
  the edge): cutting scrub, grubbing out roots and carrying off stones, about 110 days' work a
  hectare, by anyone you send. The household pays: it pays wages to other households' people who
  work on it (as it does for building its houses), and it keeps the brushwood and stones that come
  off it. The cleared plot becomes its field, in whichever year of the rotation it has less land,
  but marginal ground yields about four-fifths of the old fields. It is how a rich house turns
  grain into land, and stays rich when the land is divided among its sons.
- **Choosing people one by one.** Under each household's men and women, "Choose people one by one"
  lists them singly, to send any of them somewhere apart from their household, keep them at home,
  or put them back with the rest. Each one taken from another household's work costs a little of
  its goodwill.
- **Drilling for war.** Men of fighting age with arms of their own can be sent to the drill ground
  outside the gate, to practise in pairs and as a line all day. A man who drills grows handier with
  spear and shield and a little surer of himself, quickly while he is raw and slowly as he gets
  good (a month of it takes a green man most of the way to competent); he does no other work that
  day. Households send their men to drill of their own accord once the work that has to be done is
  done: never while their own fields need them; in the slack of the year more or less every house,
  and in the busy months only houses with grain enough to give up a hired man's wages. The richer
  the house, the more its men drill. Your own house does the same, except for men you have sent
  somewhere yourself.
- **The common granary:** a levy you set (0-20%) on every harvest fills it; it feeds households
  with nothing left, if you allow it. A household that dies out leaves its land and grain to the
  village.

- **Called to war.** Oinoe is a deme of Athens on the border. Late in the first summer, and every
  year or two after, a rider comes from a strategos raising the border demes against the
  Boeotians, with his reason. You answer within six days with a share of the village's fighting
  men (0-100%); silence is a no. Each household owes that share of its own men fit to march, its
  young men first, you first of all from your house. Households owing part of a man club together
  with those they are closest to, a man's worth at a time: the house with most men to spare sends
  one, and the others pay it 150 kg of barley for a whole man (in grain, or as a debt). A group
  owing less than half a man sends no one and pays the common granary instead, at the same rate. The summons card shows how many go for each share, how
  many with the hoplite shield and how many light-armed, and who sends whom.
- **The battle.** The men are away for two days' march, then the battle page opens over the
  village, which waits. The general's line is a contingent from each of three to five border demes,
  each about the size a village like yours sends, with yours among them as a contingent of its own
  men under their own names, courage, skill and kit; the light-armed among them go with the
  peltasts. Against them about as many Boeotians, by town. If your contingent is the largest in the
  line you command the whole phalanx; otherwise the line is the general's and you lead only your
  own men. Either way you have four words for them (for the whole line, as its commander, which
  holds the contingent leaders to it for half a minute): *steady* (fight as the line fights), *at
  them!* (their nerve and eagerness rise; they are readier to step into the gap and surge, and tire
  faster), *hang back* (they keep a little behind their places, refuse the fight when it comes to
  them and do not work themselves up to go forward; not running, but leaving the fighting to
  others) and *run!* (they turn and go; it takes two presses). Your men carry a gold pennant on
  the field, the bigger one you.
- **The other contingents' leaders** use the same four words by their own temper: a bold one
  shouts his men on while they have the heart for it, a timid one holds them back once it gets
  hard and takes them away when it gets worse. Each deme and Boeotian town keeps its leader, its
  quality and its kit from battle to battle, and the battle's briefing tells you what you have
  seen of them ("Kallias is always shouting his men on"; "they hang back when it gets hard"). A
  line that hangs back is seen to: its own men lose nerve watching it, and the enemy take heart.
  Each leader is a man in his contingent's ranks (yours is you, among your own men) and can be
  killed, struck down or carried off in a rout like any other. When he goes, the man of most
  standing left in the line takes over, leading by his own temper, bold if he is brave and
  cautious if not, except that a leader's grown son, marching with him, takes over before anyone.
  After the battle a dead leader is succeeded as a house is: by his son if he has one of fighting
  age, whether or not the son was on the field; failing that, by the man who took over from him
  there, who leads until the son is grown. The other demes' and towns' leaders age, and hand over
  to their sons when they grow old. Your own heir among your men takes over from you on the field.
- **Coming home.** Every man's fate comes back to the village: the killed (with how they died),
  the wounded (a wound takes health, which comes back over weeks of good food), the marks they will
  carry, a battle more, standing among men for what each did, and a veteran's name in time. A man
  who ran may have thrown away his shield. On a lost field the enemy strip the dead, so their
  armour does not come home. A victory brings a share of the spoils to the common granary.
- **What they learn.** Every man comes home a little more skilled; more so the longer he fought
  and the more often he went forward, and much more if his leader shouted his contingent into it
  (and less if he held it back). Shouted on, he comes home braver too; a man who ran, less brave.
  "At them!" is less about winning the battle than about making soldiers.
- **Recognition.** If your contingent killed well over its share of the line's kills, the general
  praises the village before the army: standing with the city, and a name for every man in it. If
  the man who killed or struck down most on the whole field is yours (three or more, on a field
  not lost), he is called the hero of the place it was fought ("the hero of Panakton"), which he
  carries for life, into his later battles too; his household and the village are proud of him. A
  man who did well short of that is spoken of.
- **How the village bore itself** is judged against the rest of the line, from who broke and
  when. Running from a winning fight, or being the first to run in a lost one, is a disgrace: the
  city thinks less of the village and every household thinks less of you. Standing when the rest
  of the line has gone is honoured, and costly, since the last men on the field are the ones the
  pursuit catches. Households grieve for their dead, less so for a death the village is proud of.
  The village's standing with the city shows under the common granary: sending no one lowers it,
  sending many raises it, and a village already out of favour that sends no one again is fined.
- **Defying the city.** You can refuse to pay a fine (silence for ten days is refusal). Each refusal
  lowers your standing, and after the second the city may, any month, send men in the night to
  kill you. Whether they get you depends on your own skill and courage and above all on the
  village: households that like you warn you and stand by you, and a man of your house may die at
  the door. If they get you, the city puts its own man in the great house with his family, and you
  play on as him: the village has no love for him, least of all your old house.

Planned next is in ROADMAP.md.

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
3. **Troop types:** archers, slingers, other cultures' kit.
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
