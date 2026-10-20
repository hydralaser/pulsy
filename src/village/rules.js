// A small walled village on the border between Attica and Boeotia, in the 5th century BC.
// Everything here is in real units: metres, hours, kilograms, hectares.

// The Attic year starts at midsummer. A village year begins in autumn, when the rains come
// and the ploughing starts, so the game starts in Pyanepsion.
export const MONTHS = [
  { name: 'Pyanepsion', season: 'autumn', light: 11 }, // Oct
  { name: 'Maimakterion', season: 'autumn', light: 10.2 }, // Nov
  { name: 'Posideon', season: 'winter', light: 9.6 }, // Dec
  { name: 'Gamelion', season: 'winter', light: 9.8 }, // Jan
  { name: 'Anthesterion', season: 'winter', light: 10.8 }, // Feb
  { name: 'Elaphebolion', season: 'spring', light: 12 }, // Mar
  { name: 'Mounichion', season: 'spring', light: 13.1 }, // Apr
  { name: 'Thargelion', season: 'spring', light: 14 }, // May
  { name: 'Skirophorion', season: 'summer', light: 14.5 }, // Jun
  { name: 'Hekatombaion', season: 'summer', light: 14.3 }, // Jul
  { name: 'Metageitnion', season: 'summer', light: 13.4 }, // Aug
  { name: 'Boedromion', season: 'autumn', light: 12.2 }, // Sep
];
export const DAYS_IN_MONTH = 30;
export const DAYS_IN_YEAR = MONTHS.length * DAYS_IN_MONTH;

// How fast the village's time runs at 1×: the daylight hours of a day in about five and a half
// seconds and the night in a little over one, so a year takes about forty minutes.
export const CLOCK = {
  daySeconds: 5.5,
  nightSeconds: 1.2,
  speeds: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64],
  step: 5 / 60, // hours per simulation step
  // Auto pace: fast through the quiet stretches, slow enough to watch while the fields are being
  // worked, the village goes hungry, or a summons is waiting.
  auto: { quiet: 32, busy: 2 },
  skip: 64, // running on to the next thing that needs you
  skipDays: 60, // and stopping anyway after this long, if nothing does
};

export const VILLAGE = {
  walk: 4.5, // km an hour on a path, unloaded
  walkLoaded: 3.2, // carrying a load
  drag: 2, // dragging a log
  cart: 2.5, // an ox cart
  graze: 0.4, // a flock drifting as it grazes
  households: 16,
  // A man's ration of grain is about a choinix a day; women and the old eat less, children
  // less again. All food is counted as kilograms of grain.
  ration: { man: 0.9, woman: 0.7, elder: 0.65, child: 0.45, infant: 0.15 },
  // Firewood for cooking all year, and for warmth in winter, per household per day.
  fuel: { summer: 10, winter: 22 },
  // Children under this age do no work; under adult age they work at half a man's rate.
  workAge: 7,
  adultAge: 15,
  elderAge: 60,
  marryMan: 28, // men marry late, women young
  marryWoman: 16,
};

// Fields: barley, sown in autumn, reaped in early summer, every other year (the other year
// fallow). Labour in man-days a hectare.
export const FIELDS = {
  seed: 120, // kg a hectare
  yield: 750, // kg a hectare in an ordinary year
  ploughOxen: 2.5, // man-days a hectare with a yoke of oxen
  ploughHoe: 18, // and by hand with a mattock
  sow: 0.6,
  weed: 3, // in late winter: worth about a tenth more grain
  weedGain: 0.12,
  harvest: 11, // reaping, binding, carrying and threshing
  sowFrom: 0, // months (index into MONTHS) when sowing is worth doing
  sowTo: 2,
  lateSow: 0.6, // yield for a field sown in the last month
  ripe: 7, // the month the barley is ripe
  shatter: 0.02, // share of the crop lost each day it stands ripe after the first ten
};

// Woodcutting: felling, trimming and splitting, then carrying it home.
export const WOOD = {
  cut: 25, // kg an hour a man
  log: 60, // kg a man can drag home on a rope
  cartLoad: 450, // kg on an ox cart
  regrow: 8, // years for a felled stand to grow back as coppice
};

// Sheep and goats.
export const FLOCK = {
  perHerder: 50, // head one herder can keep together on the hills
  milk: 0.035, // kg of grain-equivalent in milk and cheese a head a day, in season
  milkFrom: 4, // months of milking (Anthesterion to Skirophorion)
  milkTo: 8,
  lambing: 2, // month the lambs come
  lambs: 0.7, // per head
  meat: 25, // kg of grain a slaughtered sheep is worth as food
  wool: 1.2, // kg a head at the shearing
  shearing: 7, // month (Thargelion)
  straying: 0.0012, // share of those beyond what the herders can watch lost each day, to wolves and straying
  oldAge: 0.00025, // share lost each day to age and sickness
};

