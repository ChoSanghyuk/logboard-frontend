import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, test, vi } from 'vitest';
import { servers } from '../mocks/fixtures';
import { server } from '../mocks/server';
import { captureBodies } from '../test/captureBodies';
import { renderWithProviders } from '../test/render';
import { ServerForm } from './ServerForm';

const textbox = (name: RegExp) => screen.getByRole('textbox', { name });
const passwordInput = () => screen.getByLabelText(/^Password/, { selector: 'input[type=password]' });
const submit = (user: ReturnType<typeof userEvent.setup>, name = /Add server|Save/) =>
  user.click(screen.getByRole('button', { name }));

const captureServerBodies = () => captureBodies(/\/api\/servers(\/\d+)?$/);

function renderForm(edit?: (typeof servers)[number]) {
  const onSaved = vi.fn();
  renderWithProviders(<ServerForm server={edit} onSaved={onSaved} onCancel={() => {}} />);
  return { onSaved, user: userEvent.setup() };
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, name = 'new-api') {
  await user.type(textbox(/^Name/), name);
  await user.type(textbox(/^Host/), '10.0.0.5');
  await user.type(textbox(/^Username/), 'deploy');
  await user.type(textbox(/^Log path/), '/var/log/app.log');
}

async function pickPreset(user: ReturnType<typeof userEvent.setup>, key = 'SPRING_BOOT_3') {
  await user.click(screen.getByRole('combobox', { name: /^Preset/ }));
  await user.click(await screen.findByRole('option', { name: key, hidden: true }));
}

