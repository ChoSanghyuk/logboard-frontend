import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, unwrap } from '../api/client';
import { server } from '../mocks/server';
import { captureBodies } from '../test/captureBodies';
import { renderApp } from '../test/render';

const ID = '20261108-001'; // fixture error log (CROPPED); endpoints: 1 internal-vllm (default), 2 openai (fails)
const path = { params: { path: { id: ID } } };

// Fake timers that still advance with real time (so Testing Library's waits work); jump ahead per poll.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
const tick = (ms = 2000) => act(() => vi.advanceTimersByTimeAsync(ms));

/** Counts GET /api/analyses/{id} polls. */
function countPolls() {
  const counter = { n: 0 };
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET' && /\/api\/analyses\/\d+$/.test(new URL(request.url).pathname)) counter.n++;
  });
  return counter;
}

const confirm = () => unwrap(api.POST('/api/error-logs/{id}/confirm', path));
const startViaApi = (llmEndpointId = 1, promptTemplateId = 1) =>
  unwrap(api.POST('/api/error-logs/{id}/analyses', { ...path, body: { llmEndpointId, promptTemplateId } }));
const pollViaApi = (id: number) => unwrap(api.GET('/api/analyses/{id}', { params: { path: { id } } }));

async function openPanel() {
  renderApp(`/errors/${ID}`);
  await screen.findByRole('heading', { name: ID });
  return within(screen.getByLabelText('Analysis'));
}

test('preselects the default endpoint and prompt', async () => {
  await confirm();
  const panel = await openPanel();
  await waitFor(() =>
    expect(panel.getByRole('combobox', { name: 'LLM endpoint' })).toHaveValue('internal-vllm'),
  );
  expect(panel.getByRole('combobox', { name: 'Prompt' })).toHaveValue('Java triage');
  expect(panel.getByRole('button', { name: 'Send to LLM' })).toBeEnabled();
});

test('send → PENDING with elapsed time and timeout → polls every 2s → DONE stops polling and refreshes the log', async () => {
  await confirm();
  const polls = countPolls();
  const bodies = captureBodies(/\/analyses$/);
  const u = user();
  const panel = await openPanel();
  await waitFor(() => expect(panel.getByRole('button', { name: 'Send to LLM' })).toBeEnabled());
  await u.click(panel.getByRole('button', { name: 'Send to LLM' }));

  const status = await panel.findByRole('status');
  expect(status).toHaveTextContent(/Analyzing… 0:0\d elapsed · times out after 120 s/);
  expect(bodies).toEqual([{ llmEndpointId: 1, promptTemplateId: 1 }]);
  expect(panel.getByRole('button', { name: 'Analyze again' })).toBeDisabled(); // one at a time

  await tick(); // poll 1: still PENDING
  expect(polls.n).toBe(1);
  expect(status).toHaveTextContent(/0:0[2-9] elapsed/);
  await tick(); // poll 2: DONE
  expect(await panel.findByRole('heading', { name: 'Root cause' })).toBeInTheDocument();
  expect(polls.n).toBe(2);
  expect(await screen.findByText('분석됨')).toBeInTheDocument(); // error log refetched → ANALYZED

  await tick(10_000);
  expect(polls.n).toBe(2); // stopped
  expect(panel.getByRole('button', { name: 'Analyze again' })).toBeEnabled();
});

