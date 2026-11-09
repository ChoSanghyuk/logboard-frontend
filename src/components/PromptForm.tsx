import { useRef, useState } from 'react';
import { Alert, Button, Group, Stack, Switch, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { type PromptTemplateDto, useSavePrompt } from '../api/prompts';
import { applyApiErrors } from '../lib/formErrors';

const REQUIRED_PLACEHOLDER = '{{errorLog}}';
const PLACEHOLDERS = [
  { token: REQUIRED_PLACEHOLDER, help: 'The cropped log lines (required)' },
  { token: '{{serverName}}', help: 'Server name' },
  { token: '{{errorTime}}', help: 'Requested error time' },
  { token: '{{exceptionClass}}', help: 'Exception class of the selected entry' },
];

type Values = { name: string; content: string; isDefault: boolean };

/** Add (no `prompt`) or edit a prompt template. */
export function PromptForm({
  prompt,
  onSaved,
  onCancel,
}: {
  prompt?: PromptTemplateDto;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useSavePrompt();
  const [formError, setFormError] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const form = useForm<Values>({
    initialValues: {
      name: prompt?.name ?? '',
      content: prompt?.content ?? '',
      isDefault: prompt?.isDefault ?? false,
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Required'),
      content: (v) => (v.includes(REQUIRED_PLACEHOLDER) ? null : `Must contain ${REQUIRED_PLACEHOLDER}`),
    },
  });

  /** Inserts `token` at the cursor (or replaces the selection) and keeps the cursor after it. */
  const insert = (token: string) => {
    const el = contentRef.current;
    const value = form.values.content;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    form.setFieldValue('content', value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSubmit = (values: Values) => {
    setFormError(null);
    save.mutate(
      {
        id: prompt?.id,
        body: { name: values.name.trim(), content: values.content, isDefault: values.isDefault },
      },
      { onSuccess: onSaved, onError: (error) => setFormError(applyApiErrors(error, form)) },
    );
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
      <Stack>
        {formError && (
          <Alert color="red" title="Could not save" style={{ whiteSpace: 'pre-line' }}>
            {formError}
          </Alert>
        )}
        <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Placeholders{' '}
            <Text span size="xs" c="dimmed">
              (click to insert at the cursor)
            </Text>
          </Text>
          <Group gap="xs">
            {PLACEHOLDERS.map(({ token, help }) => (
              <Tooltip key={token} label={help}>
                <Button
                  size="compact-xs"
                  variant={token === REQUIRED_PLACEHOLDER ? 'light' : 'default'}
                  ff="monospace"
                  onClick={() => insert(token)}
                >
                  {token}
                </Button>
              </Tooltip>
            ))}
          </Group>
        </Stack>
        <Textarea
          label="Content"
          withAsterisk
          description={`${REQUIRED_PLACEHOLDER} is required; it is replaced with the cropped log.`}
          ref={contentRef}
          autosize
          minRows={14}
          maxRows={30}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          {...form.getInputProps('content')}
        />
        <Switch
          label="Default prompt"
          description="Preselected for analyses. Replaces the current default."
          {...form.getInputProps('isDefault', { type: 'checkbox' })}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {prompt ? 'Save' : 'Add prompt'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
