import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { type LlmEndpointDto, type LlmEndpointUpsert, useSaveLlmEndpoint } from '../api/llmEndpoints';
import { applyApiErrors } from '../lib/formErrors';

type Values = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Only offered when a key is stored. */
  clearApiKey: boolean;
  timeoutSec: number | string;
  isDefault: boolean;
};

const required = (v: string) => (v.trim() ? null : 'Required');

function toUpsert(v: Values): LlmEndpointUpsert {
  return {
    name: v.name.trim(),
    baseUrl: v.baseUrl.trim(),
    model: v.model.trim(),
    // Blank apiKey is omitted: on update the backend keeps the stored one. Never sent with clearApiKey.
    ...(v.clearApiKey ? { clearApiKey: true } : v.apiKey ? { apiKey: v.apiKey } : {}),
    timeoutSec: Number(v.timeoutSec),
    isDefault: v.isDefault,
  };
}

/** Add (no `endpoint`) or edit an OpenAI-compatible LLM endpoint. */
export function LlmEndpointForm({
  endpoint,
  onSaved,
  onCancel,
}: {
  endpoint?: LlmEndpointDto;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useSaveLlmEndpoint();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    initialValues: {
      name: endpoint?.name ?? '',
      baseUrl: endpoint?.baseUrl ?? '',
      model: endpoint?.model ?? '',
      apiKey: '',
      clearApiKey: false,
      timeoutSec: endpoint?.timeoutSec ?? 120,
      isDefault: endpoint?.isDefault ?? false,
    },
    validate: {
      name: required,
      model: required,
      baseUrl: (v) => (/^https?:\/\/\S+$/.test(v.trim()) ? null : 'Enter an http(s) URL'),
      timeoutSec: (v) =>
        Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 3600 ? null : '1–3600 seconds',
    },
  });

  const handleSubmit = (values: Values) => {
    setFormError(null);
    save.mutate(
      { id: endpoint?.id, body: toUpsert(values) },
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
        <TextInput
          label="Base URL"
          withAsterisk
          placeholder="http://llm.internal:8000"
          description="OpenAI-compatible; requests go to {baseUrl}/v1/chat/completions."
          {...form.getInputProps('baseUrl')}
        />
        <TextInput
          label="Model"
          withAsterisk
          placeholder="qwen2.5-coder-32b"
          {...form.getInputProps('model')}
        />
        <PasswordInput
          label="API key"
          autoComplete="new-password"
          disabled={form.values.clearApiKey}
          description={
            form.values.clearApiKey
              ? 'The stored key will be removed on save.'
              : endpoint?.hasSecret
                ? 'Secret stored — leave blank to keep it.'
                : 'Optional. Leave blank if none is needed.'
          }
          {...form.getInputProps('apiKey')}
        />
        {endpoint?.hasSecret && (
          <Checkbox
            label="Remove stored key"
            {...form.getInputProps('clearApiKey', { type: 'checkbox' })}
            onChange={(e) => {
              form.setFieldValue('clearApiKey', e.currentTarget.checked);
              if (e.currentTarget.checked) form.setFieldValue('apiKey', '');
            }}
          />
        )}
        <NumberInput
          label="Timeout (seconds)"
          min={1}
          max={3600}
          allowDecimal={false}
          {...form.getInputProps('timeoutSec')}
        />
        <Switch
          label="Default endpoint"
          description="Preselected for analyses. Replaces the current default."
          {...form.getInputProps('isDefault', { type: 'checkbox' })}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {endpoint ? 'Save' : 'Add endpoint'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
