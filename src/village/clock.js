import { MONTHS, DAYS_IN_MONTH, DAYS_IN_YEAR, CLOCK } from './rules.js';

export function monthOf(v) {
  return Math.floor((v.day % DAYS_IN_YEAR) / DAYS_IN_MONTH);
}

export function yearOf(v) {
  return Math.floor(v.day / DAYS_IN_YEAR) + 1;
}

export function lightOf(v) {
  return MONTHS[monthOf(v)].light;
}

export function dawnOf(v) {
  return 12 - lightOf(v) / 2;
}

export function duskOf(v) {
  return 12 + lightOf(v) / 2;
}

export function isNight(v) {
  return v.hour < dawnOf(v) || v.hour >= duskOf(v);
}

export function dateText(v) {
  const m = MONTHS[monthOf(v)];
  return `${(v.day % DAYS_IN_MONTH) + 1} ${m.name}, year ${yearOf(v)}`;
}

export function timeText(v) {
  const h = v.hour;
  if (h < dawnOf(v) - 0.5 || h >= duskOf(v) + 1) return 'night';
  if (h < dawnOf(v) + 0.5) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < duskOf(v) - 0.5) return 'afternoon';
  return 'dusk';
}

// Village hours that pass in a real second at 1×: the daylight hours of a day go by in a few
// seconds, the night in about one.
export function hoursPerSecond(v) {
  return isNight(v) ? (24 - lightOf(v)) / CLOCK.nightSeconds : lightOf(v) / CLOCK.daySeconds;
}

export function logNews(v, kind, text, extra) {
  v.log.push({ day: v.day, hour: v.hour, kind, text, ...extra });
  if (v.log.length > 400) v.log.splice(0, v.log.length - 400);
}
