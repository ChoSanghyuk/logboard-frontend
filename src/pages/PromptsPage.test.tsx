import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../mocks/server';
import { captureBodies } from '../test/captureBodies';
import { renderApp } from '../test/render';

const row = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;
const dialog = async (name: string) => within(await screen.findByRole('dialog', { name }));

async function openAdd(user: ReturnType<typeof userEvent.setup>) {
  await row('Java triage');
  await user.click(screen.getByRole('button', { name: 'Add prompt' }));
  const d = await dialog('Add prompt');
  return { d, content: d.getByRole('textbox', { name: /^Content/ }) };
}

test('content without {{errorLog}} is rejected client-side; click-to-insert fixes it', async () => {
  const bodies = captureBodies(/\/api\/prompts$/);
  const user = userEvent.setup();
  renderApp('/settings/prompts');
  const { d, content } = await openAdd(user);
  await user.type(d.getByRole('textbox', { name: /^Name/ }), 'New');
  await user.type(content, 'Explain: ');
  await user.click(d.getByRole('button', { name: 'Add prompt' }));
  expect(content).toHaveAccessibleDescription(/Must contain \{\{errorLog\}\}/);
  expect(bodies).toHaveLength(0);

  await user.click(d.getByRole('button', { name: '{{errorLog}}' }));
  expect(content).toHaveValue('Explain: {{errorLog}}');
  await user.click(d.getByRole('button', { name: 'Add prompt' }));
  expect(await screen.findByText('New')).toBeInTheDocument();
  expect(bodies[0]).toMatchObject({ name: 'New', content: 'Explain: {{errorLog}}', isDefault: false });
});

test('placeholders are inserted at the cursor', async () => {
  const user = userEvent.setup();
  renderApp('/settings/prompts');
  const { d, content } = await openAdd(user);
  await user.type(content, 'AB');
  (content as HTMLTextAreaElement).setSelectionRange(1, 1);
  await user.click(d.getByRole('button', { name: '{{serverName}}' }));
  expect(content).toHaveValue('A{{serverName}}B');
});

test("the backend's 400 on content is shown on the content field", async () => {
  server.use(
    http.post('*/api/prompts', () =>
      HttpResponse.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { fields: { content: 'unknown placeholder {{foo}}' } },
        },
        { status: 400 },
      ),
    ),
  );
  const user = userEvent.setup();
  renderApp('/settings/prompts');
  const { d, content } = await openAdd(user);
  await user.type(d.getByRole('textbox', { name: /^Name/ }), 'New');
  await user.click(d.getByRole('button', { name: '{{errorLog}}' }));
  await user.click(d.getByRole('button', { name: 'Add prompt' }));
  await waitFor(() => expect(content).toHaveAccessibleDescription(/unknown placeholder \{\{foo\}\}/));
});

test('setting a new default clears it on the others after the list refreshes', async () => {
  const user = userEvent.setup();
  renderApp('/settings/prompts');
  expect(within(await row('Java triage')).getByText('Default')).toBeInTheDocument();
  await user.click(within(await row('Short summary')).getByRole('button', { name: 'Edit' }));
  const d = await dialog('Edit Short summary');
  await user.click(d.getByRole('switch', { name: /Default prompt/ }));
  await user.click(d.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(
      within(screen.getByText('Short summary').closest('tr')!).queryByText('Default'),
    ).toBeInTheDocument(),
  );
  expect(within(await row('Java triage')).queryByText('Default')).not.toBeInTheDocument();
});

test('delete: 409 IN_USE explains that analyses reference it', async () => {
  const user = userEvent.setup();
  renderApp('/settings/prompts');
  await user.click(within(await row('Java triage')).getByRole('button', { name: 'Delete' }));
  const d = await dialog('Delete prompt template');
  await user.click(d.getByRole('button', { name: 'Delete' }));
  expect(await d.findByText(/existing analyses reference this prompt template/)).toBeInTheDocument();
  expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
});
