import { describe, expect, test } from 'vitest';
import type { components } from '../api/schema';
import { cropText, expandBlockers } from './crop';

type Crop = components['schemas']['CropDto'];
const crop = (over: Partial<Crop> = {}): Crop => ({
  startLine: 181,
  endLine: 220,
  anchorLine: 201,
  totalLines: 400,
  expandStep: 50,
  maxLines: 2000,
  lines: [],
  ...over,
});

describe('expandBlockers', () => {
  test('CROPPED, inside the file, under maxLines → both enabled', () => {
    expect(expandBlockers(crop(), 'CROPPED')).toEqual({ before: null, after: null });
  });

  test('file bounds: before disabled at line 1, after disabled at the last line', () => {
    expect(expandBlockers(crop({ startLine: 1 }), 'CROPPED')).toEqual({
      before: 'Already at the start of the file.',
      after: null,
    });
    expect(expandBlockers(crop({ endLine: 400 }), 'CROPPED')).toEqual({
      before: null,
      after: 'Already at the end of the file.',
    });
  });

  test('maxLines reached (endLine - startLine + 1 >= maxLines) → both disabled', () => {
    const limit = 'The crop is at the 2,000-line limit.';
    expect(expandBlockers(crop({ startLine: 101, endLine: 2100, totalLines: 5000 }), 'CROPPED')).toEqual({
      before: limit,
      after: limit,
    });
    expect(
      expandBlockers(crop({ startLine: 101, endLine: 2099, totalLines: 5000 }), 'CROPPED').before,
    ).toBeNull();
  });

  test.each(['CONFIRMED', 'ANALYZED', 'DEV_REQUIRED', 'TERMINATED', 'DISCARDED'] as const)(
    '%s → both disabled',
    (status) => {
      const { before, after } = expandBlockers(crop(), status);
      expect(before).toMatch(/only change while the error log is CROPPED/);
      expect(after).toBe(before);
    },
  );
});

test('cropText joins the line texts', () => {
  const lines = [
    { no: 1, text: 'a', kind: 'CONTEXT' as const },
    { no: 2, text: '\tat b', kind: 'STACK' as const },
  ];
  expect(cropText(crop({ lines }))).toBe('a\n\tat b');
});
