import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { renderApp } from './test/render';

test('app renders inside providers and router', () => {
  renderApp('/');
  expect(screen.getByRole('heading', { name: 'Logboard' })).toBeInTheDocument();
});
