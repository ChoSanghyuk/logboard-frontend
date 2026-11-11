import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../mocks/server';
import { api, ApiRequestError, unwrap } from './client';

test('typed client reads servers from the mock API', async () => {
  const servers = await unwrap(api.GET('/api/servers'));
  expect(servers.map((s) => s.name)).toEqual(['order-api', 'billing-batch', 'eu-gateway', 'cart-api']);
  expect(servers[0].instances[0]).not.toHaveProperty('password');
  expect(servers[0].instances[0]).not.toHaveProperty('privateKey');
});

test('unwrap throws ApiRequestError carrying the ApiError body', async () => {
  const error = await unwrap(
    api.POST('/api/error-logs/search', { body: { serverId: 2, errorTime: '2026-11-08T14:32:00+09:00' } }),
  ).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(error).toMatchObject({ status: 404, code: 'NO_EXCEPTION_FOUND' });
}, 5000);

test('unwrap maps network failures to NETWORK_ERROR', async () => {
  server.use(http.get('*/api/servers', () => HttpResponse.error()));
  await expect(unwrap(api.GET('/api/servers'))).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
});

test('error-log list query: `+` in from/to is sent as %2B and status is repeated', async () => {
  const urls: string[] = [];
  server.events.on('request:start', ({ request }) => {
    urls.push(request.url);
  });
  const page = await unwrap(
    api.GET('/api/error-logs', {
      params: {
        query: {
          status: ['CROPPED', 'CONFIRMED'],
          from: '2026-11-08T00:00:00+09:00',
          to: '2026-11-08T23:59:59.5+09:00',
          page: 0,
          size: 20,
        },
      },
    }),
  );
  const url = urls[0];
  expect(url).toContain('from=2026-11-08T00%3A00%3A00%2B09%3A00');
  expect(url).toContain('to=2026-11-08T23%3A59%3A59.5%2B09%3A00');
  expect(url).not.toMatch(/\+09/);
  expect(url).toContain('status=CROPPED&status=CONFIRMED');
  // The mock decodes it back to the same instants (a raw `+` would become a space → 400).
  expect(new URL(url).searchParams.get('from')).toBe('2026-11-08T00:00:00+09:00');
  expect(page.items.map((l) => l.id)).toEqual(['20261108-001']);
});
