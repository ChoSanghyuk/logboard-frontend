import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { components } from '../api/schema';
import { renderWithProviders } from '../test/render';
import { StatusBadge } from './StatusBadge';

const expected: Record<components['schemas']['ErrorLogSummary']['status'], [label: string, color: string]> = {
  CROPPED: ['Cropped', 'yellow'],
  CONFIRMED: ['Confirmed', 'blue'],
  ANALYZED: ['Analyzed', 'violet'],
  DEV_REQUIRED: ['Dev required', 'orange'],
  TERMINATED: ['Terminated', 'green'],
  DISCARDED: ['Discarded', 'gray'],
};

test('every status has a distinct color', () => {
  const colors = Object.values(expected).map(([, color]) => color);
  expect(new Set(colors).size).toBe(colors.length);
});

test.each(Object.entries(expected))('%s renders its label and color', (status, [label, color]) => {
  renderWithProviders(<StatusBadge status={status as keyof typeof expected} />);
  const badge = screen.getByText(label).closest('.mantine-Badge-root') as HTMLElement;
  expect(badge.getAttribute('style')).toContain(`--mantine-color-${color}-light`);
});
