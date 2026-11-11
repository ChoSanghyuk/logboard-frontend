import { useState } from 'react';
import { Alert, Button, Code, Group, Modal, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { type ServerDto, useDeleteServer, useResetHostKey, useServers, useTestServer } from '../api/servers';
import { ServerForm } from '../components/ServerForm';
import { formatBytes, formatInTz } from '../lib/format';

/** One instance of a server, for the host key warning and the reset confirmation. */
type InstanceOf = { server: ServerDto; instanceId: number; where: string };

const HOST_KEY_CHANGED = /Host key .* changed/;
const where = (i: { host: string; sshPort: number }) => `${i.host}:${i.sshPort}`;

export function ServersPage() {
  const servers = useServers();
  const remove = useDeleteServer();
  const test = useTestServer();
  const resetKey = useResetHostKey();
  // undefined = closed, null = adding, ServerDto = editing
  const [editing, setEditing] = useState<ServerDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ServerDto | null>(null);
  const [resetting, setResetting] = useState<InstanceOf | null>(null);
  // Instances whose last test failed because the pinned host key no longer matches.
  const [keyChanged, setKeyChanged] = useState<(InstanceOf & { message: string })[]>([]);

  const runTest = (s: ServerDto) =>
    test.mutate(s.id, {
      onSuccess: (r) => {
        const changed = r.results.filter((x) => !x.ok && HOST_KEY_CHANGED.test(x.message));
        setKeyChanged((prev) => [
          ...prev.filter((k) => k.server.id !== s.id),
          ...changed.map((x) => ({
            server: s,
            instanceId: x.instanceId,
            where: where(x),
            message: x.message,
          })),
        ]);
        // A changed host key is shown as a warning instead; the toast lists every result if there are others.
        if (changed.length === r.results.length) return;
        notifications.show({
          color: r.ok ? 'green' : 'red',
          title: `${r.ok ? 'Connection OK' : 'Connection failed'}: ${s.name}`,
          message: (
            <Stack gap={2}>
              {r.results.map((x) => (
                <Text size="sm" key={x.instanceId}>
                  {[
                    `${x.ok ? '✓' : '✗'} ${where(x)}: ${x.message}`,
                    x.logFileFound
                      ? `Log file found${x.logFileSize != null ? ` (${formatBytes(x.logFileSize)})` : ''}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ))}
            </Stack>
          ),
        });
      },
    });

  const confirmReset = (target: InstanceOf) =>
    resetKey.mutate(
      { id: target.server.id, instanceId: target.instanceId },
      {
        onSuccess: () => {
          setResetting(null);
          setKeyChanged((prev) => prev.filter((k) => k.instanceId !== target.instanceId));
          notifications.show({
            color: 'green',
            title: `Host key reset: ${target.server.name} (${target.where})`,
            message: 'The next test or search trusts the key the instance presents.',
          });
        },
      },
    );

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Servers</Title>
        <Button onClick={() => setEditing(null)}>Add server</Button>
      </Group>

      {keyChanged.map((k) => (
        <Alert
          key={k.instanceId}
          color="red"
          variant="filled"
          title={`Host key changed: ${k.server.name} (${k.where})`}
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={() => setKeyChanged((prev) => prev.filter((x) => x.instanceId !== k.instanceId))}
          mb="md"
        >
          <Text size="sm" mb="sm">
            {k.message}
          </Text>
          <Text size="sm" mb="sm">
            Only reset it if you know the server was reinstalled or its key was rotated.
          </Text>
          <Button color="red" variant="white" size="xs" onClick={() => setResetting(k)}>
            Reset host key
          </Button>
        </Alert>
      ))}

      <Table.ScrollContainer minWidth={1300}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Host</Table.Th>
              <Table.Th>User</Table.Th>
              <Table.Th>Log path</Table.Th>
              <Table.Th>Pattern</Table.Th>
              <Table.Th>Host key</Table.Th>
              <Table.Th>Updated (server time)</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {servers.data?.map((s) => {
              const [first, ...others] = s.instances;
              return (
                <Table.Tr key={s.id}>
                  <Table.Td>{s.name}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Tooltip
                      disabled={!others.length}
                      label={
                        <Stack gap={0}>
                          {s.instances.map((i) => (
                            <span key={i.id}>
                              {where(i)} · {i.username} · {i.logPath}
                            </span>
                          ))}
                        </Stack>
                      }
                    >
                      <span>
                        {where(first)}
                        {others.length > 0 && (
                          <Text span c="dimmed" size="sm">
                            {' '}
                            +{others.length}
                          </Text>
                        )}
                      </span>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>{first.username}</Table.Td>
                  <Table.Td>
                    <Code>{first.logPath}</Code>
                  </Table.Td>
                  <Table.Td>
                    {s.logPatternKey ?? (
                      <Text span c="dimmed" size="sm" title={s.customLogRegex ?? ''}>
                        Custom regex
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Stack gap={4}>
                      {s.instances.map((i) => (
                        <Group key={i.id} gap={6} wrap="nowrap">
                          {others.length > 0 && (
                            <Text span size="xs" c="dimmed">
                              {i.host}
                            </Text>
                          )}
                          {i.hostKeyFingerprint != null ? (
                            <>
                              <Code title={i.hostKeyFingerprint}>{truncate(i.hostKeyFingerprint)}</Code>
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                color="orange"
                                aria-label={`Reset host key of ${where(i)}`}
                                onClick={() => setResetting({ server: s, instanceId: i.id, where: where(i) })}
                              >
                                Reset
                              </Button>
                            </>
                          ) : (
                            <Text span c="dimmed" size="sm">
                              Not yet trusted
                            </Text>
                          )}
                        </Group>
                      ))}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    {formatInTz(s.updatedAt, s.timezone)}{' '}
                    <Text span c="dimmed" size="xs">
                      {s.timezone}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        loading={test.isPending && test.variables === s.id}
                        onClick={() => runTest(s)}
                      >
                        Test connection
                      </Button>
                      <Button size="xs" variant="default" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button size="xs" variant="subtle" color="red" onClick={() => setDeleting(s)}>
                        Delete
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {servers.data?.length === 0 && (
        <Text c="dimmed" ta="center" py="lg">
          No servers yet.
        </Text>
      )}

      <Modal
        opened={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? `Edit ${editing.name}` : 'Add server'}
        size="xl"
      >
        {editing !== undefined && (
          <ServerForm
            key={editing?.id ?? 'new'}
            server={editing ?? undefined}
            onSaved={() => setEditing(undefined)}
            onCancel={() => setEditing(undefined)}
          />
        )}
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Delete server">
        <Text mb="md">
          Delete <b>{deleting?.name}</b>? Existing error logs keep showing its name.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
          >
            Delete
          </Button>
        </Group>
      </Modal>

      <Modal opened={resetting !== null} onClose={() => setResetting(null)} title="Reset host key">
        <Text mb="xs">
          Forget the trusted host key of <b>{resetting?.server.name}</b> ({resetting?.where})?
        </Text>
        <Text size="sm" c="dimmed" mb="md">
          The next connection test or search trusts whatever key that instance presents then.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setResetting(null)}>
            Cancel
          </Button>
          <Button
            color="orange"
            loading={resetKey.isPending}
            onClick={() => resetting && confirmReset(resetting)}
          >
            Reset host key
          </Button>
        </Group>
      </Modal>
    </>
  );
}

/** `SHA256:` + the first 12 chars of the hash; the full value is in the title. */
const truncate = (fp: string) => (fp.length > 19 ? `${fp.slice(0, 19)}…` : fp);
