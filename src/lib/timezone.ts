import { formatInTz } from './format';

/** Wall-clock time as typed by the user: `YYYY-MM-DD HH:mm:ss` (no zone). */
const WALL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

export const isWallTime = (s: string) => WALL.test(s);

/** Wall time read as if it were UTC, in ms. */
function wallAsUtc(wall: string): number {
  const [, y, mo, d, h, mi, s] = WALL.exec(wall)!.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/** UTC offset of `timeZone` at instant `ms`, in ms (e.g. +9h for Asia/Seoul). */
export function tzOffsetMs(ms: number, timeZone: string): number {
  const at = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(formatInTz(new Date(at).toISOString(), timeZone)) - at;
}

/** `+09:00` / `-04:00` / `+05:30`. */
export function formatOffset(offsetMs: number): string {
  const m = Math.round(Math.abs(offsetMs) / 60_000);
  return `${offsetMs < 0 ? '-' : '+'}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Converts a wall time in `timeZone` to ISO-8601 with that zone's offset at that moment (DST-aware),
 * e.g. `2026-07-01 12:00:00` in Europe/Berlin → `2026-07-01T12:00:00+02:00`.
 * Returns null if the time doesn't exist there (DST spring-forward gap). For a repeated time
 * (fall-back overlap) the first occurrence is used.
 */
export function zonedWallTimeToIso(wall: string, timeZone: string): string | null {
  if (!isWallTime(wall)) return null;
  const asUtc = wallAsUtc(wall);
  // The offsets a day before/after cover any single transition near this wall time.
  const offsets = new Set([tzOffsetMs(asUtc - DAY_MS, timeZone), tzOffsetMs(asUtc + DAY_MS, timeZone)]);
  const instants = [...offsets]
    .map((o) => asUtc - o)
    .filter((t) => tzOffsetMs(t, timeZone) === asUtc - t)
    .sort((a, b) => a - b);
  if (!instants.length) return null;
  return `${wall.replace(' ', 'T')}${formatOffset(asUtc - instants[0])}`;
}

/** `UTC+09:00` for `timeZone` at `wall` (or now, if `wall` is missing / doesn't exist). */
export function offsetLabel(timeZone: string, wall?: string | null): string {
  const iso = wall ? zonedWallTimeToIso(wall, timeZone) : null;
  const offset = iso ? iso.slice(19) : formatOffset(tzOffsetMs(Date.now(), timeZone));
  return `UTC${offset}`;
}