// Women's work at home: grinding, baking, water, spinning and weaving. Hours a day a household
// needs to keep fed; what is left over goes into cloth.
export const HOUSE = {
  hours: 6,
  cloth: 0.008, // kg of woollen cloth an hour of spinning and weaving: about 125 hours a kilo
};

// How work and life wear on people.
export const LIFE = {
  // Chance of dying in a year, by age, before hunger and cold are counted.
  deathByAge: [[1, 0.2], [5, 0.04], [15, 0.008], [40, 0.012], [55, 0.03], [65, 0.07], [75, 0.15], [120, 0.35]],
  birthChance: 0.3, // a married woman under 40, in a year
  hungerDeath: 0.02, // extra chance a day of dying when starving, for the weak
  skillGain: 0.0025, // a day's work
};

// Households' dealings with one another. Prices are in kilograms of barley.
export const ECONOMY = {
  price: { wood: 0.15, wool: 4, cloth: 12 }, // where prices start: a kg of firewood, of raw wool, of woven cloth
  priceMove: 0.03, // how far a price moves in a day toward where buyers and sellers meet
  priceCustom: 0.01, // and how far it drifts back toward the customary price
  tradeShare: 0.5, // share of what could change hands that does in an evening
  clothKeep: 1.5, // kg of cloth a person's household likes to have by
  woolKeep: 3, // kg of wool a working woman likes to have to spin
  clothWear: 0.005, // kg of cloth a person wears out in a day: a couple of kilos a year
  wage: 4, // kg of barley for a hired man's day in the fields
  reapShare: 0.125, // a hired reaper takes an eighth of what he reaps
  herdWage: 1.5, // kg a herder's day, paid by the owners of the flock in shares
  yokeHire: 3, // kg a day for the loan of another household's oxen
  cartHire: 2, // and of its cart
  interest: 0.15, // a year, on a loan of grain
  borrowAt: 5, // days of food left when a household goes to borrow
  borrowFor: 30, // days of food it borrows
  levy: 0.05, // share of every harvest that goes to the common granary
  value: { land: 1500, sheep: 40, yoke: 400, cart: 200 }, // what things are worth in barley, for reckoning a household's wealth
  startCommon: 0.05, // what the common granary holds at the start, against the households' grain
};

// Households over the generations.
export const FAMILY = {
  retire: 65, // an old head hands over the farm to his son at this age
  takeOver: 25, // if the son is at least this old
  dowryGrain: 300, // most of a daughter's dowry, in barley
};

// What a house takes to build: stone for the footings and lower walls, timber for the roof and
// door, and the labour of making mudbrick, laying walls and roofing, in man-days.
export const BUILD = {
  house: { stone: 4000, wood: 1500, work: 90 },
  // Clearing rough ground for a field: cutting the scrub, grubbing out the roots, carrying off the
  // stones, a hectare at a time. What is cleared off it is the clearer's: brushwood to burn and
  // stone to build with. New land on the margins is thinner than the old fields.
  field: { work: 110, wood: 2500, stone: 1800, soil: 0.8 },
};

// Drilling for war: men practising with spear and shield on the open ground outside the gate,
// in pairs and as a line. It makes a man handier with his weapons, a little surer of himself, and,
// slowly, stronger and longer in the wind.
export const DRILL = {
  skill: 0.0007, // battle skill gained an hour, times what he still has to learn
  courage: 0.00015, // and courage
  strength: 0.00015, // and strength, which a body gains no faster than nerve
  endurance: 0.00015, // and endurance
  ground: { x: -58, y: 138, w: 36, h: 22 },
  // Households drilling of their own accord, each man each day: in the slack of the year, and,
  // for houses that can afford to lose a hired man's wages, in the busy months too. How much a
  // house can afford is its days of grain in store, from easeFrom (none) to easeFrom + easeSpan.
  slack: 0.08,
  slackEase: 0.4,
  busyEase: 0.25,
  easeFrom: 90,
  easeSpan: 400,
  // A man drilling eats more than one at home (EXERTION). A house weighs that against the grain it
  // can spare beyond what it must keep to the harvest: enough to feed its men through this many
  // days of drilling, or it drills the less.
  costDays: 60,
  hours: 9, // a day at the drill ground
};

// A day's labour: how heavy it is (each task's strength in TASKS) times the hours at it. Heavy
// work makes a body hungrier, and slowly stronger and longer in the wind; an idle day eats less.
export const EXERTION = {
  day: 10, // hours in a full day's work
  usual: 0.23, // how heavy an ordinary day is (a day's housework, about): a day of it eats the
  // plain ration, so the village as a whole eats what it did before work counted
  food: 0.6, // how much more he eats, per point a day is heavier than usual (less, when lighter)
  strength: 0.00003, // strength gained an hour at the heaviest work, times what he still has to
  // gain: a fifth of what drilling gives, and less again for lighter work
  endurance: 0.00003,
};

