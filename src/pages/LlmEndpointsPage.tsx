import { useState } from 'react';
import { Badge, Button, Code, Group, Modal, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  type LlmEndpointDto,
  useDeleteLlmEndpoint,
  useLlmEndpoints,
  useTestLlmEndpoint,
} from '../api/llmEndpoints';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { LlmEndpointForm } from '../components/LlmEndpointForm';

export function LlmEndpointsPage() {
  const endpoints = useLlmEndpoints();
  const remove = useDeleteLlmEndpoint();
  const test = useTestLlmEndpoint();
  // undefined = closed, null = adding, dto = editing
  const [editing, setEditing] = useState<LlmEndpointDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<LlmEndpointDto | null>(null);

  const runTest = (e: LlmEndpointDto) =>
    test.mutate(e.id, {
      onSuccess: (r) =>
        notifications.show({
          color: r.ok ? 'green' : 'red',
          title: `${r.ok ? 'Test OK' : 'Test failed'}: ${e.name}`,
          message: [r.message, r.latencyMs !== undefined ? `${r.latencyMs} ms` : null]
            .filter(Boolean)
            .join(' · '),
        }),
    });

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>LLM endpoints</Title>
        <Button onClick={() => setEditing(null)}>Add endpoint</Button>
      </Group>

      <Table.ScrollContainer minWidth={800}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Base URL</Table.Th>
              <Table.Th>Model</Table.Th>
              <Table.Th>Timeout</Table.Th>
              <Table.Th>API key</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {endpoints.data?.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <span>{e.name}</span>
                    {e.isDefault && <Badge size="sm">Default</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Code>{e.baseUrl}</Code>
                </Table.Td>
                <Table.Td>{e.model}</Table.Td>
                <Table.Td>{e.timeoutSec}s</Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {e.hasSecret ? 'stored' : '—'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      size="xs"
                      variant="light"
                      loading={test.isPending && test.variables === e.id}
                      onClick={() => runTest(e)}
                    >
                      Test
                    </Button>
                    <Button size="xs" variant="default" onClick={() => setEditing(e)}>
                      Edit
                    </Button>
                    <Button size="xs" variant="subtle" color="red" onClick={() => setDeleting(e)}>
                      Delete
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {endpoints.data?.length === 0 && (
        <Text c="dimmed" ta="center" py="lg">
          No LLM endpoints yet.
        </Text>
      )}

      <Modal
        opened={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? `Edit ${editing.name}` : 'Add LLM endpoint'}
        size="lg"
      >
        {editing !== undefined && (
          <LlmEndpointForm
            key={editing?.id ?? 'new'}
            endpoint={editing ?? undefined}
            onSaved={() => setEditing(undefined)}
            onCancel={() => setEditing(undefined)}
          />
        )}
      </Modal>
      <ConfirmDeleteModal
        noun="LLM endpoint"
        item={deleting}
        onClose={() => setDeleting(null)}
        mutation={remove}
      />
    </>
  );
}
