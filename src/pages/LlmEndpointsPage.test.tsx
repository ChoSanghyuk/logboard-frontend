import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../mocks/server';
import { captureBodies } from '../test/captureBodies';
import { renderApp } from '../test/render';

const row = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;
const dialog = async (name: string | RegExp) => within(await screen.findByRole('dialog', { name }));
const apiKeyInput = (d: ReturnType<typeof within>) =>
  d.getByLabelText(/^API key/, { selector: 'input[type=password]' });

async function openEdit(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(await row(name)).getByRole('button', { name: 'Edit' }));
  return dialog(`Edit ${name}`);
}

test('edit with a stored apiKey: shows the hint, and a blank key is omitted (kept)', async () => {
  const bodies = captureBodies(/\/api\/llm-endpoints\/\d+$/);
  const user = userEvent.setup();
  renderApp('/settings/llm');
  const d = await openEdit(user, 'openai');
  expect(apiKeyInput(d)).toHaveAccessibleDescription(/Secret stored/);
  await user.click(d.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(bodies[0]).not.toHaveProperty('apiKey');
  expect(within(await row('openai')).getByText('stored')).toBeInTheDocument();
});

test('a new apiKey is sent; an endpoint without one shows no secret', async () => {
  const bodies = captureBodies(/\/api\/llm-endpoints(\/\d+)?$/);
  const user = userEvent.setup();
  renderApp('/settings/llm');
  const d = await openEdit(user, 'internal-vllm');
  expect(apiKeyInput(d)).toHaveAccessibleDescription(/Optional/);
  await user.type(apiKeyInput(d), 'sk-new');
  await user.click(d.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies[0]).toMatchObject({ apiKey: 'sk-new' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(within(await row('internal-vllm')).getByText('stored')).toBeInTheDocument();
});

test('setting a new default clears it on the others after the list refreshes', async () => {
  const user = userEvent.setup();
  renderApp('/settings/llm');
  expect(within(await row('internal-vllm')).getByText('Default')).toBeInTheDocument();
  const d = await openEdit(user, 'openai');
  await user.click(d.getByRole('switch', { name: /Default endpoint/ }));
  await user.click(d.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(within(screen.getByText('openai').closest('tr')!).queryByText('Default')).toBeInTheDocument(),
  );
  expect(within(await row('internal-vllm')).queryByText('Default')).not.toBeInTheDocument();
});

test('client validation and server field errors on the form', async () => {
  server.use(
    http.post('*/api/llm-endpoints', () =>
      HttpResponse.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { fields: { model: 'unknown model' } },
        },
        { status: 400 },
      ),
    ),
  );
  const user = userEvent.setup();
  renderApp('/settings/llm');
  await row('openai');
  await user.click(screen.getByRole('button', { name: 'Add endpoint' }));
  const d = await dialog('Add LLM endpoint');
  await user.click(d.getByRole('button', { name: 'Add endpoint' }));
  expect(d.getByRole('textbox', { name: /^Base URL/ })).toHaveAccessibleDescription(/Enter an http\(s\) URL/);
  expect(d.getByRole('textbox', { name: /^Timeout/ })).toHaveValue('120');
  const timeout = d.getByRole('textbox', { name: /^Timeout/ });
  await user.clear(timeout);
  await user.type(timeout, '5000');
  await user.tab();
  expect(timeout).toHaveValue('3600'); // clamped to the backend max on blur
  await user.clear(timeout);
  await user.type(timeout, '120');

  await user.type(d.getByRole('textbox', { name: /^Name/ }), 'new');
  await user.type(d.getByRole('textbox', { name: /^Base URL/ }), 'http://llm:8000');
  await user.type(d.getByRole('textbox', { name: /^Model/ }), 'm');
  await user.click(d.getByRole('button', { name: 'Add endpoint' }));
  await waitFor(() =>
    expect(d.getByRole('textbox', { name: /^Model/ })).toHaveAccessibleDescription('unknown model'),
  );
});

test('test button: ok shows latency, ok:false shows a failure with its message', async () => {
  const user = userEvent.setup();
  renderApp('/settings/llm');
  await user.click(within(await row('internal-vllm')).getByRole('button', { name: 'Test' }));
  expect(await screen.findByText('Test OK: internal-vllm')).toBeInTheDocument();
  expect(screen.getByText('OK · 640 ms')).toBeInTheDocument();

  await user.click(within(await row('openai')).getByRole('button', { name: 'Test' }));
  expect(await screen.findByText('Test failed: openai')).toBeInTheDocument();
  expect(screen.getByText('HTTP 401 from LLM: invalid API key · 180 ms')).toBeInTheDocument();
});

test('delete: 409 IN_USE explains that analyses reference it; an unused one is deleted', async () => {
  const user = userEvent.setup();
  renderApp('/settings/llm');
  await user.click(within(await row('internal-vllm')).getByRole('button', { name: 'Delete' }));
  let d = await dialog('Delete LLM endpoint');
  await user.click(d.getByRole('button', { name: 'Delete' }));
  expect(await d.findByText(/existing analyses reference this LLM endpoint/)).toBeInTheDocument();
  expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
  await user.click(d.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('internal-vllm')).toBeInTheDocument();

  await user.click(within(await row('openai')).getByRole('button', { name: 'Delete' }));
  d = await dialog('Delete LLM endpoint');
  expect(d.queryByText(/existing analyses/)).not.toBeInTheDocument(); // previous error was reset
  await user.click(d.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByText('openai')).not.toBeInTheDocument());
});

test('"Remove stored key" is offered only when a key is stored and sends clearApiKey without apiKey', async () => {
  const bodies = captureBodies(/\/api\/llm-endpoints\/\d+$/);
  const user = userEvent.setup();
  renderApp('/settings/llm');
  let d = await openEdit(user, 'internal-vllm'); // hasSecret: false
  expect(d.queryByRole('checkbox', { name: 'Remove stored key' })).not.toBeInTheDocument();
  await user.click(d.getByRole('button', { name: 'Cancel' }));

  d = await openEdit(user, 'openai'); // hasSecret: true
  await user.type(apiKeyInput(d), 'typed-then-removed');
  await user.click(d.getByRole('checkbox', { name: 'Remove stored key' }));
  expect(apiKeyInput(d)).toBeDisabled();
  expect(apiKeyInput(d)).toHaveValue('');
  await user.click(d.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(bodies[0]).toMatchObject({ clearApiKey: true });
  expect(bodies[0]).not.toHaveProperty('apiKey');
  expect(within(await row('openai')).getByText('—')).toBeInTheDocument();
});

test('a duplicate name is shown on the name field', async () => {
  const user = userEvent.setup();
  renderApp('/settings/llm');
  const d = await openEdit(user, 'internal-vllm');
  const name = d.getByRole('textbox', { name: /^Name/ });
  await user.clear(name);
  await user.type(name, 'openai');
  await user.click(d.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(name).toHaveAccessibleDescription(/already exists/));
});
