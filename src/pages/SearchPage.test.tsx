import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { api, unwrap } from '../api/client';
import { captureBodies } from '../test/captureBodies';
import { renderApp } from '../test/render';

const SLOW = { timeout: 4000 }; // the mock fetch takes 1.5s like the real one
type User = ReturnType<typeof userEvent.setup>;

const timeInput = () => screen.getByRole('textbox', { name: /^Error time/ });

async function fill(user: User, { server, time, window }: { server: string; time: string; window?: string }) {
  await user.click(await screen.findByRole('combobox', { name: /^Server/ }));
  await user.click(await screen.findByRole('option', { name: server, hidden: true }));
  await user.clear(timeInput());
  await user.type(timeInput(), time);
  await user.tab();
  if (window) {
    await user.click(screen.getByRole('combobox', { name: /^Window/ }));
    await user.click(await screen.findByRole('option', { name: window, hidden: true }));
  }
}

const searchButton = () => screen.getByRole('button', { name: 'Search' });

test('success: sends the time with the server offset (Asia/Seoul) and navigates to the error', async () => {
  const bodies = captureBodies(/\/api\/error-logs\/search$/);
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'order-api', time: '2026-11-08 14:32:05', window: '± 10 min' });
  expect(timeInput()).toHaveAccessibleDescription('Server time · Asia/Seoul (UTC+09:00)');
  await user.click(searchButton());
  expect(await screen.findByRole('heading', { name: /^\d{8}-\d{3}$/ }, SLOW)).toBeInTheDocument();
  expect(bodies).toEqual([{ serverId: 1, errorTime: '2026-11-08T14:32:05+09:00', windowMin: 10 }]);
});

test('non-Seoul server: Europe/Berlin offset follows DST; FETCH_FAILED shows the backend message', async () => {
  const bodies = captureBodies(/\/api\/error-logs\/search$/);
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'eu-gateway', time: '2026-07-01 12:00:00' });
  expect(timeInput()).toHaveAccessibleDescription('Server time · Europe/Berlin (UTC+02:00)');
  await user.click(searchButton());
  expect(await screen.findByText('Could not fetch the log', undefined, SLOW)).toBeInTheDocument();
  expect(screen.getByText('SFTP: no such file /var/log/gateway/gateway.log on 10.8.0.4')).toBeInTheDocument();
  expect(bodies[0]).toEqual({ serverId: 3, errorTime: '2026-07-01T12:00:00+02:00', windowMin: 5 });

  await user.clear(timeInput());
  await user.type(timeInput(), '2026-11-08 12:00:00');
  await user.tab();
  expect(timeInput()).toHaveAccessibleDescription('Server time · Europe/Berlin (UTC+01:00)');
  await user.click(searchButton());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({ errorTime: '2026-11-08T12:00:00+01:00' });
});

test('a time skipped by DST in the server zone is rejected before sending', async () => {
  const bodies = captureBodies(/\/api\/error-logs\/search$/);
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'eu-gateway', time: '2026-03-29 02:30:00' });
  await user.click(searchButton());
  expect(timeInput()).toHaveAccessibleDescription(/doesn't exist in Europe\/Berlin/);
  expect(bodies).toHaveLength(0);
});

test('NO_EXCEPTION_FOUND: shows the searched range in the server timezone and a hint to widen', async () => {
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'billing-batch', time: '2026-11-08 14:32:00' });
  await user.click(searchButton());
  const alert = await screen.findByText(/Nothing between/, undefined, SLOW);
  expect(alert).toHaveTextContent(
    'Nothing between 2026-11-08 14:27:00 and 2026-11-08 14:37:00 (Asia/Seoul). Try a wider window',
  );
  expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
});

test('loading state and double-submit guard: only one request while a search is running', async () => {
  const bodies = captureBodies(/\/api\/error-logs\/search$/);
  const user = userEvent.setup();
  const { container } = renderApp('/search');
  await fill(user, { server: 'billing-batch', time: '2026-11-08 14:32:00' });
  const form = container.querySelector('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form); // same tick: before React re-renders
  expect(await screen.findByRole('status')).toHaveTextContent(/Fetching the log from billing-batch/);
  expect(searchButton()).toBeDisabled();
  expect(timeInput()).toBeDisabled();
  fireEvent.submit(form);
  await screen.findByText(/Nothing between/, undefined, SLOW);
  expect(bodies).toHaveLength(1);
});

test('error time defaults to today at 00:00:00', async () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  renderApp('/search');
  await screen.findByRole('combobox', { name: /^Server/ });
  expect(timeInput()).toHaveValue(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`);
});

test('validation: server is required', async () => {
  const user = userEvent.setup();
  renderApp('/search');
  await screen.findByRole('combobox', { name: /^Server/ });
  await user.click(searchButton());
  expect(screen.getByRole('combobox', { name: /^Server/ })).toHaveAccessibleDescription('Select a server');
});

test('soft-deleted servers never appear in the server select', async () => {
  // order-api is referenced by an error log → soft-deleted by the API.
  await unwrap(api.DELETE('/api/servers/{id}', { params: { path: { id: 1 } } }));
  const user = userEvent.setup();
  renderApp('/search');
  await user.click(await screen.findByRole('combobox', { name: /^Server/ }));
  expect(await screen.findByRole('option', { name: 'billing-batch', hidden: true })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'order-api', hidden: true })).not.toBeInTheDocument();
});
