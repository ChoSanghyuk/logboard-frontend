import { describe, expect, test } from 'vitest';
import { api, ApiRequestError, unwrap } from '../api/client';

test('mock API rejects a rotatedPattern without %d on fields.rotatedPattern', async () => {
  const error = await unwrap(
    api.POST('/api/servers', {
      body: {
        name: 'new-api',
        instances: [
          { host: 'h', username: 'u', authType: 'PASSWORD', password: 'pw', logPath: '/var/log/app.log' },
        ],
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
    // Candidates on both instances; the anchor is on instance 12.
    expect(d.instance).toEqual({
      id: 12,
      host: '10.0.1.22',
      sshPort: 22,
      logPath: '/var/log/order-api/application.log',
    });
    // Ordered by instance position, then line (contract, settled with B12).
    expect(d.candidates.map((c) => [c.instanceId, c.anchorLine])).toEqual([
      [11, 300],
      [12, 201],
      [12, 300],
    ]);
    expect(d.fetchFailures).toEqual([]);
  }, 5000);

  test('search: some instances fail → 201 with fetchFailures; all fail → 502 details.failures; 404 lists instances', async () => {
    const partial = await search({ serverId: 4, errorTime: '2026-11-08T14:32:00+09:00' });
    expect(partial.instance.id).toBe(41);
    expect(partial.fetchFailures).toEqual([
      expect.objectContaining({ instanceId: 42, host: '10.0.4.2', sshPort: 22, message: expect.any(String) }),
    ]);
    await expect(search({ serverId: 3, errorTime: '2026-11-08T14:32:00+01:00' })).rejects.toMatchObject({
      status: 502,
      code: 'FETCH_FAILED',
      message:
        '10.8.0.4:22: SFTP: no such file /var/log/gateway/gateway.log on 10.8.0.4; ' +
        '10.8.0.5:22: SFTP: no such file /var/log/gateway/gateway.log on 10.8.0.5',
      details: { failures: [{ instanceId: 31 }, { instanceId: 32 }] },
    });
    await expect(search({ serverId: 2, errorTime: '2026-11-08T14:32:00+09:00' })).rejects.toMatchObject({
      status: 404,
      code: 'NO_EXCEPTION_FOUND',
      details: { searchedInstances: [{ id: 21, host: '10.0.2.8' }], failures: [] },
    });
  }, 10000);

  test('404 searchedInstances lists only the instances that were read; failed ones only in failures', async () => {
    const billing = (await unwrap(api.GET('/api/servers'))).find((x) => x.id === 2)!;
    await unwrap(
      api.PUT('/api/servers/{id}', {
        params: { path: { id: 2 } },
        body: {
          ...billing,
          instances: [
            ...billing.instances,
            { host: 'node-down', username: 'batch', authType: 'PASSWORD', password: 'pw', logPath: '/a.log' },
          ],
        },
      }),
    );
    const error = await search({ serverId: 2, errorTime: '2026-11-08T14:32:00+09:00' }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 404, code: 'NO_EXCEPTION_FOUND' });
    const details = (error as ApiRequestError).details;
    expect(details.searchedInstances).toEqual([expect.objectContaining({ id: 21 })]);
    expect(details.failures).toEqual([expect.objectContaining({ host: 'node-down' })]);
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

  test('PATCH crop across instances: (anchorLine, instanceId) must match a candidate; instanceId needs anchorLine', async () => {
    // Fixture: anchor 201 on instance 12; instance 11 only has a candidate at 300.
    await expect(crop({ anchorLine: 201, instanceId: 11 })).rejects.toMatchObject({
      status: 400,
      details: { fields: { anchorLine: expect.any(String) } },
    });
    await expect(crop({ instanceId: 11 })).rejects.toMatchObject({
      status: 400,
      details: { fields: { instanceId: expect.any(String) } },
    });
    const moved = await crop({ anchorLine: 300, instanceId: 11 });
    expect(moved).toMatchObject({ instance: { id: 11, host: '10.0.1.21' }, crop: { anchorLine: 300 } });
    // Without instanceId the current instance (now 11) is used; expand stays on it.
    await expect(crop({ expandAfter: 50 })).resolves.toMatchObject({ instance: { id: 11 } });
    await expect(crop({ anchorLine: 201 })).rejects.toMatchObject({ status: 400 });
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

describe('servers with instances (B12)', () => {
  const inst = {
    host: 'h1',
    username: 'u',
    authType: 'PASSWORD' as const,
    password: 'pw',
    logPath: '/a.log',
  };
  const base = { name: 'multi-api', logPatternKey: 'SPRING_BOOT_3' };
  const fieldsOf = (e: unknown) => (e as ApiRequestError).details.fields;

  test('validation: 1–20 instances, nested field keys, duplicate host/port/path on the later one', async () => {
    const post = (instances: unknown[]) =>
      unwrap(api.POST('/api/servers', { body: { ...base, instances } as never })).catch((e: unknown) => e);
    expect(fieldsOf(await post([]))).toHaveProperty('instances');
    expect(
      fieldsOf(await post(Array.from({ length: 21 }, (_, i) => ({ ...inst, host: `h${i}` })))),
    ).toHaveProperty('instances');
    expect(fieldsOf(await post([inst, { ...inst, host: ' ', password: undefined }]))).toEqual({
      'instances[1].host': expect.any(String),
      'instances[1].password': expect.any(String),
    });
    expect(fieldsOf(await post([inst, { ...inst, sshPort: 22 }]))).toEqual({
      'instances[1].host': 'duplicate host, port and log path',
    });
  });

  test('update: id keeps the instance (and its secret), unknown id → 400, host change forgets the host key', async () => {
    const put = (instances: unknown[]) =>
      unwrap(
        api.PUT('/api/servers/{id}', {
          params: { path: { id: 1 } },
          body: { ...base, name: 'order-api', instances } as never,
        }),
      );
    const kept = {
      id: 11,
      host: '10.0.1.21',
      username: 'deploy',
      authType: 'KEY',
      logPath: '/var/log/order-api/application.log',
    };
    await expect(put([kept, { ...kept, id: 21, host: 'x' }])).rejects.toMatchObject({
      details: { fields: { 'instances[1].id': expect.any(String) } },
    });
    // authType change on an existing instance needs the matching secret.
    await expect(put([{ ...kept, authType: 'PASSWORD' }])).rejects.toMatchObject({
      details: { fields: { 'instances[0].password': 'required' } },
    });
    const updated = await put([{ ...kept, host: '10.0.1.99' }, inst]);
    expect(updated.instances).toMatchObject([
      { id: 11, host: '10.0.1.99', hasSecret: true, hostKeyFingerprint: null },
      { host: 'h1', hasSecret: true, hostKeyFingerprint: null },
    ]);
    expect(updated.instances[1].id).toBeGreaterThan(42); // new id
    expect(updated.instances[0]).not.toHaveProperty('privateKey');
  });

  test('reset-host-key is per instance; unknown instance → 404; test returns one result per instance', async () => {
    const reset = (id: number, instanceId: number) =>
      unwrap(
        api.POST('/api/servers/{id}/instances/{instanceId}/reset-host-key', {
          params: { path: { id, instanceId } },
        }),
      );
    const after = await reset(1, 12);
    expect(after.instances.map((i) => i.hostKeyFingerprint)).toEqual([
      'SHA256:mockOrderApiHostKey0000000000000000000000',
      null,
    ]);
    await expect(reset(1, 21)).rejects.toMatchObject({ status: 404 });
    const result = await unwrap(api.POST('/api/servers/{id}/test', { params: { path: { id: 4 } } }));
    expect(result).toMatchObject({
      ok: false,
      results: [
        { instanceId: 41, ok: true },
        { instanceId: 42, ok: false },
      ],
    });
  });
});
