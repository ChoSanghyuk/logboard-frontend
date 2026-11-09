import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Code,
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
import { type ServerDto, type ServerUpsert, useLogPatterns, useSaveServer } from '../api/servers';
import { applyApiErrors } from '../lib/formErrors';
import { missingGroups, rotatedPatternError } from '../lib/logPattern';

const TIMEZONES = Intl.supportedValuesOf('timeZone');

type Values = {
  name: string;
  host: string;
  sshPort: number | string;
  username: string;
  authType: ServerUpsert['authType'];
  password: string;
  privateKey: string;
  logPath: string;
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

function initialValues(s?: ServerDto): Values {
  return {
    name: s?.name ?? '',
    host: s?.host ?? '',
    sshPort: s?.sshPort ?? 22,
    username: s?.username ?? '',
    authType: s?.authType ?? 'PASSWORD',
    password: '',
    privateKey: '',
    logPath: s?.logPath ?? '',
    rotatedPattern: s?.rotatedPattern ?? '',
    patternMode: s?.customLogRegex ? 'CUSTOM' : 'PRESET',
    logPatternKey: s?.logPatternKey ?? null,
    customLogRegex: s?.customLogRegex ?? '',
    timezone: s?.timezone ?? 'Asia/Seoul',
    charset: s?.charset ?? 'UTF-8',
  };
}

function toUpsert(v: Values): ServerUpsert {
  const secretField = v.authType === 'KEY' ? 'privateKey' : 'password';
  return {
    name: v.name.trim(),
    host: v.host.trim(),
    sshPort: Number(v.sshPort),
    username: v.username.trim(),
    authType: v.authType,
    // Blank secret is omitted: on update the backend keeps the stored one.
    ...(v[secretField] ? { [secretField]: v[secretField] } : {}),
    logPath: v.logPath.trim(),
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

  // Secret is required on create, and on edit when authType changes.
  const secretRequired = (v: Values) => !server || server.authType !== v.authType;

  const form = useForm<Values>({
    initialValues: initialValues(server),
    validate: {
      name: required,
      host: required,
      username: required,
      logPath: required,
      sshPort: (v) =>
        Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 65535 ? null : '1–65535',
      password: (v, all) =>
        all.authType === 'PASSWORD' && secretRequired(all) && !v ? 'Password is required' : null,
      privateKey: (v, all) =>
        all.authType === 'KEY' && secretRequired(all) && !v.trim() ? 'Private key is required' : null,
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
            // "exactly one of" comes back on logPatternKey; show it on whichever pattern input is visible.
            applyApiErrors(error, form, (f) =>
              f === 'logPatternKey' && values.patternMode === 'CUSTOM' ? 'customLogRegex' : f,
            ),
          ),
      },
    );
  };

  const storedHint =
    server?.hasSecret && server.authType === v.authType
      ? 'Secret stored — leave blank to keep it.'
      : server && server.authType !== v.authType
        ? 'Auth type changed — enter a new secret.'
        : undefined;
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
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput
            label="Host"
            withAsterisk
            style={{ gridColumn: 'span 2' }}
            {...form.getInputProps('host')}
          />
          <NumberInput
            label="SSH port"
            min={1}
            max={65535}
            allowDecimal={false}
            {...form.getInputProps('sshPort')}
          />
        </SimpleGrid>
        <TextInput label="Username" withAsterisk {...form.getInputProps('username')} />

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Authentication
          </Text>
          <SegmentedControl
            data={[
              { label: 'Password', value: 'PASSWORD' },
              { label: 'Private key', value: 'KEY' },
            ]}
            {...form.getInputProps('authType')}
          />
        </Stack>
        {v.authType === 'PASSWORD' ? (
          <PasswordInput
            label="Password"
            withAsterisk={secretRequired(v)}
            description={storedHint}
            autoComplete="new-password"
            {...form.getInputProps('password')}
          />
        ) : (
          <Textarea
            label="Private key"
            withAsterisk={secretRequired(v)}
            description={storedHint}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            autosize
            minRows={4}
            maxRows={10}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            {...form.getInputProps('privateKey')}
          />
        )}
        {v.authType === 'KEY' && (
          <Text size="xs" c="dimmed" mt={-8}>
            Passphrase-protected keys are not supported.
          </Text>
        )}

        <TextInput
          label="Log path"
          withAsterisk
          placeholder="/var/log/app/application.log"
          {...form.getInputProps('logPath')}
        />
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
