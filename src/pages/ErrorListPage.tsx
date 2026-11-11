import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  MultiSelect,
  Pagination,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { type ErrorLogListQuery, useErrorLogs } from '../api/errorLogs';
import type { components } from '../api/schema';
import { useServers } from '../api/servers';
import { STATUS_META, StatusBadge } from '../components/StatusBadge';
import { formatInTz } from '../lib/format';
import { zonedWallTimeToIso } from '../lib/timezone';

type ErrorStatus = components['schemas']['ErrorLogSummary']['status'];

const PAGE_SIZE = 20;
const STATUSES = (Object.keys(STATUS_META) as ErrorStatus[]).map((value) => ({
  value,
  label: STATUS_META[value].label,
}));
/** Open work: everything except TERMINATED / DISCARDED. Used when the URL has no `status`. */
const DEFAULT_STATUSES: ErrorStatus[] = ['CROPPED', 'CONFIRMED', 'ANALYZED', 'DEV_REQUIRED'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = (s: string) => (DAY.test(s.trim()) ? s.trim() : null);

/** Day boundary in `tz` as ISO with offset; `end` = the last millisecond of the day. */
function dayBound(day: string | null, tz: string, end: boolean) {
  const iso = day && zonedWallTimeToIso(`${day} ${end ? '23:59:59' : '00:00:00'}`, tz);
  return iso ? (end ? `${iso.slice(0, 19)}.999${iso.slice(19)}` : iso) : undefined;
}

/**
 * /errors: filters (status, server, requestedTime date range) and page live in the URL query
 * (`?status=A&status=B&server=1&from=YYYY-MM-DD&to=YYYY-MM-DD&page=2`), so Back restores them.
 * No `status` → DEFAULT_STATUSES; an empty `status=` → any status.
 */
export function ErrorListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const servers = useServers();

  const statuses = params.has('status')
    ? (params.getAll('status').filter(Boolean) as ErrorStatus[])
    : DEFAULT_STATUSES;
  const serverId = params.get('server');
  const from = params.get('from');
  const to = params.get('to');
  const page = Math.max(1, Number(params.get('page')) || 1);

  // Dates are days in the selected server's timezone, else the browser's.
  const server = servers.data?.find((s) => String(s.id) === serverId);
  const tz = server?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const query: ErrorLogListQuery = {
    status: statuses.length ? statuses : undefined, // sent explicitly, also for the default
    serverId: serverId ? Number(serverId) : undefined,
    from: dayBound(from, tz, false),
    to: dayBound(to, tz, true),
    page: page - 1,
    size: PAGE_SIZE,
  };
  // Wait for the servers when a server is selected: its timezone decides the date bounds.
  const list = useErrorLogs(query, !(serverId && (from || to) && servers.isPending));

  /** Writes filters to the URL; any filter change goes back to page 1. */
  const update = (changes: Record<string, string | string[] | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        next.delete(key);
        if (Array.isArray(value)) (value.length ? value : ['']).forEach((v) => next.append(key, v));
        else if (value) next.set(key, value);
      }
      if (!('page' in changes)) next.delete('page');
      return next;
    });

  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));

  return (
    <>
      <Title order={2} mb="md">
        Errors
      </Title>
      <Group align="flex-end" mb="md">
        <Group gap={4} align="flex-end">
          <MultiSelect
            label="Status"
            placeholder={statuses.length ? undefined : 'Any status'}
            data={STATUSES}
            value={statuses}
            onChange={(v) => update({ status: v })}
            clearable
            clearButtonProps={{ 'aria-label': 'Clear status' }}
            miw={260}
          />
          <Popover width={420} position="bottom-start" withArrow shadow="md">
            <Popover.Target>
              <ActionIcon variant="subtle" color="gray" size="lg" aria-label="상태 안내">
                ⓘ
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Text fw={600} mb="xs">
                상태 안내
              </Text>
              <Stack gap="xs">
                {STATUSES.map(({ value }) => (
                  <div key={value}>
                    <StatusBadge status={value} />
                    <Text size="sm" mt={2}>
                      {STATUS_META[value].description}
                    </Text>
                  </div>
                ))}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Group>
        <Select
          label="Server"
          placeholder="All servers"
          data={servers.data?.map((s) => ({ value: String(s.id), label: s.name })) ?? []}
          value={serverId}
          onChange={(v) => update({ server: v })}
          clearable
        />
        <DateInput
          label="Requested from"
          placeholder="YYYY-MM-DD"
          valueFormat="YYYY-MM-DD"
          dateParser={parseDay}
          value={from}
          onChange={(v) => update({ from: v })}
          clearable
          description={`Days in ${tz}`}
        />
        <DateInput
          label="Requested to"
          placeholder="YYYY-MM-DD"
          valueFormat="YYYY-MM-DD"
          dateParser={parseDay}
          value={to}
          onChange={(v) => update({ to: v })}
          clearable
          description={`Days in ${tz}`}
        />
        {/* Back to the defaults: the four open statuses, any server, no dates. */}
        <Button variant="subtle" disabled={params.size === 0} onClick={() => setParams({})}>
          Reset filters
        </Button>
      </Group>

      {list.isPending && <Loader />}
      {list.isError && (
        <Alert color="red" title="Could not load the error logs">
          {list.error.message}
        </Alert>
      )}
      {list.data && (
        <>
          <Table highlightOnHover striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Server</Table.Th>
                <Table.Th>Requested</Table.Th>
                <Table.Th>Exception</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data.items.map((l) => {
                const exception = [l.exceptionClass ?? 'ERROR (no stack trace)', l.exceptionMessage]
                  .filter(Boolean)
                  .join(': ');
                return (
                  <Table.Tr
                    key={l.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/errors/${l.id}`)}
                  >
                    <Table.Td ff="monospace">
                      <Anchor component={Link} to={`/errors/${l.id}`} onClick={(e) => e.stopPropagation()}>
                        {l.id}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      {l.serverName}{' '}
                      <Text span size="xs" c="dimmed" title={`${l.instance.host}:${l.instance.sshPort}`}>
                        {l.instance.host}
                      </Text>
                    </Table.Td>
                    <Table.Td title={l.serverTimezone} style={{ whiteSpace: 'nowrap' }}>
                      {formatInTz(l.requestedTime, l.serverTimezone)}
                    </Table.Td>
                    <Table.Td maw={480}>
                      <Text size="sm" truncate="end" title={exception}>
                        {exception}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={l.status} />
                    </Table.Td>
                    <Table.Td title={l.serverTimezone} style={{ whiteSpace: 'nowrap' }}>
                      {formatInTz(l.createdAt, l.serverTimezone)}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          {list.data.items.length === 0 && (
            <Text c="dimmed" mt="md">
              No error logs match the filters.
            </Text>
          )}
          <Group justify="space-between" mt="md">
            <Text size="sm" c="dimmed">
              {list.data.total} error log{list.data.total === 1 ? '' : 's'} · newest first
            </Text>
            {totalPages > 1 && (
              <Pagination total={totalPages} value={page} onChange={(p) => update({ page: String(p) })} />
            )}
          </Group>
        </>
      )}
    </>
  );
}
