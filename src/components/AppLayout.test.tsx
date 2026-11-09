import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { renderApp } from '../test/render';

const nav = () => within(screen.getByRole('navigation', { name: 'Main' }));

test('/ redirects to search and highlights it', async () => {
  renderApp('/');
  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument();
  expect(nav().getByRole('link', { name: 'Search' })).toHaveAttribute('data-active');
});

test.each([
  ['Search', 'Search'],
  ['Errors', 'Errors'],
  ['Servers', 'Servers'],
  ['LLM endpoints', 'LLM endpoints'],
  ['Prompts', 'Prompts'],
])('nav link "%s" routes to its page and becomes active', async (linkName, heading) => {
  const user = userEvent.setup();
  renderApp('/servers');
  await screen.findByRole('navigation', { name: 'Main' }); // the layout renders once the lazy page has loaded
  await user.click(nav().getByRole('link', { name: linkName }));
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  for (const link of nav().getAllByRole('link')) {
    if (link.textContent === linkName) expect(link).toHaveAttribute('data-active');
    else expect(link).not.toHaveAttribute('data-active');
  }
});

test('error detail route reads the id and keeps Errors active', async () => {
  renderApp('/errors/20261108-001');
  expect(await screen.findByRole('heading', { name: '20261108-001' })).toBeInTheDocument();
  expect(nav().getByRole('link', { name: 'Errors' })).toHaveAttribute('data-active');
});

test('/settings redirects to LLM endpoints', async () => {
  renderApp('/settings');
  expect(await screen.findByRole('heading', { name: 'LLM endpoints' })).toBeInTheDocument();
});
