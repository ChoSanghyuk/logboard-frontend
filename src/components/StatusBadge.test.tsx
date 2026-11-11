import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import type { components } from '../api/schema';
import { renderWithProviders } from '../test/render';
import { STATUS_META, StatusBadge } from './StatusBadge';

const expected: Record<components['schemas']['ErrorLogSummary']['status'], [label: string, color: string]> = {
  CROPPED: ['추출됨', 'yellow'],
  CONFIRMED: ['확인됨', 'blue'],
  ANALYZED: ['분석됨', 'violet'],
  DEV_REQUIRED: ['개발자 확인 필요', 'orange'],
  TERMINATED: ['종료됨', 'green'],
  DISCARDED: ['폐기됨', 'gray'],
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

test('hovering a badge shows its description', async () => {
  renderWithProviders(<StatusBadge status="DEV_REQUIRED" />);
  await userEvent.setup().hover(screen.getByText('개발자 확인 필요'));
  expect(await screen.findByRole('tooltip')).toHaveTextContent(STATUS_META.DEV_REQUIRED.description);
});
