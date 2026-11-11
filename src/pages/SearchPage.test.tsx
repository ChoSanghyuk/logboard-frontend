import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { api, unwrap } from '../api/client';
import { server } from '../mocks/server';
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

test('non-Seoul server: Europe/Berlin offset follows DST; FETCH_FAILED lists every failed instance', async () => {
  const bodies = captureBodies(/\/api\/error-logs\/search$/);
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'eu-gateway', time: '2026-07-01 12:00:00' });
  expect(timeInput()).toHaveAccessibleDescription('Server time · Europe/Berlin (UTC+02:00)');
  await user.click(searchButton());
  expect(await screen.findByText('Could not fetch the log', undefined, SLOW)).toBeInTheDocument();
  for (const host of ['10.8.0.4', '10.8.0.5'])
    expect(
      screen.getByText(`${host}:22: SFTP: no such file /var/log/gateway/gateway.log on ${host}`),
    ).toBeInTheDocument();
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

test('NO_EXCEPTION_FOUND: shows the searched range in the server timezone, a hint to widen and the searched instances', async () => {
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'billing-batch', time: '2026-11-08 14:32:00' });
  await user.click(searchButton());
  const alert = await screen.findByText(/Nothing between/, undefined, SLOW);
  expect(alert).toHaveTextContent(
    'Nothing between 2026-11-08 14:27:00 and 2026-11-08 14:37:00 (Asia/Seoul). Try a wider window',
  );
  expect(screen.getByText('Searched: 10.0.2.8:2222')).toBeInTheDocument();
  expect(screen.queryByText(/Not read/)).not.toBeInTheDocument();
  expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
});

test('NO_EXCEPTION_FOUND with failed instances lists them', async () => {
  server.use(
    http.post('*/api/error-logs/search', () =>
      HttpResponse.json(
        {
          code: 'NO_EXCEPTION_FOUND',
          message: 'No exception',
          details: {
            errorTime: '2026-11-08T14:32:00+09:00',
            windowMin: 5,
            from: '2026-11-08T05:27:00Z',
            to: '2026-11-08T05:37:00Z',
            searchedInstances: [{ id: 41, host: '10.0.4.1', sshPort: 22, logPath: '/a.log' }],
            failures: [
              { instanceId: 42, host: '10.0.4.2', sshPort: 22, logPath: '/a.log', message: 'Timed out' },
            ],
          },
        },
        { status: 404 },
      ),
    ),
  );
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'cart-api', time: '2026-11-08 14:32:00' });
  await user.click(searchButton());
  expect(await screen.findByText('Searched: 10.0.4.1:22')).toBeInTheDocument();
  expect(screen.getByText('Not read (the error may be there):')).toBeInTheDocument();
  expect(screen.getByText('10.0.4.2:22: Timed out')).toBeInTheDocument();
});

test('some instances failed: 201 opens the error log with a warning for the failed instance', async () => {
  const user = userEvent.setup();
  renderApp('/search');
  await fill(user, { server: 'cart-api', time: '2026-11-08 14:32:00' });
  await user.click(searchButton());
  expect(await screen.findByRole('heading', { name: /^\d{8}-\d{3}$/ }, SLOW)).toBeInTheDocument();
  expect(screen.getByText('10.0.4.1:22')).toBeInTheDocument(); // the crop's instance
  expect(
    screen.getByText(
      'Logs of 10.0.4.2:22 could not be read: Timed out after 10s (connecting to deploy@10.0.4.2:22). ' +
        'The error may be on that node.',
    ),
  ).toBeInTheDocument();
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
