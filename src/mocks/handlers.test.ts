import { describe, expect, test } from 'vitest';
import { api, ApiRequestError, unwrap } from '../api/client';

test('mock API rejects a rotatedPattern without %d on fields.rotatedPattern', async () => {
  const error = await unwrap(
    api.POST('/api/servers', {
      body: {
        name: 'new-api',
        host: 'h',
        username: 'u',
        authType: 'PASSWORD',
        password: 'pw',
        logPath: '/var/log/app.log',
        logPatternKey: 'SPRING_BOOT_3',
        rotatedPattern: 'app.%i.log.gz',
      },
    }),
  ).catch((e: unknown) => e);
  expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  expect((error as ApiRequestError).details.fields).toHaveProperty('rotatedPattern');
});

test('LLM endpoint PUT with apiKey and clearApiKey together → 400', async () => {
  const body = { name: 'openai', baseUrl: 'https://api.openai.com', model: 'm', isDefault: false };
  await expect(
    unwrap(
      api.PUT('/api/llm-endpoints/{id}', {
        params: { path: { id: 2 } },
        body: { ...body, apiKey: 'k', clearApiKey: true },
      }),
    ),
  ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  const updated = await unwrap(
    api.PUT('/api/llm-endpoints/{id}', { params: { path: { id: 2 } }, body: { ...body, clearApiKey: true } }),
  );
  expect(updated.hasSecret).toBe(false);
});

test('names are unique per resource → 409 DUPLICATE_NAME on name', async () => {
  const dup = { status: 409, code: 'DUPLICATE_NAME', details: { field: 'name' } };
  await expect(
    unwrap(
      api.POST('/api/prompts', { body: { name: 'Java triage', content: '{{errorLog}}', isDefault: false } }),
    ),
  ).rejects.toMatchObject(dup);
  await expect(
    unwrap(
      api.PUT('/api/prompts/{id}', {
        params: { path: { id: 2 } },
        body: { name: 'Java triage', content: '{{errorLog}}', isDefault: false },
      }),
    ),
  ).rejects.toMatchObject(dup);
  // Keeping your own name is fine.
  await expect(
    unwrap(
      api.PUT('/api/prompts/{id}', {
        params: { path: { id: 2 } },
        body: { name: 'Short summary', content: '{{errorLog}}', isDefault: false },
      }),
    ),
  ).resolves.toMatchObject({ name: 'Short summary' });
  await expect(
    unwrap(
      api.POST('/api/llm-endpoints', {
        body: { name: 'openai', baseUrl: 'http://x', model: 'm', isDefault: false },
      }),
    ),
  ).rejects.toMatchObject(dup);
});

describe('error-log rules (B4)', () => {
  const search = (body: { serverId: number; errorTime: string; windowMin?: number }) =>
    unwrap(api.POST('/api/error-logs/search', { body }));
  const crop = (body: Record<string, number>, id = '20261108-001') =>
    unwrap(api.PATCH('/api/error-logs/{id}/crop', { params: { path: { id } }, body }));

  test('search: errorTime without offset → 400 BAD_REQUEST; windowMin 1–1440; unknown server → 404', async () => {
    await expect(search({ serverId: 1, errorTime: '2026-11-08T14:32:00' })).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    });
    for (const windowMin of [0, 1441])
      await expect(
        search({ serverId: 1, errorTime: '2026-11-08T14:32:00+09:00', windowMin }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        details: { fields: { windowMin: expect.any(String) } },
      });
    await expect(search({ serverId: 99, errorTime: '2026-11-08T14:32:00+09:00' })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  test('search: a soft-deleted server → 404 NOT_FOUND', async () => {
    await unwrap(api.DELETE('/api/servers/{id}', { params: { path: { id: 1 } } })); // referenced → soft delete
    await expect(search({ serverId: 1, errorTime: '2026-11-08T14:32:00+09:00' })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  test('search success returns a contract-shaped ErrorLogDetail with UTC timestamps', async () => {
    const d = await search({ serverId: 1, errorTime: '2026-11-08T14:32:00+09:00', windowMin: 10 });
    expect(d).toMatchObject({
      serverId: 1,
      serverName: 'order-api',
      requestedTime: '2026-11-08T05:32:00.000Z',
      windowMin: 10,
      status: 'CROPPED',
      crop: { expandStep: 50, maxLines: 2000, anchorLine: 201, totalLines: 400 },
    });
    expect(d.id).toMatch(/^\d{8}-\d{3,}$/);
    expect(d.createdAt).toMatch(/Z$/);
    expect(d.candidates.length).toBeGreaterThan(1);
  }, 5000);

  test('list: size must be 1–100', async () => {
    for (const size of [0, 101])
      await expect(unwrap(api.GET('/api/error-logs', { params: { query: { size } } }))).rejects.toMatchObject(
        {
          status: 400,
          details: { fields: { size: expect.any(String) } },
        },
      );
  });

  test('PATCH crop: empty body or a non-candidate anchorLine → 400 VALIDATION_FAILED', async () => {
    await expect(crop({})).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    await expect(crop({ anchorLine: 250 })).rejects.toMatchObject({
      status: 400,
      details: { fields: { anchorLine: expect.any(String) } },
    });
    await expect(crop({ anchorLine: 300 })).resolves.toMatchObject({ crop: { anchorLine: 300 } });
  });

  test('illegal transition → 409 INVALID_STATUS with details { status, action }', async () => {
    const id = '20261108-001';
    await unwrap(api.POST('/api/error-logs/{id}/confirm', { params: { path: { id } } }));
    await expect(crop({ expandBefore: 50 }, id)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATUS',
      details: { status: 'CONFIRMED', action: 'RECROP' },
    });
    await expect(
      unwrap(api.POST('/api/error-logs/{id}/discard', { params: { path: { id } } })),
    ).rejects.toMatchObject({ details: { status: 'CONFIRMED', action: 'DISCARD' } });
  });
});