// Growing up: a boy's body as a man, at eighteen. A boy of a house that ate well, who was well fed
// himself, grows stronger and longer in the wind, on the whole; any boy may surprise.
export const GROWING = {
  wealth: 0.6, // how much of his growing up was his house's wealth; the rest, how well fed he was
  strength: { low: 0.68, high: 0.82, spread: 0.1 }, // mean from the worst start to the best
  endurance: { low: 0.42, high: 0.58, spread: 0.14 },
};

// The body wears: past middle age strength and wind go, slowly and then faster; and hunger wastes
// a body, which gets back what it lost once it is fed again.
export const AGEING = {
  from: 45, // years
  strength: 0.006, // lost a year
  endurance: 0.008,
  old: 60, // past this, twice as fast
  // And an older body gains less from work and drill: half past `from`, a quarter past `old`.
  trainable: [1, 0.5, 0.25],
};
export const HUNGER = {
  below: 0.9, // fed below this, the body wastes
  waste: 0.006, // strength (and endurance) lost a day, per point he is fed below that
  regain: 0.0015, // what he gets back a day once he is well fed, until he has back what he lost
};

// Short rations: a household that sees its grain will not last to the harvest cuts what everyone
// eats, the more the shorter it is, rather than eat well now and starve later.
export const RATION = {
  depth: 0.5, // eats this share less for each share of the grain it is short of
  least: 0.7, // and never less than this, while there is grain at all
};

// Quarrying: rough stone for footings and walls, broken out and carried home in loads.
export const STONE = {
  cut: 40, // kg an hour a man breaks out
  load: 30, // kg a man carries
};

// Households asking the leading man's leave, and what it does to their goodwill and to one
// another.
export const COUNCIL = {
  goodwill: 0.6, // where a household's goodwill toward you starts
  thinkEvery: 5, // days between a household thinking over what it wants
  answerWithin: 12, // days before an unanswered petition counts as refused
  // Council days: petitions are heard together, every so many days, rather than each stopping the
  // clock as it comes; one is not taken as refused until after the next council day.
  councilEvery: 10,
  councilChoices: [1, 5, 10, 15, 30],
  cooldown: 30, // days before a household asks again for something you refused
  dearWood: 0.2, // firewood dearer than this (kg barley a kilo) tempts households to cut it for sale
  landPerMouth: 0.9, // ha a person below which a well-off house wants more land
  grantGain: 0.03,
  refuseLoss: 0.06,
  undercut: 0.03, // goodwill lost by households already doing the work you let another into
  rivalry: 0.12, // and their tie with the newcomer
  orderCost: 0.02, // goodwill lost when you order a household about over its own plans
  // Leave to clear new land can be sold: a fee in barley, a share of what one harvest of the new
  // field should bring. A tenth is the usual thing; asking less is generous and wins goodwill,
  // asking more costs it, this much for each tenth above or below.
  feeUsual: 0.1,
  feeFeel: 0.03,
  fees: [0, 0.05, 0.1, 0.15, 0.2, 0.3],
  workTogether: 0.002, // tie gained each day two households work side by side
  marriage: 0.15, // tie gained by a marriage between two houses
  fade: 0.002, // share of a grudge, or of goodwill above the usual, that fades each day
};

// Calls to war. Oinoe is a deme of Athens on the Boeotian border; when there is trouble the
// general raising men nearby sends to the village for its share. The leading man says how large a
// share of the village's fighting men go, and each household owes that share of its own men.
// Households that owe only part of a man club together and one of them sends him; the others pay
// it for his keep, his risk and his days lost from the farm.
export const WAR = {
  first: 250, // day of the first summons (late in the first summer)
  every: [300, 560], // days between one summons and the next
  answer: 6, // days to answer before the general takes silence for a refusal
  march: 2, // days from setting out to the battle
  home: 2, // and from the battle home again
  shares: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1],
  shareCost: 150, // kg of barley a household pays for a whole man sent in its place
  fit: 0.6, // health a man needs to march
  shieldLoss: 0.5, // chance a man who ran threw his shield away to run faster
  booty: 25, // kg of barley a man's share of the spoils, into the common granary, after a victory
  fine: 400, // kg the deme is fined when it has fallen out of favour and sends nobody again
  fineAnswer: 10, // days to pay a fine before it counts as refused
  plotChance: 0.2, // chance a month, for each refusal past the first, the city sends men to kill you
  bringSon: 0.5, // chance a leading man brings a grown son he need not, for the experience, if he judges it safe
  blur: 0.45, // how far a man with no grasp of affairs misjudges the danger of a coming fight
  standing: { start: 0.5, none: -0.2, few: -0.05, many: 0.05, won: 0.08, fledWon: -0.25, startedRout: -0.2, heldLast: 0.15 },
  grief: 0.08, // goodwill a household loses toward you for each of its men killed
  griefHonoured: 0.03, // and if they died in a fight the village can be proud of
  shame: 0.06, // goodwill every household loses when the village's men disgrace it
  pride: 0.04, // and gains when they do it honour
};
