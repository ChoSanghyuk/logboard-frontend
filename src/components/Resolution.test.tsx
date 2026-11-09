import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { api, unwrap } from '../api/client';
import type { components } from '../api/schema';
import { server } from '../mocks/server';
import { captureBodies } from '../test/captureBodies';
import { renderApp } from '../test/render';

type Detail = components['schemas']['ErrorLogDetail'];
const ID = '20261108-001'; // fixture: CROPPED, order-api (Asia/Seoul)
const path = { params: { path: { id: ID } } };

const terminateBtn = () => screen.queryByRole('button', { name: 'Terminate' });
const devBtn = () => screen.queryByRole('button', { name: 'Developer needed' });

async function open(id = ID) {
  renderApp(`/errors/${id}`);
  await screen.findByRole('heading', { name: id });
}

/** Moves the fixture to ANALYZED through the API (confirm → analysis → DONE). */
async function analyze() {
  await unwrap(api.POST('/api/error-logs/{id}/confirm', path));
  const a = await unwrap(
    api.POST('/api/error-logs/{id}/analyses', { ...path, body: { llmEndpointId: 1, promptTemplateId: 1 } }),
  );
  for (let i = 0; i < 2; i++) await unwrap(api.GET('/api/analyses/{id}', { params: { path: { id: a.id } } }));
}

test.each([
  ['CROPPED', false, false],
  ['CONFIRMED', true, false],
  ['ANALYZED', true, true],
  ['DEV_REQUIRED', true, false],
  ['TERMINATED', false, false],
  ['DISCARDED', false, false],
] as const)('%s: Terminate %s, Developer needed %s', async (status, terminate, dev) => {
  const base = await unwrap(api.GET('/api/error-logs/{id}', path));
  server.use(
    http.get('*/api/error-logs/:id', () =>
      HttpResponse.json({ ...base, status, note: status === 'DEV_REQUIRED' ? 'n' : null } satisfies Detail),
    ),
  );
  await open();
  await screen.findAllByText(/Cropped|Confirmed|Analyzed|Dev required|Terminated|Discarded/);
  expect(!!terminateBtn()).toBe(terminate);
  expect(!!devBtn()).toBe(dev);
});

test('Terminate: blank is rejected client-side; a resolution terminates and shows "Resolved by user"', async () => {
  await analyze();
  const bodies = captureBodies(/\/terminate$/);
  const user = userEvent.setup();
  await open();
  await user.click(terminateBtn()!);
  const dialog = within(await screen.findByRole('dialog'));
  const field = dialog.getByRole('textbox', { name: /Resolution/ });
  await user.type(field, '   ');
  await user.click(dialog.getByRole('button', { name: 'Terminate' }));
  expect(field).toHaveAccessibleDescription('Required');
  expect(bodies).toHaveLength(0);

  await user.type(field, ' fixed in #42 ');
  await user.click(dialog.getByRole('button', { name: 'Terminate' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(bodies).toEqual([{ resolution: 'fixed in #42' }]);
  const resolved = within(screen.getByLabelText('Resolution'));
  expect(resolved.getByText('Resolved by user')).toBeInTheDocument();
  expect(resolved.getByText('fixed in #42')).toBeInTheDocument();
  expect(resolved.getByText(/\(Asia\/Seoul\)/)).toBeInTheDocument();
  expect(screen.getByText('Terminated')).toBeInTheDocument();
  expect(terminateBtn()).not.toBeInTheDocument();
});

test('Developer needed: note is sent; the log shows the dev-required note and only Terminate', async () => {
  await analyze();
  const bodies = captureBodies(/\/dev-required$/);
  const user = userEvent.setup();
  await open();
  await user.click(devBtn()!);
  const dialog = within(await screen.findByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Mark as developer needed' }));
  expect(dialog.getByRole('textbox', { name: /Note/ })).toHaveAccessibleDescription('Required');
  await user.type(dialog.getByRole('textbox', { name: /Note/ }), 'guard customer in OrderService');
  await user.click(dialog.getByRole('button', { name: 'Mark as developer needed' }));
  expect(await screen.findByText('Dev required')).toBeInTheDocument();
  expect(bodies).toEqual([{ note: 'guard customer in OrderService' }]);
  expect(screen.getByText('Developer needed')).toBeInTheDocument(); // alert title
  expect(screen.getByText('guard customer in OrderService')).toBeInTheDocument();
  expect(devBtn()).not.toBeInTheDocument();
  expect(terminateBtn()).toBeInTheDocument();
});

test.each([
  ['terminate', 'Terminate', /Resolution/, 'resolution', 'Terminate'],
  ['dev-required', 'Developer needed', /Note/, 'note', 'Mark as developer needed'],
] as const)(
  '%s: a 400 field error is shown on the modal field',
  async (url, button, label, field, submit) => {
    await analyze();
    server.use(
      http.post(`*/api/error-logs/:id/${url}`, () =>
        HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            details: { fields: { [field]: 'too long' } },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: button }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: label }), 'x');
    await user.click(dialog.getByRole('button', { name: submit }));
    expect(await dialog.findByText('too long')).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: label })).toHaveAccessibleDescription('too long');
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument(); // no notification
  },
);

test('409 INVALID_STATUS: closes the modal, shows a message and refetches', async () => {
  await analyze();
  const user = userEvent.setup();
  await open();
  await user.click(devBtn()!);
  // The code agent / another user changes it meanwhile.
  await unwrap(
    api.POST('/api/error-logs/{id}/terminate', { ...path, body: { resolution: 'done elsewhere' } }),
  );
  const dialog = within(await screen.findByRole('dialog'));
  await user.type(dialog.getByRole('textbox', { name: /Note/ }), 'x');
  await user.click(dialog.getByRole('button', { name: 'Mark as developer needed' }));
  expect(await screen.findByText('Status changed')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(await screen.findByText('Terminated')).toBeInTheDocument();
  expect(screen.getByText('done elsewhere')).toBeInTheDocument();
});

test('AGENT resolution is marked as the code agent, with the kept note and resolvedAt in the server timezone', async () => {
  await open('20261107-001'); // fixture: TERMINATED by AGENT on eu-gateway (Europe/Berlin)
  const resolved = within(screen.getByLabelText('Resolution'));
  expect(resolved.getByText('Resolved by code agent (MCP)')).toBeInTheDocument();
  expect(resolved.getByText('2026-11-07 12:00:00 (Europe/Berlin)')).toBeInTheDocument();
  expect(resolved.getByText('Raised maximumPoolSize to 30 (commit 9f3c2e1)')).toBeInTheDocument();
  expect(resolved.getByText('Developer note: Pool too small for the nightly batch')).toBeInTheDocument();
  expect(screen.queryByText('Resolved by user')).not.toBeInTheDocument();
});