describe('client validation', () => {
  test('empty create form shows required errors and sends nothing', async () => {
    const bodies = captureServerBodies();
    const { user, onSaved } = renderForm();
    await submit(user);
    expect(textbox(/^Name/)).toHaveAccessibleDescription('Required');
    expect(textbox(/^Host/)).toHaveAccessibleDescription('Required');
    expect(passwordInput()).toHaveAccessibleDescription('Password is required');
    expect(screen.getByRole('combobox', { name: /^Preset/ })).toHaveAccessibleDescription(
      /Select a log pattern/,
    );
    expect(bodies).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  test('create with private key requires the key and notes passphrase keys are unsupported', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('radio', { name: 'Private key' }));
    expect(screen.getByText('Passphrase-protected keys are not supported.')).toBeInTheDocument();
    await submit(user);
    expect(textbox(/^Private key/)).toHaveAccessibleDescription('Private key is required');
  });

  test('custom regex must contain the ts and level named groups', async () => {
    const { user, onSaved } = renderForm();
    await fillRequired(user);
    await user.type(passwordInput(), 'pw');
    await user.click(screen.getByRole('radio', { name: 'Custom regex' }));
    const regex = textbox(/^Custom regex/);
    await user.type(regex, '^(?<ts>\\S+) (\\w+)');
    await submit(user);
    expect(regex).toHaveAccessibleDescription(/Missing named group\(s\): \(\?<level>…\)/);
    expect(onSaved).not.toHaveBeenCalled();

    await user.clear(regex);
    await user.type(regex, '^(?<ts>\\S+) (?<level>\\w+)');
    await submit(user);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe('rotated pattern', () => {
  test('optional, but when filled %d must appear exactly once', async () => {
    const { user, onSaved } = renderForm();
    await fillRequired(user);
    await user.type(passwordInput(), 'pw');
    await pickPreset(user);
    const rotated = textbox(/^Rotated file pattern/);
    expect(rotated).toHaveAccessibleDescription(/%i.*optional/);

    await user.type(rotated, 'app.%i.log.gz');
    await submit(user);
    expect(rotated).toHaveAccessibleDescription(/%d must appear exactly once \(found 0\)/);

    await user.clear(rotated);
    await user.type(rotated, 'app.%d.%d.log');
    await submit(user);
    expect(rotated).toHaveAccessibleDescription(/found 2/);
    expect(onSaved).not.toHaveBeenCalled();

    await user.clear(rotated);
    await user.type(rotated, 'app.%d{{yyyy-MM-dd}.%i.log.gz'); // `{{` types a literal `{`
    await submit(user);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  test('server error on fields.rotatedPattern is shown on that field', async () => {
    server.use(
      http.post('*/api/servers', () =>
        HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            details: { fields: { rotatedPattern: 'timezone option inside %d is not allowed' } },
          },
          { status: 400 },
        ),
      ),
    );
    const { user, onSaved } = renderForm();
    await fillRequired(user);
    await user.type(passwordInput(), 'pw');
    await pickPreset(user);
    await user.type(textbox(/^Rotated file pattern/), 'app.%d{{yyyy-MM-dd, UTC}.log');
    await submit(user);
    await waitFor(() =>
      expect(textbox(/^Rotated file pattern/)).toHaveAccessibleDescription(/timezone option inside %d/),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('secret rules on edit', () => {
  const keyServer = servers[0]; // authType KEY, hasSecret

  test('same authType: shows "secret stored" and a blank secret is omitted (kept)', async () => {
    const bodies = captureServerBodies();
    const { user, onSaved } = renderForm(keyServer);
    expect(textbox(/^Private key/)).toHaveAccessibleDescription(/Secret stored/);
    await submit(user, /Save/);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).not.toHaveProperty('privateKey');
    expect(bodies[0]).not.toHaveProperty('password');
    expect(bodies[0]).toMatchObject({ logPatternKey: 'SPRING_BOOT_3', customLogRegex: null });
  });

  test('changed authType requires a new secret', async () => {
    const bodies = captureServerBodies();
    const { user, onSaved } = renderForm(keyServer);
    await user.click(screen.getByRole('radio', { name: 'Password' }));
    expect(passwordInput()).toHaveAccessibleDescription(/Auth type changed/);
    await submit(user, /Save/);
    expect(passwordInput()).toHaveAccessibleDescription(/Password is required/);
    expect(bodies).toHaveLength(0);

    await user.type(passwordInput(), 's3cret');
    await submit(user, /Save/);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ authType: 'PASSWORD', password: 's3cret' });
  });
});

describe('server errors', () => {
  test('VALIDATION_FAILED fields are shown on the matching inputs; unknown fields in an alert', async () => {
    server.use(
      http.post('*/api/servers', () =>
        HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            details: { fields: { host: 'unresolvable host', charset: 'unknown charset', secretEnc: 'boom' } },
          },
          { status: 400 },
        ),
      ),
    );
    const { user, onSaved } = renderForm();
    await fillRequired(user);
    await user.type(passwordInput(), 'pw');
    await pickPreset(user);
    await submit(user);
    await waitFor(() => expect(textbox(/^Host/)).toHaveAccessibleDescription('unresolvable host'));
    expect(textbox(/^Charset/)).toHaveAccessibleDescription('unknown charset');
    expect(screen.getByRole('alert')).toHaveTextContent('secretEnc: boom');
    expect(onSaved).not.toHaveBeenCalled();
  });

  test('"exactly one pattern" error lands on the custom regex input when it is visible', async () => {
    server.use(
      http.post('*/api/servers', () =>
        HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'x', details: { fields: { logPatternKey: 'exactly one' } } },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderForm();
    await fillRequired(user);
    await user.type(passwordInput(), 'pw');
    await user.click(screen.getByRole('radio', { name: 'Custom regex' }));
    await user.type(textbox(/^Custom regex/), '(?<ts>.)(?<level>.)');
    await submit(user);
    await waitFor(() => expect(textbox(/^Custom regex/)).toHaveAccessibleDescription(/exactly one/));
  });

  test('DUPLICATE_NAME is shown on the name field (mock API)', async () => {
    const { user, onSaved } = renderForm();
    await fillRequired(user, 'order-api');
    await user.type(passwordInput(), 'pw');
    await pickPreset(user);
    await submit(user);
    await waitFor(() => expect(textbox(/^Name/)).toHaveAccessibleDescription(/already exists/));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
