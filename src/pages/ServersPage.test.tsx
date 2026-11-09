import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { renderApp } from '../test/render';

const row = async (name: string) => (await screen.findByRole('cell', { name })).closest('tr') as HTMLElement;

test('lists servers with host:port, pattern and UTC timestamps shown in the server timezone', async () => {
  renderApp('/servers');
  const r = within(await row('order-api'));
  expect(r.getByText('10.0.1.21:22')).toBeInTheDocument();
  expect(r.getByText('SPRING_BOOT_3')).toBeInTheDocument();
  expect(r.getByText('2026-11-08 09:00:00')).toBeInTheDocument(); // 00:00Z in Asia/Seoul
  expect(within(await row('billing-batch')).getByText('Custom regex')).toBeInTheDocument();
});

test('test connection: ok shows message and file size', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(within(await row('order-api')).getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Connection OK: order-api')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Connected. Host key SHA256:mockOrderApiHostKey0000000000000000000000 · Log file found (50.0 MB)',
    ),
  ).toBeInTheDocument();
});

test('test connection: ok:false is shown as a failure with its message', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(within(await row('billing-batch')).getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Connection failed: billing-batch')).toBeInTheDocument();
  expect(screen.getByText('Auth fail: password rejected')).toBeInTheDocument();
  expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
});

test('delete asks for confirmation, then removes the row', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(within(await row('billing-batch')).getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete server' });
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByRole('cell', { name: 'billing-batch' })).not.toBeInTheDocument());
  expect(screen.getByRole('cell', { name: 'order-api' })).toBeInTheDocument();
});

test('add server through the modal adds a row', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await row('order-api');
  await user.click(screen.getByRole('button', { name: 'Add server' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Add server' }));
  await user.type(dialog.getByRole('textbox', { name: /^Name/ }), 'search-api');
  await user.type(dialog.getByRole('textbox', { name: /^Host/ }), '10.0.3.1');
  await user.type(dialog.getByRole('textbox', { name: /^Username/ }), 'deploy');
  await user.type(dialog.getByRole('textbox', { name: /^Log path/ }), '/var/log/search.log');
  await user.type(dialog.getByLabelText(/^Password/, { selector: 'input[type=password]' }), 'pw');
  await user.click(dialog.getByRole('combobox', { name: /^Preset/ }));
  await user.click(await screen.findByRole('option', { name: 'LOGBACK_DEFAULT', hidden: true }));
  await user.click(dialog.getByRole('button', { name: 'Add server' }));
  expect(await screen.findByRole('cell', { name: 'search-api' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('host key: shows the fingerprint (shortened, full in the title) or "Not yet trusted"', async () => {
  renderApp('/servers');
  const fp = within(await row('order-api')).getByText('SHA256:mockOrderApi…');
  expect(fp).toHaveAttribute('title', 'SHA256:mockOrderApiHostKey0000000000000000000000');
  const billing = within(await row('billing-batch'));
  expect(billing.getByText('Not yet trusted')).toBeInTheDocument();
  expect(billing.queryByRole('button', { name: 'Reset host key' })).not.toBeInTheDocument();
});

test('reset host key asks for confirmation, then shows "Not yet trusted"', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(within(await row('order-api')).getByRole('button', { name: 'Reset host key' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Reset host key' }));
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(within(await row('order-api')).getByText('SHA256:mockOrderApi…')).toBeInTheDocument();

  await user.click(within(await row('order-api')).getByRole('button', { name: 'Reset host key' }));
  const again = within(await screen.findByRole('dialog', { name: 'Reset host key' }));
  await user.click(again.getByRole('button', { name: 'Reset host key' }));
  expect(await screen.findByText('Host key reset: order-api')).toBeInTheDocument();
  await waitFor(async () =>
    expect(within(await row('order-api')).getByText('Not yet trusted')).toBeInTheDocument(),
  );
});

test('a changed host key shows a prominent warning that offers the reset; the next test trusts the new key', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(within(await row('eu-gateway')).getByRole('button', { name: 'Test connection' }));
  const alert = within(await screen.findByRole('alert', { name: 'Host key changed: eu-gateway' }));
  expect(
    alert.getByText(/Host key of 10\.8\.0\.4:22 changed: .* No credentials were sent\./),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Connection failed/)).not.toBeInTheDocument(); // the warning replaces the toast

  await user.click(alert.getByRole('button', { name: 'Reset host key' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Reset host key' }));
  expect(dialog.getByText('eu-gateway')).toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Reset host key' }));
  await waitFor(() =>
    expect(screen.queryByRole('alert', { name: 'Host key changed: eu-gateway' })).not.toBeInTheDocument(),
  );

  await user.click(within(await row('eu-gateway')).getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Connection OK: eu-gateway')).toBeInTheDocument();
  expect(await within(await row('eu-gateway')).findByText('SHA256:mockPinned3')).toBeInTheDocument();
});
