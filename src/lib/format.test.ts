import { expect, test } from 'vitest';
import { formatBytes, formatInTz } from './format';

test('formatInTz parses any offset and renders in the target zone', () => {
  expect(formatInTz('2026-11-08T05:32:00Z', 'Asia/Seoul')).toBe('2026-11-08 14:32:00');
  expect(formatInTz('2026-11-08T14:32:00+09:00', 'UTC')).toBe('2026-11-08 05:32:00');
  expect(formatInTz('2026-11-08T23:30:00Z', 'Asia/Seoul')).toBe('2026-11-09 08:30:00');
  // Backend fractions may be short or long.
  expect(formatInTz('2026-11-08T05:31:58.1Z', 'Asia/Seoul')).toBe('2026-11-08 14:31:58');
  expect(formatInTz('2026-11-08T12:16:13.10093Z', 'Asia/Seoul')).toBe('2026-11-08 21:16:13');
});

test('formatBytes', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(52_428_800)).toBe('50.0 MB');
});
