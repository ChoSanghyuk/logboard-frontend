import { useState } from 'react';
import { Badge, Button, Group, Modal, Table, Text, Title } from '@mantine/core';
import { type PromptTemplateDto, useDeletePrompt, usePrompts } from '../api/prompts';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { PromptForm } from '../components/PromptForm';

export function PromptsPage() {
  const prompts = usePrompts();
  const remove = useDeletePrompt();
  // undefined = closed, null = adding, dto = editing
  const [editing, setEditing] = useState<PromptTemplateDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<PromptTemplateDto | null>(null);

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Prompts</Title>
        <Button onClick={() => setEditing(null)}>Add prompt</Button>
      </Group>

      <Table.ScrollContainer minWidth={700}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Content</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {prompts.data?.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <span>{p.name}</span>
                    {p.isDefault && <Badge size="sm">Default</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td maw={480}>
                  <Text size="sm" ff="monospace" c="dimmed" truncate>
                    {p.content}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button size="xs" variant="default" onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                    <Button size="xs" variant="subtle" color="red" onClick={() => setDeleting(p)}>
                      Delete
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {prompts.data?.length === 0 && (
        <Text c="dimmed" ta="center" py="lg">
          No prompt templates yet.
        </Text>
      )}

      <Modal
        opened={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? `Edit ${editing.name}` : 'Add prompt'}
        size="xl"
      >
        {editing !== undefined && (
          <PromptForm
            key={editing?.id ?? 'new'}
            prompt={editing ?? undefined}
            onSaved={() => setEditing(undefined)}
            onCancel={() => setEditing(undefined)}
          />
        )}
      </Modal>
      <ConfirmDeleteModal
        noun="prompt template"
        item={deleting}
        onClose={() => setDeleting(null)}
        mutation={remove}
      />
    </>
  );
}
