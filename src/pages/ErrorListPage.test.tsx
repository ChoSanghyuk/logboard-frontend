import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import type { components } from '../api/schema';
import { STATUS_META } from '../components/StatusBadge';
import { server } from '../mocks/server';
import { renderApp } from '../test/render';

type Summary = components['schemas']['ErrorLogSummary'];

/** Query strings of GET /api/error-logs requests. */
function captureListQueries() {
  const queries: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/error-logs') queries.push(url.searchParams);
  });
  return queries;
}

const rows = () => screen.getAllByRole('row').slice(1); // without the header
const ids = () => rows().map((r) => within(r).getAllByRole('cell')[0].textContent);

test('default filter: all but TERMINATED / DISCARDED (sent explicitly), page 0, size 20, times in server tz', async () => {
  const queries = captureListQueries();
  renderApp('/errors');
  await screen.findByRole('link', { name: '20261108-001' });
  expect(queries[0].getAll('status')).toEqual(['CROPPED', 'CONFIRMED', 'ANALYZED', 'DEV_REQUIRED']);
  expect(queries[0].get('page')).toBe('0');
  expect(queries[0].get('size')).toBe('20');
  expect(ids()).toEqual(['20261108-001', '20261107-002']); // newest first
  const cells = within(rows()[0]).getAllByRole('cell');
  expect(cells.map((c) => c.textContent)).toEqual([
    '20261108-001',
    'order-api 10.0.1.22', // + the instance host
    '2026-11-08 14:32:00', // 05:32Z in Asia/Seoul
    'java.lang.NullPointerException: Cannot invoke "Customer.getId()" because "customer" is null',
    '추출됨',
    '2026-11-08 14:35:10',
  ]);
  expect(screen.getByText('2 error logs · newest first')).toBeInTheDocument();
});

test('filters come from the URL; dates are days in the selected server timezone', async () => {
  const queries = captureListQueries();
  renderApp('/errors?status=TERMINATED&server=3&from=2026-11-07&to=2026-11-07');
  await screen.findByRole('link', { name: '20261107-001' });
  const q = queries.at(-1)!;
  expect(q.getAll('status')).toEqual(['TERMINATED']);
  expect(q.get('serverId')).toBe('3');
  expect(q.get('from')).toBe('2026-11-07T00:00:00+01:00'); // Europe/Berlin
  expect(q.get('to')).toBe('2026-11-07T23:59:59.999+01:00');
  expect(ids()).toEqual(['20261107-001']);
  expect(within(rows()[0]).getAllByRole('cell')[2]).toHaveTextContent('2026-11-07 10:10:00');
  expect(screen.getAllByText('Days in Europe/Berlin')).toHaveLength(2);
});

test('changing a filter updates the URL and the request; an empty status means any status', async () => {
  const queries = captureListQueries();
  const user = userEvent.setup();
  const { router } = renderApp('/errors');
  await screen.findByRole('link', { name: '20261108-001' });

  await user.click(screen.getByRole('combobox', { name: 'Server' }));
  await user.click(await screen.findByRole('option', { name: 'eu-gateway', hidden: true }));
  await waitFor(() => expect(router.state.location.search).toBe('?server=3'));
  expect(await screen.findByText('No error logs match the filters.')).toBeInTheDocument();
  expect(queries.at(-1)!.get('serverId')).toBe('3');

  // Clear the status selection → any status (no status param sent).
  await user.click(screen.getByLabelText('Clear status'));
  await waitFor(() => expect(router.state.location.search).toBe('?server=3&status='));
  expect(await screen.findByRole('link', { name: '20261107-001' })).toBeInTheDocument();
  expect(queries.at(-1)!.has('status')).toBe(false);
});

test('paging: size 20, the page is in the URL, Back from the detail restores it, a filter change resets it', async () => {
  const all: Summary[] = Array.from({ length: 45 }, (_, i) => ({
    id: `20261108-${String(45 - i).padStart(3, '0')}`,
    serverId: 1,
    serverName: 'order-api',
    serverTimezone: 'Asia/Seoul',
    instance: { id: 12, host: '10.0.1.22', sshPort: 22, logPath: '/var/log/order-api/application.log' },
    requestedTime: '2026-11-08T05:32:00Z',
    exceptionClass: null,
    exceptionMessage: `error ${45 - i}`,
    status: 'CROPPED',
    createdAt: '2026-11-08T05:35:10Z',
  }));
  server.use(
    http.get('*/api/error-logs', ({ request }) => {
      const q = new URL(request.url).searchParams;
      const page = Number(q.get('page'));
      const size = Number(q.get('size'));
      return HttpResponse.json({ items: all.slice(page * size, (page + 1) * size), total: 45, page, size });
    }),
  );
  const queries = captureListQueries();
  const user = userEvent.setup();
  const { router } = renderApp('/errors');
  await screen.findByRole('link', { name: '20261108-045' });
  expect(rows()).toHaveLength(20);
  expect(within(rows()[0]).getAllByRole('cell')[3]).toHaveTextContent('ERROR (no stack trace): error 45');

  await user.click(screen.getByRole('button', { name: '2' }));
  await screen.findByRole('link', { name: '20261108-025' });
  expect(router.state.location.search).toBe('?page=2');
  expect(queries.at(-1)!.get('page')).toBe('1');

  // Row click → detail; Back → same page again.
  server.use(http.get('*/api/error-logs/:id', () => HttpResponse.json({}, { status: 404 })));
  await user.click(within(rows()[3]).getAllByRole('cell')[1]);
  await waitFor(() => expect(router.state.location.pathname).toBe('/errors/20261108-022'));
  await act(() => router.navigate(-1));
  expect(await screen.findByRole('link', { name: '20261108-025' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('data-active', 'true');

  await user.click(screen.getByRole('combobox', { name: 'Server' }));
  await user.click(await screen.findByRole('option', { name: 'order-api', hidden: true }));
  await waitFor(() => expect(router.state.location.search).toBe('?server=1'));
  expect(queries.at(-1)!.get('page')).toBe('0');
});

test('"Reset filters" restores the default open statuses and clears server, dates and page', async () => {
  const user = userEvent.setup();
  const queries = captureListQueries();
  const { router } = renderApp('/errors?status=TERMINATED&server=3&from=2026-11-07&to=2026-11-07&page=2');
  await screen.findByText(/error logs? · newest first/);
  await user.click(screen.getByRole('button', { name: 'Reset filters' }));
  await waitFor(() => expect(router.state.location.search).toBe(''));
  await screen.findByRole('link', { name: '20261108-001' });
  const q = queries.at(-1)!;
  expect(q.getAll('status')).toEqual(['CROPPED', 'CONFIRMED', 'ANALYZED', 'DEV_REQUIRED']);
  expect([q.get('serverId'), q.get('from'), q.get('to'), q.get('page')]).toEqual([null, null, null, '0']);
  expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
});

test('"상태 안내" lists all six statuses in lifecycle order with their descriptions', async () => {
  const user = userEvent.setup();
  renderApp('/errors');
  await screen.findByRole('link', { name: '20261108-001' });
  await user.click(screen.getByRole('button', { name: '상태 안내' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('상태 안내')).toBeInTheDocument();
  const badges = Array.from(dialog.querySelectorAll('.mantine-Badge-root'), (b) => b.textContent);
  expect(badges).toEqual(['추출됨', '확인됨', '분석됨', '개발자 확인 필요', '종료됨', '폐기됨']);
  for (const { description } of Object.values(STATUS_META))
    expect(within(dialog).getByText(description)).toBeInTheDocument();
});
