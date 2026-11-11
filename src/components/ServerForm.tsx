import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Code,
  Fieldset,
  Group,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { randomId } from '@mantine/hooks';
import {
  type InstanceDto,
  type InstanceUpsert,
  type ServerDto,
  type ServerUpsert,
  useLogPatterns,
  useSaveServer,
} from '../api/servers';
import { applyApiErrors } from '../lib/formErrors';
import { missingGroups, rotatedPatternError } from '../lib/logPattern';

const TIMEZONES = Intl.supportedValuesOf('timeZone');
const MAX_INSTANCES = 20;

type InstanceValues = {
  /** React key only, never sent. */
  key: string;
  /** Existing instance (kept on edit); undefined = new. */
  id: number | undefined;
  host: string;
  sshPort: number | string;
  logPath: string;
  username: string;
  authType: InstanceUpsert['authType'];
  password: string;
  privateKey: string;
};

type Values = {
  name: string;
  instances: InstanceValues[];
  rotatedPattern: string;
  patternMode: 'PRESET' | 'CUSTOM';
  logPatternKey: string | null;
  customLogRegex: string;
  timezone: string;
  charset: string;
};

const required = (v: string) => (v.trim() ? null : 'Required');

function isTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function instanceValues(i?: InstanceDto): InstanceValues {
  return {
    key: randomId(),
    id: i?.id,
    host: i?.host ?? '',
    sshPort: i?.sshPort ?? 22,
    logPath: i?.logPath ?? '',
    username: i?.username ?? '',
    authType: i?.authType ?? 'PASSWORD',
    password: '',
    privateKey: '',
  };
}

function initialValues(s?: ServerDto): Values {
  return {
    name: s?.name ?? '',
    instances: s ? s.instances.map(instanceValues) : [instanceValues()],
    rotatedPattern: s?.rotatedPattern ?? '',
    patternMode: s?.customLogRegex ? 'CUSTOM' : 'PRESET',
    logPatternKey: s?.logPatternKey ?? null,
    customLogRegex: s?.customLogRegex ?? '',
    timezone: s?.timezone ?? 'Asia/Seoul',
    charset: s?.charset ?? 'UTF-8',
  };
}

function toInstanceUpsert(i: InstanceValues): InstanceUpsert {
  const secretField = i.authType === 'KEY' ? 'privateKey' : 'password';
  return {
    ...(i.id !== undefined ? { id: i.id } : {}),
    host: i.host.trim(),
    sshPort: Number(i.sshPort),
    logPath: i.logPath.trim(),
    username: i.username.trim(),
    authType: i.authType,
    // Blank secret is omitted: on update the backend keeps that instance's stored one.
    ...(i[secretField] ? { [secretField]: i[secretField] } : {}),
  };
}

function toUpsert(v: Values): ServerUpsert {
  return {
    name: v.name.trim(),
    instances: v.instances.map(toInstanceUpsert),
    rotatedPattern: v.rotatedPattern.trim() || null,
    logPatternKey: v.patternMode === 'PRESET' ? v.logPatternKey : null,
    customLogRegex: v.patternMode === 'CUSTOM' ? v.customLogRegex : null,
    timezone: v.timezone,
    charset: v.charset.trim(),
  };
}

