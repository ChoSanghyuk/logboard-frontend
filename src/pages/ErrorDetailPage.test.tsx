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
const ID = '20261108-001'; // fixture: CROPPED, crop 181–220 of 400, anchor 201, candidates 201 / 300, order-api (Seoul)

const before = () => screen.getByRole('button', { name: /\+50 before/ });
const after = () => screen.getByRole('button', { name: /\+50 after/ });
const row = (no: number) => document.querySelector<HTMLElement>(`[data-line="${no}"]`);
const loaded = () => screen.findByRole('heading', { name: ID });

/** Serve a modified copy of the fixture detail for GET. */
async function serveDetail(change: (d: Detail) => Partial<Detail>) {
  const base = await unwrap(api.GET('/api/error-logs/{id}', { params: { path: { id: ID } } }));
  const detail = { ...base, ...change(base) };
  server.use(http.get('*/api/error-logs/:id', () => HttpResponse.json(detail)));
}

test('header: id, server, status, exception, requested time in the server timezone', async () => {
  renderApp(`/errors/${ID}`);
  await loaded();
  expect(screen.getByText('order-api')).toBeInTheDocument();
  expect(screen.getByText('Cropped')).toBeInTheDocument();
  expect(
    screen.getByText(
      (_, el) =>
        el?.tagName === 'P' &&
        el.textContent ===
          'java.lang.NullPointerException: Cannot invoke "Customer.getId()" because "customer" is null',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Requested 2026-11-08 14:32:00 \(Asia\/Seoul\) · window ± 5 min/),
  ).toBeInTheDocument();
  expect(row(201)).toHaveAttribute('data-kind', 'ANCHOR');
  expect(row(202)).toHaveAttribute('data-kind', 'STACK');
  expect(row(181)).toHaveAttribute('data-kind', 'CONTEXT');
});

test('a null exceptionClass (ERROR entry without a trace) is shown as such', async () => {
  await serveDetail(() => ({ exceptionClass: null, exceptionMessage: 'Order failed' }));
  renderApp(`/errors/${ID}`);
  await loaded();
  expect(screen.getAllByText('ERROR (no stack trace)')[0]).toBeInTheDocument();
});

test('expand before / after send expandStep and update the viewer from the response', async () => {
  const bodies = captureBodies(/\/crop$/);
  const user = userEvent.setup();
  renderApp(`/errors/${ID}`);
  await loaded();
  expect(before()).toBeEnabled();
  expect(after()).toBeEnabled();

  await user.click(before());
  await waitFor(() => expect(row(131)).not.toBeNull());
  await user.click(after());
  await waitFor(() => expect(row(270)).not.toBeNull());
  expect(bodies).toEqual([{ expandBefore: 50 }, { expandAfter: 50 }]);
  expect(screen.getByText('Lines 131–270 (140)')).toBeInTheDocument();
});

test('file bounds: before disabled at line 1, after disabled at totalLines, with the reason', async () => {
  await serveDetail((d) => ({ crop: { ...d.crop, startLine: 1, lines: d.crop.lines } }));
  const user = userEvent.setup();
  renderApp(`/errors/${ID}`);
  await loaded();
  expect(before()).toBeDisabled();
  expect(after()).toBeEnabled();
  await user.hover(before().parentElement!);
  expect(await screen.findByText('Already at the start of the file.')).toBeInTheDocument();
});

test('end of file disables after', async () => {
  await serveDetail((d) => ({ crop: { ...d.crop, endLine: 400 } }));
  renderApp(`/errors/${ID}`);
  await loaded();
  expect(before()).toBeEnabled();
  expect(after()).toBeDisabled();
});

test('maxLines reached disables both and says why', async () => {
  await serveDetail((d) => ({ crop: { ...d.crop, maxLines: 40 } })); // crop is 181–220 = 40 lines
  renderApp(`/errors/${ID}`);
  await loaded();
  expect(before()).toBeDisabled();
  expect(after()).toBeDisabled();
  expect(screen.getByText('The crop is at the 40-line limit.')).toBeInTheDocument();
});

test('switching candidates sends anchorLine and re-crops around it', async () => {
  const bodies = captureBodies(/\/crop$/);
  const user = userEvent.setup();
  renderApp(`/errors/${ID}`);
  await loaded();
  const current = screen.getByRole('radio', { name: /NullPointerException/ });
  expect(current).toBeChecked();
  expect(screen.getByText('line 201 · current')).toBeInTheDocument();
  const sql = screen.getByRole('radio', { name: /2026-11-08 14:33:10 · java\.sql\.SQLException/ });
  await user.click(sql);
  await waitFor(() => expect(row(300)).toHaveAttribute('data-kind', 'ANCHOR'));
  expect(bodies).toEqual([{ anchorLine: 300 }]);
  expect(sql).toBeChecked();
  expect(row(201)).toBeNull();
});

test('confirm: CONFIRMED locks the crop, hides confirm/discard and shows the analysis placeholder', async () => {
  const user = userEvent.setup();
  renderApp(`/errors/${ID}`);
  await loaded();
  expect(screen.queryByLabelText('Analysis')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Confirm crop/ }));
  expect(await screen.findByText('Confirmed')).toBeInTheDocument();
  expect(before()).toBeDisabled();
  expect(after()).toBeDisabled();
  expect(screen.getByRole('radio', { name: /SQLException/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /Confirm crop/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Analysis')).toBeInTheDocument();
});

test('discard asks for confirmation, then moves to DISCARDED', async () => {
  const bodies = captureBodies(/\/discard$/);
  const user = userEvent.setup();
  renderApp(`/errors/${ID}`);
  await loaded();
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Discard error log' }));
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(bodies).toHaveLength(0);

  await user.click(screen.getByRole('button', { name: 'Discard' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByText('Discarded')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(bodies).toHaveLength(1);
  expect(screen.queryByLabelText('Analysis')).not.toBeInTheDocument();
});

test('409 INVALID_STATUS (changed elsewhere): shows a message and refetches the latest state', async () => {
  const user = userEvent.setup();
  renderApp(`/errors/${ID}`);
  await loaded();
  // Someone else confirms it meanwhile; this page still shows CROPPED.
  await unwrap(api.POST('/api/error-logs/{id}/confirm', { params: { path: { id: ID } } }));
  await user.click(before());
  expect(await screen.findByText('Status changed')).toBeInTheDocument();
  expect(screen.getByText(/RECROP is not allowed in status CONFIRMED/)).toBeInTheDocument();
  expect(await screen.findByText('Confirmed')).toBeInTheDocument();
  expect(before()).toBeDisabled();
});

test('unknown id shows not found', async () => {
  renderApp('/errors/20261108-999');
  expect(await screen.findByText('Error log not found')).toBeInTheDocument();
  expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
});
