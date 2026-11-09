import { useState } from 'react';
import { Alert, Button, Code, Group, Modal, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { type ServerDto, useDeleteServer, useResetHostKey, useServers, useTestServer } from '../api/servers';
import { ServerForm } from '../components/ServerForm';
import { formatBytes, formatInTz } from '../lib/format';

export function ServersPage() {
  const servers = useServers();
  const remove = useDeleteServer();
  const test = useTestServer();
  const resetKey = useResetHostKey();
  // undefined = closed, null = adding, ServerDto = editing
  const [editing, setEditing] = useState<ServerDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ServerDto | null>(null);
  const [resetting, setResetting] = useState<ServerDto | null>(null);
  // Last test that failed because the pinned host key no longer matches.
  const [keyChanged, setKeyChanged] = useState<{ server: ServerDto; message: string } | null>(null);

  const runTest = (s: ServerDto) =>
    test.mutate(s.id, {
      onSuccess: (r) => {
        if (!r.ok && /Host key .* changed/.test(r.message)) {
          setKeyChanged({ server: s, message: r.message });
          return;
        }
        if (keyChanged?.server.id === s.id) setKeyChanged(null);
        notifications.show({
          color: r.ok ? 'green' : 'red',
          title: `${r.ok ? 'Connection OK' : 'Connection failed'}: ${s.name}`,
          message: [
            r.message,
            r.logFileFound
              ? `Log file found${r.logFileSize != null ? ` (${formatBytes(r.logFileSize)})` : ''}`
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
        });
      },
    });

  const confirmReset = (s: ServerDto) =>
    resetKey.mutate(s.id, {
      onSuccess: () => {
        setResetting(null);
        if (keyChanged?.server.id === s.id) setKeyChanged(null);
        notifications.show({
          color: 'green',
          title: `Host key reset: ${s.name}`,
          message: 'The next test or search trusts the key the server presents.',
        });
      },
    });

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Servers</Title>
        <Button onClick={() => setEditing(null)}>Add server</Button>
      </Group>

      {keyChanged && (
        <Alert
          color="red"
          variant="filled"
          title={`Host key changed: ${keyChanged.server.name}`}
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={() => setKeyChanged(null)}
          mb="md"
        >
          <Text size="sm" mb="sm">
            {keyChanged.message}
          </Text>
          <Text size="sm" mb="sm">
            Only reset it if you know the server was reinstalled or its key was rotated.
          </Text>
          <Button color="red" variant="white" size="xs" onClick={() => setResetting(keyChanged.server)}>
            Reset host key
          </Button>
        </Alert>
      )}

      <Table.ScrollContainer minWidth={1100}>
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
            {servers.data?.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{s.name}</Table.Td>
                <Table.Td>
                  {s.host}:{s.sshPort}
                </Table.Td>
                <Table.Td>{s.username}</Table.Td>
                <Table.Td>
                  <Code>{s.logPath}</Code>
                </Table.Td>
                <Table.Td>
                  {s.logPatternKey ?? (
                    <Text span c="dimmed" size="sm" title={s.customLogRegex ?? ''}>
                      Custom regex
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {s.hostKeyFingerprint != null ? (
                    <Code title={s.hostKeyFingerprint}>{truncate(s.hostKeyFingerprint)}</Code>
                  ) : (
                    <Text span c="dimmed" size="sm">
                      Not yet trusted
                    </Text>
                  )}
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
                    {s.hostKeyFingerprint != null && (
                      <Button size="xs" variant="subtle" color="orange" onClick={() => setResetting(s)}>
                        Reset host key
                      </Button>
                    )}
                    <Button size="xs" variant="subtle" color="red" onClick={() => setDeleting(s)}>
                      Delete
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
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
        size="lg"
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
          Forget the trusted host key of <b>{resetting?.name}</b>?
        </Text>
        <Text size="sm" c="dimmed" mb="md">
          The next connection test or search trusts whatever key the server presents then.
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
