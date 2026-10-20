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
};

// Quarrying: rough stone for footings and walls, broken out and carried home in loads.
export const STONE = {
  cut: 40, // kg an hour a man breaks out
  load: 30, // kg a man carries
};