/** Add (no `server`) or edit a server. Server-side field errors are shown on the matching inputs. */
export function ServerForm({
  server,
  onSaved,
  onCancel,
}: {
  server?: ServerDto;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const patterns = useLogPatterns();
  const save = useSaveServer();
  const [formError, setFormError] = useState<string | null>(null);

  const stored = (i: InstanceValues) => server?.instances.find((s) => s.id === i.id);
  // A secret is required for a new instance, and when an instance's authType changes.
  const secretRequired = (i: InstanceValues) => stored(i)?.authType !== i.authType;
  // Rule path is `instances.N.field`.
  const rowOf = (all: Values, path: string) => all.instances[Number(path.split('.')[1])];

  const form = useForm<Values>({
    initialValues: initialValues(server),
    validate: {
      name: required,
      instances: {
        host: required,
        username: required,
        logPath: required,
        sshPort: (v) =>
          Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 65535 ? null : '1–65535',
        password: (v, all, path) => {
          const i = rowOf(all, path);
          return i.authType === 'PASSWORD' && secretRequired(i) && !v ? 'Password is required' : null;
        },
        privateKey: (v, all, path) => {
          const i = rowOf(all, path);
          return i.authType === 'KEY' && secretRequired(i) && !v.trim() ? 'Private key is required' : null;
        },
      },
      logPatternKey: (v, all) => (all.patternMode === 'PRESET' && !v ? 'Select a log pattern' : null),
      rotatedPattern: (v) => (v.trim() ? rotatedPatternError(v) : null),
      customLogRegex: (v, all) => {
        if (all.patternMode !== 'CUSTOM') return null;
        if (!v.trim()) return 'Regex is required';
        const missing = missingGroups(v);
        return missing.length
          ? `Missing named group(s): ${missing.map((g) => `(?<${g}>…)`).join(', ')}`
          : null;
      },
      timezone: (v) => (isTimezone(v) ? null : 'Unknown timezone'),
      charset: required,
    },
  });
  const v = form.values;

  const handleSubmit = (values: Values) => {
    setFormError(null);
    save.mutate(
      { id: server?.id, body: toUpsert(values) },
      {
        onSuccess: onSaved,
        onError: (error) =>
          setFormError(
            applyApiErrors(error, form, (f) =>
              // "exactly one of" comes back on logPatternKey; show it on whichever pattern input is visible.
              f === 'logPatternKey' && values.patternMode === 'CUSTOM'
                ? 'customLogRegex'
                : // An unknown instance id has no input: show it on that row's host.
                  f.replace(/^(instances\.\d+)\.id$/, '$1.host'),
            ),
          ),
      },
    );
  };

  const storedHint = (i: InstanceValues) => {
    const s = stored(i);
    if (!s) return undefined;
    if (s.authType !== i.authType) return 'Auth type changed — enter a new secret.';
    return s.hasSecret ? 'Secret stored — leave blank to keep it.' : undefined;
  };
  const preset = patterns.data?.find((p) => p.key === v.logPatternKey);

  return (
    <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
      <Stack>
        {formError && (
          <Alert color="red" title="Could not save" style={{ whiteSpace: 'pre-line' }}>
            {formError}
          </Alert>
        )}
        <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Instances
          </Text>
          {v.instances.map((inst, n) => {
            const at = (field: keyof InstanceValues) => form.getInputProps(`instances.${n}.${field}`);
            const label = `Instance #${n + 1}`;
            return (
              <Fieldset key={inst.key} legend={label} p="sm">
                <Stack gap="xs">
                  <SimpleGrid cols={{ base: 1, sm: 3 }}>
                    <TextInput label="Host" withAsterisk style={{ gridColumn: 'span 2' }} {...at('host')} />
                    <NumberInput
                      label="SSH port"
                      min={1}
                      max={65535}
                      allowDecimal={false}
                      {...at('sshPort')}
                    />
                  </SimpleGrid>
                  <TextInput
                    label="Log path"
                    withAsterisk
                    placeholder="/var/log/app/application.log"
                    {...at('logPath')}
                  />
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <TextInput label="Username" withAsterisk {...at('username')} />
                    <Stack gap={4}>
                      <Text size="sm" fw={500}>
                        Authentication
                      </Text>
                      <SegmentedControl
                        data={[
                          { label: 'Password', value: 'PASSWORD' },
                          { label: 'Private key', value: 'KEY' },
                        ]}
                        {...at('authType')}
                      />
                    </Stack>
                  </SimpleGrid>
                  {inst.authType === 'PASSWORD' ? (
                    <PasswordInput
                      label="Password"
                      withAsterisk={secretRequired(inst)}
                      description={storedHint(inst)}
                      autoComplete="new-password"
                      {...at('password')}
                    />
                  ) : (
                    <>
                      <Textarea
                        label="Private key"
                        withAsterisk={secretRequired(inst)}
                        description={storedHint(inst)}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                        autosize
                        minRows={4}
                        maxRows={10}
                        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                        {...at('privateKey')}
                      />
                      <Text size="xs" c="dimmed">
                        Passphrase-protected keys are not supported.
                      </Text>
                    </>
                  )}
                  <Group justify="flex-end">
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      disabled={v.instances.length <= 1}
                      onClick={() => form.removeListItem('instances', n)}
                    >
                      Remove instance #{n + 1}
                    </Button>
                  </Group>
                </Stack>
              </Fieldset>
            );
          })}
          {typeof form.errors.instances === 'string' && (
            <Text size="sm" c="red">
              {form.errors.instances}
            </Text>
          )}
          <Group>
            <Button
              variant="light"
              size="xs"
              disabled={v.instances.length >= MAX_INSTANCES}
              onClick={() => form.insertListItem('instances', instanceValues())}
            >
              + Add instance
            </Button>
            <Text size="xs" c="dimmed">
              1–{MAX_INSTANCES} instances. A search reads all of them.
            </Text>
          </Group>
        </Stack>

        <TextInput
          label="Rotated file pattern"
          placeholder="application-%d{yyyy-MM-dd}-%i.log.gz"
          description={
            <>
              Optional, logback-style, e.g. <Code>application-%d{'{yyyy-MM-dd}'}-%i.log.gz</Code>.{' '}
              <Code>%d</Code> or <Code>%d{'{<date format>}'}</Code> exactly once; <Code>%i</Code> and a
              trailing <Code>.gz</Code> are optional. Without a folder, past files are looked for in the same
              folder as the log path; to use another one, prefix it (e.g.{' '}
              <Code>/var/log/app/archive/application-%d.log</Code>).
            </>
          }
          {...form.getInputProps('rotatedPattern')}
        />

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Log pattern
          </Text>
          <SegmentedControl
            data={[
              { label: 'Preset', value: 'PRESET' },
              { label: 'Custom regex', value: 'CUSTOM' },
            ]}
            {...form.getInputProps('patternMode')}
          />
        </Stack>
        {v.patternMode === 'PRESET' ? (
          <Select
            label="Preset"
            withAsterisk
            data={patterns.data?.map((p) => p.key) ?? []}
            description={
              preset && (
                <Text span ff="monospace" size="xs">
                  {preset.example}
                </Text>
              )
            }
            {...form.getInputProps('logPatternKey')}
          />
        ) : (
          <Textarea
            label="Custom regex"
            withAsterisk
            description="Java regex matching the start of each entry. Must contain the named groups (?<ts>…) and (?<level>…)."
            autosize
            minRows={2}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            {...form.getInputProps('customLogRegex')}
          />
        )}

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Autocomplete label="Timezone" data={TIMEZONES} limit={20} {...form.getInputProps('timezone')} />
          <TextInput label="Charset" {...form.getInputProps('charset')} />
        </SimpleGrid>

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {server ? 'Save' : 'Add server'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
