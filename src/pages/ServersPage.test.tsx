import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { server } from '../mocks/server';
import { renderApp } from '../test/render';

const row = async (name: string) => (await screen.findByRole('cell', { name })).closest('tr') as HTMLElement;
const testButton = async (name: string) =>
  within(await row(name)).getByRole('button', { name: 'Test connection' });

test('lists servers: first host:port +N (tooltip lists every instance), pattern, times in the server timezone', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  const r = within(await row('order-api'));
  expect(r.getByText('10.0.1.21:22')).toHaveTextContent('10.0.1.21:22 +1');
  expect(r.getByText('SPRING_BOOT_3')).toBeInTheDocument();
  expect(r.getByText('2026-11-08 09:00:00')).toBeInTheDocument(); // 00:00Z in Asia/Seoul
  await user.hover(r.getByText('10.0.1.21:22'));
  expect(
    await screen.findByText('10.0.1.22:22 · deploy2 · /var/log/order-api/application.log'),
  ).toBeInTheDocument();

  const billing = within(await row('billing-batch'));
  expect(billing.getByText('10.0.2.8:2222')).toHaveTextContent(/^10\.0\.2\.8:2222$/); // single instance: no +N
  expect(billing.getByText('Custom regex')).toBeInTheDocument();
});

test('test connection: one ✓ line per instance with message and file size', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(await testButton('order-api'));
  expect(await screen.findByText('Connection OK: order-api')).toBeInTheDocument();
  expect(
    screen.getByText(
      '✓ 10.0.1.21:22: Connected. Host key SHA256:mockOrderApiHostKey0000000000000000000000 · Log file found (50.0 MB)',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/^✓ 10\.0\.1\.22:22: Connected\./)).toBeInTheDocument();
});

test('test connection: ok:false is shown as a failure with each message', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(await testButton('billing-batch'));
  expect(await screen.findByText('Connection failed: billing-batch')).toBeInTheDocument();
  expect(screen.getByText('✗ 10.0.2.8:2222: Auth fail: password rejected')).toBeInTheDocument();
  expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
});

test('test connection: one instance failing fails the test and lists both results', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(await testButton('cart-api'));
  expect(await screen.findByText('Connection failed: cart-api')).toBeInTheDocument();
  expect(screen.getByText(/^✓ 10\.0\.4\.1:22: Connected\./)).toBeInTheDocument();
  expect(
    screen.getByText('✗ 10.0.4.2:22: Timed out after 10s (connecting to deploy@10.0.4.2:22)'),
  ).toBeInTheDocument();
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

test('host key per instance: fingerprint (shortened, full in the title) or "Not yet trusted"', async () => {
  renderApp('/servers');
  const order = within(await row('order-api'));
  expect(order.getByText('SHA256:mockOrderApi…')).toHaveAttribute(
    'title',
    'SHA256:mockOrderApiHostKey0000000000000000000000',
  );
  expect(order.getByText('SHA256:mockOrder2Ho…')).toBeInTheDocument();
  expect(order.getByRole('button', { name: 'Reset host key of 10.0.1.21:22' })).toBeInTheDocument();
  expect(order.getByRole('button', { name: 'Reset host key of 10.0.1.22:22' })).toBeInTheDocument();

  const eu = within(await row('eu-gateway'));
  expect(eu.getByText('Not yet trusted')).toBeInTheDocument(); // 10.8.0.5
  expect(eu.queryByRole('button', { name: 'Reset host key of 10.8.0.5:22' })).not.toBeInTheDocument();
  const billing = within(await row('billing-batch'));
  expect(billing.getByText('Not yet trusted')).toBeInTheDocument();
  expect(billing.queryByRole('button', { name: /Reset host key/ })).not.toBeInTheDocument();
});

test('reset host key of one instance asks for confirmation, then only that instance is "Not yet trusted"', async () => {
  const paths: string[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST') paths.push(new URL(request.url).pathname);
  });
  const user = userEvent.setup();
  renderApp('/servers');
  const reset = async () =>
    user.click(
      within(await row('order-api')).getByRole('button', { name: 'Reset host key of 10.0.1.22:22' }),
    );
  await reset();
  const dialog = within(await screen.findByRole('dialog', { name: 'Reset host key' }));
  expect(dialog.getByText(/\(10\.0\.1\.22:22\)/)).toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(within(await row('order-api')).getByText('SHA256:mockOrder2Ho…')).toBeInTheDocument();
  expect(paths).toEqual([]);

  await reset();
  const again = within(await screen.findByRole('dialog', { name: 'Reset host key' }));
  await user.click(again.getByRole('button', { name: 'Reset host key' }));
  expect(await screen.findByText('Host key reset: order-api (10.0.1.22:22)')).toBeInTheDocument();
  expect(paths).toEqual(['/api/servers/1/instances/12/reset-host-key']);
  await waitFor(async () =>
    expect(within(await row('order-api')).getByText('Not yet trusted')).toBeInTheDocument(),
  );
  expect(within(await row('order-api')).getByText('SHA256:mockOrderApi…')).toBeInTheDocument(); // 10.0.1.21 kept
});

test('a changed host key shows a warning for that instance that offers its reset; the next test trusts the new key', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  await user.click(await testButton('eu-gateway'));
  const alert = within(
    await screen.findByRole('alert', { name: 'Host key changed: eu-gateway (10.8.0.4:22)' }),
  );
  expect(
    alert.getByText(/Host key of 10\.8\.0\.4:22 changed: .* No credentials were sent\./),
  ).toBeInTheDocument();
  // The other instance's result is still reported.
  expect(await screen.findByText('Connection failed: eu-gateway')).toBeInTheDocument();
  expect(screen.getByText(/^✓ 10\.8\.0\.5:22: Connected\./)).toBeInTheDocument();

  await user.click(alert.getByRole('button', { name: 'Reset host key' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Reset host key' }));
  expect(dialog.getByText('eu-gateway')).toBeInTheDocument();
  expect(dialog.getByText(/\(10\.8\.0\.4:22\)/)).toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Reset host key' }));
  await waitFor(() =>
    expect(screen.queryByRole('alert', { name: /Host key changed/ })).not.toBeInTheDocument(),
  );

  await user.click(await testButton('eu-gateway'));
  expect(await screen.findByText('Connection OK: eu-gateway')).toBeInTheDocument();
  expect(await within(await row('eu-gateway')).findByText('SHA256:mockPinned31')).toBeInTheDocument();
  expect(within(await row('eu-gateway')).getByText('SHA256:mockPinned32')).toBeInTheDocument();
});

test('a single-instance server whose only result is a changed host key shows just the warning', async () => {
  const user = userEvent.setup();
  renderApp('/servers');
  // Make eu-gateway single-instance: keep only 10.8.0.4.
  await user.click(within(await row('eu-gateway')).getByRole('button', { name: 'Edit' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Edit eu-gateway' }));
  await user.click(dialog.getByRole('button', { name: 'Remove instance #2' }));
  await user.click(dialog.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await user.click(await testButton('eu-gateway'));
  expect(
    await screen.findByRole('alert', { name: 'Host key changed: eu-gateway (10.8.0.4:22)' }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Connection failed/)).not.toBeInTheDocument();
});