test('FAILED stops polling, shows errorMessage, and Retry resends with the same endpoint and prompt', async () => {
  await confirm();
  const polls = countPolls();
  const bodies = captureBodies(/\/analyses$/);
  const u = user();
  const panel = await openPanel();
  await waitFor(() =>
    expect(panel.getByRole('combobox', { name: 'LLM endpoint' })).toHaveValue('internal-vllm'),
  );
  await u.click(panel.getByRole('combobox', { name: 'LLM endpoint' }));
  await u.click(await screen.findByRole('option', { name: 'openai', hidden: true }));
  await u.click(panel.getByRole('combobox', { name: 'Prompt' }));
  await u.click(await screen.findByRole('option', { name: 'Short summary', hidden: true }));
  await u.click(panel.getByRole('button', { name: 'Send to LLM' }));
  await panel.findByRole('status');
  await tick();
  await tick();
  expect(await panel.findAllByText(/HTTP 401 from https:\/\/api\.openai\.com/)).not.toHaveLength(0);
  expect(screen.getByText('확인됨')).toBeInTheDocument(); // FAILED leaves the status unchanged
  await tick(10_000);
  expect(polls.n).toBe(2);

  // Pick something else in the form: Retry still uses the failed analysis' endpoint and prompt.
  await u.click(panel.getByRole('combobox', { name: 'LLM endpoint' }));
  await u.click(await screen.findByRole('option', { name: 'internal-vllm', hidden: true }));
  await u.click(panel.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({ llmEndpointId: 2, promptTemplateId: 2 });
  expect(await panel.findByRole('status')).toHaveTextContent(/Analyzing/);
});

describe('Retry uses the failed analysis ids', () => {
  /** Serves the fixture as CONFIRMED with a FAILED latest analysis for these ids / names. */
  async function serveFailed(llmEndpointId: number, llmEndpointName: string) {
    await confirm();
    const base = await unwrap(api.GET('/api/error-logs/{id}', path));
    const failed = {
      id: 98,
      errorLogId: ID,
      llmEndpointId,
      llmEndpointName,
      promptTemplateId: 1,
      promptTemplateName: 'Java triage',
      status: 'FAILED' as const,
      errorMessage: 'timeout',
      createdAt: '2026-11-08T05:40:00Z',
      finishedAt: '2026-11-08T05:42:00Z',
    };
    server.use(
      http.get('*/api/error-logs/:id', () => HttpResponse.json({ ...base, latestAnalysis: failed })),
    );
  }

  test('a renamed endpoint (same id) can still be retried', async () => {
    await serveFailed(2, 'old-openai-name');
    const bodies = captureBodies(/\/analyses$/);
    const u = user();
    const panel = await openPanel();
    const retry = await panel.findByRole('button', { name: 'Retry' });
    await waitFor(() => expect(retry).toBeEnabled());
    await u.click(retry);
    await waitFor(() => expect(bodies).toEqual([{ llmEndpointId: 2, promptTemplateId: 1 }]));
  });

  test('a deleted endpoint disables Retry with a hint', async () => {
    await serveFailed(77, 'deleted-endpoint');
    const panel = await openPanel();
    expect(
      await panel.findByText('The endpoint or prompt no longer exists; pick another above.'),
    ).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });
});

test('resumes polling a PENDING latestAnalysis after a reload', async () => {
  await confirm();
  await startViaApi(); // PENDING, nobody polling it
  const polls = countPolls();
  const panel = await openPanel();
  expect(await panel.findByRole('status')).toHaveTextContent(/Analyzing/);
  await tick();
  await tick();
  expect(await panel.findByRole('heading', { name: 'Fix' })).toBeInTheDocument();
  await tick(6000);
  expect(polls.n).toBe(2);
});

describe('history-only statuses', () => {
  test.each([
    ['DEV_REQUIRED', '개발자 확인 필요'],
    ['TERMINATED', '종료됨'],
  ] as const)('%s: no send form; the latest analysis and history are shown', async (status, label) => {
    await confirm();
    const a = await startViaApi();
    await pollViaApi(a.id);
    await pollViaApi(a.id); // DONE → ANALYZED
    await unwrap(
      api.POST('/api/error-logs/{id}/dev-required', { ...path, body: { note: 'needs a code fix' } }),
    );
    if (status === 'TERMINATED')
      await unwrap(
        api.POST('/api/error-logs/{id}/terminate', { ...path, body: { resolution: 'fixed in #42' } }),
      );
    const panel = await openPanel();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(await panel.findByRole('heading', { name: 'Root cause' })).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: /Send to LLM|Analyze again/ })).not.toBeInTheDocument();
    expect(panel.queryByRole('combobox', { name: 'LLM endpoint' })).not.toBeInTheDocument();
    expect(await panel.findByText('History (1)')).toBeInTheDocument();
  });
});

test('history: newest first, collapsed; expanding shows the reply or error; re-analysis adds an entry', async () => {
  await confirm();
  const failed = await startViaApi(2, 2);
  await pollViaApi(failed.id);
  await pollViaApi(failed.id);
  const done = await startViaApi(1, 1);
  await pollViaApi(done.id);
  await pollViaApi(done.id);
  const u = user();
  const panel = await openPanel();
  expect(await panel.findByText('History (2)')).toBeInTheDocument();
  const items = panel.getAllByRole('button', { name: /internal-vllm|openai/ });
  expect(items[0]).toHaveTextContent('DONEinternal-vllm · Java triage');
  expect(items[1]).toHaveTextContent('FAILEDopenai · Short summary');
  expect(items[1]).toHaveAttribute('aria-expanded', 'false');

  await u.click(items[1]);
  expect(items[1]).toHaveAttribute('aria-expanded', 'true');
  expect(await panel.findAllByText(/HTTP 401 from/)).not.toHaveLength(0);

  await u.click(panel.getByRole('button', { name: 'Analyze again' }));
  expect(await panel.findByText('History (3)')).toBeInTheDocument();
});

