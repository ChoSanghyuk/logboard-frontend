import { screen, waitFor, within } from '@testing-library/react';
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
/** Fieldset of instance #n (1-based). */
const row = (n: number) => within(screen.getByRole('group', { name: `Instance #${n}` }));
const rowPassword = (n: number) => row(n).getByLabelText(/^Password/, { selector: 'input[type=password]' });
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

describe('instances', () => {
  const order = servers[0]; // #1 10.0.1.21 KEY, #2 10.0.1.22 PASSWORD, both with a stored secret

  async function fillRow(user: ReturnType<typeof userEvent.setup>, n: number, host: string) {
    await user.type(row(n).getByRole('textbox', { name: /^Host/ }), host);
    await user.type(row(n).getByRole('textbox', { name: /^Username/ }), 'app');
    await user.type(row(n).getByRole('textbox', { name: /^Log path/ }), '/app/logs/application.log');
  }

  test('add / remove instances: at least 1, at most 20; port defaults to 22; sent in order', async () => {
    const bodies = captureServerBodies();
    const { user, onSaved } = renderForm();
    const add = screen.getByRole('button', { name: '+ Add instance' });
    expect(row(1).getByRole('button', { name: 'Remove instance #1' })).toBeDisabled(); // min 1

    await user.click(add);
    expect(row(2).getByRole('textbox', { name: /^SSH port/ })).toHaveValue('22');
    expect(row(1).getByRole('button', { name: 'Remove instance #1' })).toBeEnabled();
    await user.click(add);
    await user.click(row(2).getByRole('button', { name: 'Remove instance #2' }));
    expect(screen.getAllByRole('group', { name: /^Instance #/ })).toHaveLength(2);

    await user.type(textbox(/^Name/), 'pair-api');
    await fillRow(user, 1, '10.0.1.11');
    await user.type(rowPassword(1), 'pw1');
    await fillRow(user, 2, '10.0.1.12');
    await user.click(row(2).getByRole('radio', { name: 'Private key' }));
    await user.type(row(2).getByRole('textbox', { name: /^Private key/ }), 'KEY2');
    await pickPreset(user);
    await submit(user);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]!.instances).toEqual([
      {
        host: '10.0.1.11',
        sshPort: 22,
        logPath: '/app/logs/application.log',
        username: 'app',
        authType: 'PASSWORD',
        password: 'pw1',
      },
      {
        host: '10.0.1.12',
        sshPort: 22,
        logPath: '/app/logs/application.log',
        username: 'app',
        authType: 'KEY',
        privateKey: 'KEY2',
      },
    ]);
  });

  test('at most 20 instances', async () => {
    const { user } = renderForm();
    const add = screen.getByRole('button', { name: '+ Add instance' });
    for (let i = 1; i < 20; i++) await user.click(add);
    expect(screen.getAllByRole('group', { name: /^Instance #/ })).toHaveLength(20);
    expect(add).toBeDisabled();
  });

  test('required fields are checked per instance', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: '+ Add instance' }));
    await fillRow(user, 1, '10.0.1.11');
    await user.type(rowPassword(1), 'pw');
    await submit(user);
    expect(row(1).getByRole('textbox', { name: /^Host/ })).not.toHaveAccessibleDescription();
    expect(row(2).getByRole('textbox', { name: /^Host/ })).toHaveAccessibleDescription('Required');
    expect(rowPassword(2)).toHaveAccessibleDescription('Password is required');
  });

  test('edit: keeps instance ids; "Secret stored" per instance and a blank secret is omitted (kept)', async () => {
    const bodies = captureServerBodies();
    const { user, onSaved } = renderForm(order);
    expect(row(1).getByRole('textbox', { name: /^Private key/ })).toHaveAccessibleDescription(
      /Secret stored/,
    );
    expect(rowPassword(2)).toHaveAccessibleDescription(/Secret stored/);
    await submit(user, /Save/);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [a, b] = bodies[0]!.instances as Record<string, unknown>[];
    expect(a).toMatchObject({ id: 11, host: '10.0.1.21', authType: 'KEY' });
    expect(b).toMatchObject({ id: 12, host: '10.0.1.22', username: 'deploy2', authType: 'PASSWORD' });
    for (const i of [a, b]) {
      expect(i).not.toHaveProperty('privateKey');
      expect(i).not.toHaveProperty('password');
    }
    expect(bodies[0]).toMatchObject({ logPatternKey: 'SPRING_BOOT_3', customLogRegex: null });
  });

  test("edit: changing one instance's authType requires a new secret for that instance only", async () => {
    const bodies = captureServerBodies();
    const { user, onSaved } = renderForm(order);
    await user.click(row(1).getByRole('radio', { name: 'Password' }));
    expect(rowPassword(1)).toHaveAccessibleDescription(/Auth type changed/);
    await submit(user, /Save/);
    expect(rowPassword(1)).toHaveAccessibleDescription(/Password is required/);
    expect(rowPassword(2)).toHaveAccessibleDescription(/Secret stored/);
    expect(bodies).toHaveLength(0);

    await user.type(rowPassword(1), 's3cret');
    await submit(user, /Save/);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [a, b] = bodies[0]!.instances as Record<string, unknown>[];
    expect(a).toMatchObject({ id: 11, authType: 'PASSWORD', password: 's3cret' });
    expect(b).not.toHaveProperty('password');
  });

  test('edit: a new instance has no id and needs a secret; a removed one is not sent', async () => {
    const bodies = captureServerBodies();
    const { user, onSaved } = renderForm(order);
    await user.click(row(1).getByRole('button', { name: 'Remove instance #1' }));
    await user.click(screen.getByRole('button', { name: '+ Add instance' }));
    await fillRow(user, 2, '10.0.1.23');
    expect(rowPassword(2)).not.toHaveAccessibleDescription(/Secret stored/);
    await submit(user, /Save/);
    expect(rowPassword(2)).toHaveAccessibleDescription('Password is required');
    await user.type(rowPassword(2), 'pw3');
    await submit(user, /Save/);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const instances = bodies[0]!.instances as Record<string, unknown>[];
    expect(instances.map((i) => i.id)).toEqual([12, undefined]);
    expect(instances[1]).toMatchObject({ host: '10.0.1.23', password: 'pw3' });
  });

  test('server errors on instances[N].field land on that row (mock API: duplicate host/port/path)', async () => {
    const { user, onSaved } = renderForm();
    await user.type(textbox(/^Name/), 'dup-api');
    await user.click(screen.getByRole('button', { name: '+ Add instance' }));
    for (const n of [1, 2]) {
      await fillRow(user, n, '10.0.1.11');
      await user.type(rowPassword(n), 'pw');
    }
    await pickPreset(user);
    await submit(user);
    await waitFor(() =>
      expect(row(2).getByRole('textbox', { name: /^Host/ })).toHaveAccessibleDescription(
        'duplicate host, port and log path',
      ),
    );
    expect(row(1).getByRole('textbox', { name: /^Host/ })).not.toHaveAccessibleDescription();
    expect(onSaved).not.toHaveBeenCalled();
  });

  test('nested server errors: field, secret and unknown id go to their row; list errors under the list', async () => {
    server.use(
      http.put('*/api/servers/:id', () =>
        HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            details: {
              fields: {
                'instances[0].logPath': 'must not be blank',
                'instances[1].privateKey': 'required',
                'instances[1].id': 'not an instance of this server',
                'instances[5].host': 'no such row',
                instances: 'size must be between 1 and 20',
              },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const { user, onSaved } = renderForm(order);
    await user.click(row(2).getByRole('radio', { name: 'Private key' }));
    await user.type(row(2).getByRole('textbox', { name: /^Private key/ }), 'K');
    await submit(user, /Save/);
    await waitFor(() =>
      expect(row(1).getByRole('textbox', { name: /^Log path/ })).toHaveAccessibleDescription(
        'must not be blank',
      ),
    );
    expect(row(2).getByRole('textbox', { name: /^Private key/ })).toHaveAccessibleDescription(/required/);
    expect(row(2).getByRole('textbox', { name: /^Host/ })).toHaveAccessibleDescription(
      'not an instance of this server',
    );
    expect(screen.getByText('size must be between 1 and 20')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('instances[5].host: no such row');
    expect(onSaved).not.toHaveBeenCalled();
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
            details: {
              fields: {
                'instances[0].host': 'unresolvable host',
                charset: 'unknown charset',
                secretEnc: 'boom',
              },
            },
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
