import { describe, expect, test } from 'vitest';
import { formatInTz } from './format';
import { offsetLabel, zonedWallTimeToIso } from './timezone';

describe('zonedWallTimeToIso', () => {
  test.each([
    ['2026-11-08 14:32:05', 'Asia/Seoul', '2026-11-08T14:32:05+09:00'],
    ['2026-07-01 12:00:00', 'Europe/Berlin', '2026-07-01T12:00:00+02:00'], // CEST
    ['2026-11-08 12:00:00', 'Europe/Berlin', '2026-11-08T12:00:00+01:00'], // CET
    ['2026-03-29 03:00:00', 'Europe/Berlin', '2026-03-29T03:00:00+02:00'], // right after spring-forward
    ['2026-03-29 01:59:59', 'Europe/Berlin', '2026-03-29T01:59:59+01:00'], // right before
    ['2026-11-08 09:15:00', 'America/New_York', '2026-11-08T09:15:00-05:00'],
    ['2026-07-01 09:15:00', 'America/New_York', '2026-07-01T09:15:00-04:00'],
    ['2026-11-08 09:15:00', 'Asia/Kolkata', '2026-11-08T09:15:00+05:30'],
    ['2026-11-08 09:15:00', 'UTC', '2026-11-08T09:15:00+00:00'],
    ['2026-01-01 00:00:00', 'Pacific/Kiritimati', '2026-01-01T00:00:00+14:00'],
  ])('%s in %s → %s', (wall, tz, iso) => {
    expect(zonedWallTimeToIso(wall, tz)).toBe(iso);
    // Round trip: the instant shown back in that zone is the same wall time.
    expect(formatInTz(iso, tz)).toBe(wall);
  });

  test('a time skipped by DST (spring-forward gap) does not exist → null', () => {
    expect(zonedWallTimeToIso('2026-03-29 02:30:00', 'Europe/Berlin')).toBeNull();
    expect(zonedWallTimeToIso('2026-03-08 02:30:00', 'America/New_York')).toBeNull();
  });

  test('a repeated time (fall-back overlap) uses the first occurrence', () => {
    expect(zonedWallTimeToIso('2026-10-25 02:30:00', 'Europe/Berlin')).toBe('2026-10-25T02:30:00+02:00');
  });

  test('rejects malformed input', () => {
    expect(zonedWallTimeToIso('2026-11-08 14:32', 'Asia/Seoul')).toBeNull();
  });
});

test('offsetLabel follows DST at the given wall time', () => {
  expect(offsetLabel('Asia/Seoul')).toBe('UTC+09:00');
  expect(offsetLabel('Europe/Berlin', '2026-07-01 12:00:00')).toBe('UTC+02:00');
  expect(offsetLabel('Europe/Berlin', '2026-12-01 12:00:00')).toBe('UTC+01:00');
});