test('the reply is markdown with code highlighting; raw HTML and javascript: links are not rendered', async () => {
  await confirm();
  const reply = [
    '## Root cause',
    '**customer** is null. <b>raw-bold</b> <img src="x" onerror="alert(1)"> <script>alert(2)</script>',
    '',
    '[click](javascript:alert(3))',
    '',
    '```java',
    'public final class Fix { }',
    '```',
  ].join('\n');
  const latest = {
    id: 99,
    errorLogId: ID,
    llmEndpointId: 1,
    llmEndpointName: 'internal-vllm',
    promptTemplateId: 1,
    promptTemplateName: 'Java triage',
    status: 'DONE' as const,
    reply,
    createdAt: '2026-11-08T05:40:00Z',
    finishedAt: '2026-11-08T05:40:12.5Z',
  };
  const base = await unwrap(api.GET('/api/error-logs/{id}', path));
  server.use(
    http.get('*/api/error-logs/:id', () =>
      HttpResponse.json({ ...base, status: 'ANALYZED', latestAnalysis: latest }),
    ),
    http.get('*/api/error-logs/:id/analyses', () => HttpResponse.json([latest])),
  );
  const u = user();
  const panel = await openPanel();
  const region = await panel.findByRole('heading', { name: 'Root cause' });
  const reply$ = region.closest('div')!;
  expect(within(reply$).getByText('customer').tagName).toBe('STRONG');
  expect(reply$.querySelector('script, img, b')).toBeNull();
  expect(screen.queryByText('raw-bold', { selector: 'b' })).toBeNull();
  expect(within(reply$).getByText('click').getAttribute('href') ?? '').not.toMatch(/javascript/);
  const code = reply$.querySelector('pre code')!;
  expect(code).toHaveClass('hljs', 'language-java');
  expect(code.querySelector('.hljs-keyword')).toHaveTextContent('public');
  expect(panel.getByText(/Finished 2026-11-08 14:40:12 \(13 s\)/)).toBeInTheDocument();

  await u.click(panel.getAllByRole('button', { name: 'Copy reply' })[0]);
  expect(await navigator.clipboard.readText()).toBe(reply);
});

test('no endpoints or prompts: hints link to Settings and Send is disabled', async () => {
  server.use(
    http.get('*/api/llm-endpoints', () => HttpResponse.json([])),
    http.get('*/api/prompts', () => HttpResponse.json([])),
  );
  await confirm();
  const panel = await openPanel();
  expect(await panel.findByRole('link', { name: 'Settings → LLM endpoints' })).toHaveAttribute(
    'href',
    '/settings/llm',
  );
  expect(panel.getByRole('link', { name: 'Settings → Prompts' })).toHaveAttribute(
    'href',
    '/settings/prompts',
  );
  expect(panel.getByRole('button', { name: 'Send to LLM' })).toBeDisabled();
});

test('409 INVALID_STATUS when sending (changed elsewhere) shows a message and refetches', async () => {
  await confirm();
  const u = user();
  const panel = await openPanel();
  await waitFor(() => expect(panel.getByRole('button', { name: 'Send to LLM' })).toBeEnabled());
  server.use(
    http.post('*/api/error-logs/:id/analyses', () =>
      HttpResponse.json(
        {
          code: 'INVALID_STATUS',
          message: 'START_ANALYSIS is not allowed in status TERMINATED',
          details: { status: 'TERMINATED', action: 'START_ANALYSIS' },
        },
        { status: 409 },
      ),
    ),
  );
  const refetched = new Promise<void>((resolve) =>
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && new URL(request.url).pathname.endsWith(`/error-logs/${ID}`)) resolve();
    }),
  );
  await u.click(panel.getByRole('button', { name: 'Send to LLM' }));
  expect(await screen.findByText('Status changed')).toBeInTheDocument();
  await refetched;
});
