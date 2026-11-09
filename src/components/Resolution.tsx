import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ApiRequestError } from '../api/client';
import { type ErrorLogDetail, useDevRequiredErrorLog, useTerminateErrorLog } from '../api/errorLogs';
import { formatInTz } from '../lib/format';
import { applyApiErrors } from '../lib/formErrors';

const TERMINABLE: ErrorLogDetail['status'][] = ['CONFIRMED', 'ANALYZED', 'DEV_REQUIRED'];

type Field = 'resolution' | 'note';
type Handlers = { onSuccess: () => void; onError: (error: Error) => void };

/** Modal with one required text field. 400 on `field` → shown on it; 409 → closed (the hook refetches + notifies). */
function TextModal({
  opened,
  onClose,
  title,
  field,
  label,
  submitLabel,
  pending,
  onSubmit,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  field: Field;
  label: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (text: string, handlers: Handlers) => void;
}) {
  const form = useForm({
    initialValues: { text: '' },
    validate: { text: (v) => (v.trim() ? null : 'Required') },
  });
  const close = () => {
    form.reset();
    onClose();
  };
  const submit = ({ text }: { text: string }) =>
    onSubmit(text.trim(), {
      onSuccess: close,
      onError: (error) => {
        if (!(error instanceof ApiRequestError)) return;
        if (error.code === 'VALIDATION_FAILED') {
          const rest = applyApiErrors(error, form, (f) => (f === field ? 'text' : f));
          if (rest) form.setFieldError('text', rest);
        } else if (error.code === 'INVALID_STATUS') close();
      },
    });

  return (
    <Modal opened={opened} onClose={close} title={title}>
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack>
          <Textarea
            label={label}
            withAsterisk
            autosize
            minRows={3}
            data-autofocus
            {...form.getInputProps('text')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {submitLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** "Terminate" (from CONFIRMED / ANALYZED / DEV_REQUIRED) and "Developer needed" (from ANALYZED). */
export function ResolutionActions({ log }: { log: ErrorLogDetail }) {
  const terminate = useTerminateErrorLog(log.id);
  const devRequired = useDevRequiredErrorLog(log.id);
  const [open, setOpen] = useState<Field | null>(null);
  const canTerminate = TERMINABLE.includes(log.status);
  const canDevRequire = log.status === 'ANALYZED';
  if (!canTerminate && !canDevRequire) return null;

  return (
    <>
      <Group justify="space-between">
        {canTerminate && <Button onClick={() => setOpen('resolution')}>Terminate</Button>}
        {canDevRequire && (
          <Button variant="light" color="orange" onClick={() => setOpen('note')}>
            Developer needed
          </Button>
        )}
      </Group>
      <TextModal
        opened={open === 'resolution'}
        onClose={() => setOpen(null)}
        title={`Terminate ${log.id}`}
        field="resolution"
        label="Resolution"
        submitLabel="Terminate"
        pending={terminate.isPending}
        onSubmit={(resolution, h) => terminate.mutate({ resolution }, h)}
      />
      <TextModal
        opened={open === 'note'}
        onClose={() => setOpen(null)}
        title={`Developer needed: ${log.id}`}
        field="note"
        label="Note for the developer / code agent"
        submitLabel="Mark as developer needed"
        pending={devRequired.isPending}
        onSubmit={(note, h) => devRequired.mutate({ note }, h)}
      />
    </>
  );
}

/** Dev-required note (DEV_REQUIRED) and the resolution (TERMINATED), times in the server timezone. */
export function ResolutionInfo({ log, tz }: { log: ErrorLogDetail; tz: string }) {
  if (log.status === 'DEV_REQUIRED')
    return (
      <Alert color="orange" title="Developer needed">
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {log.note}
        </Text>
      </Alert>
    );
  if (log.status !== 'TERMINATED') return null;
  const agent = log.resolvedBy === 'AGENT';
  return (
    <Paper withBorder p="md" aria-label="Resolution">
      <Stack gap="xs">
        <Group gap="xs">
          <Title order={4}>Resolved</Title>
          <Badge variant={agent ? 'filled' : 'light'} color={agent ? 'grape' : 'green'}>
            {agent ? 'Resolved by code agent (MCP)' : 'Resolved by user'}
          </Badge>
          {log.resolvedAt != null && (
            <Text size="sm" c="dimmed">
              {formatInTz(log.resolvedAt, tz)} ({tz})
            </Text>
          )}
        </Group>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {log.resolution}
        </Text>
        {log.note != null && (
          <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            Developer note: {log.note}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
