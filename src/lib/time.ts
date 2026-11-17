export const TZ = 'America/New_York';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

const WEEKDAYS: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 86_400_000;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' });

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function localParts(ms: number): LocalParts {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(ms)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** UTC offset of TZ at the given instant, in ms (e.g. -5h in winter). */
function offsetMs(ms: number): number {
  const name = offsetFmt.formatToParts(ms).find((p) => p.type === 'timeZoneName')!.value;
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
  if (!m) throw new Error(`Unexpected offset name: ${name}`);
  if (!m[1]) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

function parseYmd(sd: string): { y: number; m: number; d: number } {
  return { y: Number(sd.slice(0, 4)), m: Number(sd.slice(4, 6)), d: Number(sd.slice(6, 8)) };
}

/** Wall-clock time in TZ to epoch ms. */
function localToEpoch(y: number, m: number, d: number, hour: number): number {
  const naive = Date.UTC(y, m - 1, d, hour);
  let guess = naive - offsetMs(naive);
  guess = naive - offsetMs(guess);
  return guess;
}

/** GTFS service date in TZ; before 03:00 local still belongs to the previous day. */
export function serviceDate(nowMs: number): string {
  const p = localParts(nowMs);
  if (p.hour >= 3) return ymd(p.year, p.month, p.day);
  const prev = new Date(Date.UTC(p.year, p.month - 1, p.day) - DAY_MS);
  return ymd(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
}

/** GTFS time (HH may be >= 24) is measured from local noon minus 12 h on the service date. */
export function gtfsTimeToEpoch(sd: string, hms: string): number {
  const { y, m, d } = parseYmd(sd);
  const [h, min, s] = hms.split(':').map(Number);
  const utcNoon = Date.UTC(y, m - 1, d, 12);
  const base = utcNoon - offsetMs(utcNoon) - 12 * 3_600_000;
  return base + (h * 3600 + min * 60 + s) * 1000;
}

export function weekdayOf(sd: string): Weekday {
  const { y, m, d } = parseYmd(sd);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Ms until the next hourLocal:00 in TZ, strictly in the future. */
export function msUntilNext(hourLocal: number, nowMs: number): number {
  const p = localParts(nowMs);
  let target = localToEpoch(p.year, p.month, p.day, hourLocal);
  if (target <= nowMs) {
    const next = new Date(Date.UTC(p.year, p.month - 1, p.day) + DAY_MS);
    target = localToEpoch(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hourLocal);
  }
  return target - nowMs;
}
