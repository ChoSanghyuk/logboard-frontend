import { useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client';
import type { components } from '../api/schema';
import { useSearchErrorLog } from '../api/errorLogs';
import { useServers } from '../api/servers';
import { formatInTz } from '../lib/format';
import { applyApiErrors } from '../lib/formErrors';
import { isWallTime, offsetLabel, zonedWallTimeToIso } from '../lib/timezone';

type FetchFailure = components['schemas']['FetchFailure'];
type InstanceRef = components['schemas']['InstanceRef'];

const WINDOWS = [1, 2, 5, 10, 30];
const INLINE_CODES = ['NO_EXCEPTION_FOUND', 'FETCH_FAILED'];

type Values = {
  serverId: string | null;
  /** Wall time in the selected server's timezone: `YYYY-MM-DD HH:mm:ss`. */
  time: string | null;
  windowMin: string;
};

/** `details.failures` of NO_EXCEPTION_FOUND / FETCH_FAILED: instances that could not be read. */
function FailureList({ failures }: { failures: FetchFailure[] }) {
  return (
    <Stack gap={2} mt={4}>
      {failures.map((f) => (
        <Text size="sm" key={f.instanceId}>
          {f.host}:{f.sshPort}: {f.message}
        </Text>
      ))}
    </Stack>
  );
}

const parseWallTime = (s: string) => (isWallTime(s.trim()) ? s.trim() : null);

/** Today at 00:00:00 (browser's date): `YYYY-MM-DD 00:00:00`. */
const todayWallTime = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;
};

export function SearchPage() {
  const servers = useServers();
  const search = useSearchErrorLog();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  // Synchronous guard: `search.isPending` only updates on the next render.
  const inFlight = useRef(false);

  const serverOf = (id: string | number | null | undefined) =>
    servers.data?.find((s) => String(s.id) === String(id));

  const form = useForm<Values>({
    initialValues: { serverId: null, time: todayWallTime(), windowMin: '5' },
    validate: {
      serverId: (v) => (v ? null : 'Select a server'),
      time: (v, all) => {
        if (!v) return 'Enter the error time';
        if (!isWallTime(v)) return 'Use YYYY-MM-DD HH:mm:ss';
        const tz = serverOf(all.serverId)?.timezone;
        return tz && !zonedWallTimeToIso(v, tz) ? `This time doesn't exist in ${tz} (DST change)` : null;
      },
    },
  });
  const selected = serverOf(form.values.serverId);

  const handleSubmit = (values: Values) => {
    const server = serverOf(values.serverId);
    if (inFlight.current || !server || !values.time) return;
    inFlight.current = true;
    setFormError(null);
    search.mutate(
      {
        serverId: server.id,
        errorTime: zonedWallTimeToIso(values.time, server.timezone)!,
        windowMin: Number(values.windowMin),
      },
      {
        onSuccess: (detail) => navigate(`/errors/${detail.id}`),
        onError: (error) => {
          if (error instanceof ApiRequestError && INLINE_CODES.includes(error.code)) return;
          setFormError(applyApiErrors(error, form, (f) => (f === 'errorTime' ? 'time' : f)));
        },
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  const error = search.error instanceof ApiRequestError ? search.error : null;
  const failures = (error?.details.failures ?? []) as FetchFailure[];
  const searched = (error?.details.searchedInstances ?? []) as InstanceRef[];
  const searchedServer = serverOf(search.variables?.serverId);

  return (
    <>
      <Title order={2} mb="md">
        Search
      </Title>
      <Paper withBorder p="md" maw={520}>
        <form onSubmit={(e) => form.onSubmit(handleSubmit)(e)} noValidate>
          <fieldset disabled={search.isPending} style={{ border: 0, padding: 0, margin: 0 }}>
            <Stack>
              <Select
                label="Server"
                withAsterisk
                placeholder="Select a server"
                searchable
                data={servers.data?.map((s) => ({ value: String(s.id), label: s.name })) ?? []}
                {...form.getInputProps('serverId')}
              />
              {/* Known quirk: if the browser's own zone skips this wall time (DST), DateInput displays it an hour off; the value sent is still correct. */}
              <DateInput
                label="Error time"
                withAsterisk
                withTime
                placeholder="YYYY-MM-DD HH:mm:ss"
                valueFormat="YYYY-MM-DD HH:mm:ss"
                dateParser={parseWallTime}
                description={
                  selected
                    ? `Server time · ${selected.timezone} (${offsetLabel(selected.timezone, form.values.time)})`
                    : 'Server time · select a server first'
                }
                {...form.getInputProps('time')}
                onChange={(v) => {
                  // Picking a day in the calendar drops the time part: keep the time already entered.
                  const time = form.values.time?.slice(11) || '00:00:00';
                  form.setFieldValue('time', v && v.length === 10 ? `${v} ${time}` : v);
                }}
              />
              <Select
                label="Window"
                allowDeselect={false}
                data={WINDOWS.map((m) => ({ value: String(m), label: `± ${m} min` }))}
                {...form.getInputProps('windowMin')}
              />
              <Group justify="flex-end">
                <Button type="submit" loading={search.isPending}>
                  Search
                </Button>
              </Group>
            </Stack>
          </fieldset>
        </form>
      </Paper>

      <Stack maw={520} mt="md">
        {search.isPending && searchedServer && (
          <Group gap="sm" role="status">
            <Loader size="sm" />
            <Text size="sm">Fetching the log from {searchedServer.name}… this can take several seconds.</Text>
          </Group>
        )}
        {formError && (
          <Alert color="red" title="Search failed" style={{ whiteSpace: 'pre-line' }}>
            {formError}
          </Alert>
        )}
        {error?.code === 'NO_EXCEPTION_FOUND' && searchedServer && (
          <Alert color="yellow" title="No exception found">
            Nothing between {formatInTz(String(error.details.from), searchedServer.timezone)} and{' '}
            {formatInTz(String(error.details.to), searchedServer.timezone)} ({searchedServer.timezone}).
            {Number(search.variables?.windowMin) < 30
              ? ' Try a wider window or check the time.'
              : ' Check the time and the server.'}
            {searched.length > 0 && (
              <Text size="sm" mt={4}>
                Searched: {searched.map((i) => `${i.host}:${i.sshPort}`).join(', ')}
              </Text>
            )}
            {failures.length > 0 && (
              <>
                <Text size="sm" mt={4} fw={500}>
                  Not read (the error may be there):
                </Text>
                <FailureList failures={failures} />
              </>
            )}
          </Alert>
        )}
        {error?.code === 'FETCH_FAILED' && (
          <Alert color="red" title="Could not fetch the log">
            {failures.length ? <FailureList failures={failures} /> : error.message}
          </Alert>
        )}
      </Stack>
    </>
  );
}
