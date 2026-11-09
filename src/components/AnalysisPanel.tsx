import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { type AnalysisDto, useAnalysis, useAnalysisHistory, useStartAnalysis } from '../api/analyses';
import { type ErrorLogDetail, errorLogKey } from '../api/errorLogs';
import { useLlmEndpoints } from '../api/llmEndpoints';
import { usePrompts } from '../api/prompts';
import { formatInTz } from '../lib/format';
import { Elapsed } from './Elapsed';
import { MarkdownReply } from './MarkdownReply';

const SENDABLE = ['CONFIRMED', 'ANALYZED'];
const STATUS_COLOR: Record<AnalysisDto['status'], string> = { PENDING: 'blue', DONE: 'green', FAILED: 'red' };

function duration(a: AnalysisDto) {
  if (!a.finishedAt) return null;
  return `${Math.max(0, Math.round((Date.parse(a.finishedAt) - Date.parse(a.createdAt)) / 1000))} s`;
}

/** One analysis: running state, reply, or failure. */
function AnalysisResult({ a, tz, timeoutSec }: { a: AnalysisDto; tz: string; timeoutSec?: number }) {
  if (a.status === 'PENDING')
    return (
      <Group gap="sm" role="status">
        <Loader size="sm" />
        <Text size="sm">
          Analyzing… <Elapsed since={a.createdAt} /> elapsed
          {timeoutSec != null && ` · times out after ${timeoutSec} s`}
        </Text>
      </Group>
    );
  if (a.status === 'FAILED')
    return (
      <Alert color="red" title="Analysis failed">
        {a.errorMessage || 'The LLM call failed.'}
      </Alert>
    );
  return (
    <Stack gap={4}>
      <MarkdownReply>{a.reply ?? ''}</MarkdownReply>
      <Text size="xs" c="dimmed">
        Finished {a.finishedAt ? formatInTz(a.finishedAt, tz) : ''} ({duration(a)})
      </Text>
    </Stack>
  );
}

/**
 * LLM analysis of a confirmed crop. Sending is allowed in CONFIRMED / ANALYZED; later statuses show history only.
 * Resumes polling a PENDING `latestAnalysis` (e.g. after a reload); on DONE/FAILED it refetches the error log.
 */
export function AnalysisPanel({ log, tz }: { log: ErrorLogDetail; tz: string }) {
  const qc = useQueryClient();
  const endpoints = useLlmEndpoints();
  const prompts = usePrompts();
  const history = useAnalysisHistory(log.id);
  const start = useStartAnalysis(log.id);
  const canSend = SENDABLE.includes(log.status);

  // Selection: null = the default (isDefault) one.
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  const defaultEndpoint = endpoints.data?.find((e) => e.isDefault);
  const defaultPrompt = prompts.data?.find((p) => p.isDefault);
  const selectedEndpoint = endpointId ?? (defaultEndpoint ? String(defaultEndpoint.id) : null);
  const selectedPrompt = promptId ?? (defaultPrompt ? String(defaultPrompt.id) : null);

  // The analysis shown on top: the one just sent, else the error log's latest (resumed if PENDING).
  const [activeId, setActiveId] = useState<number | null>(null);
  const current = useAnalysis(activeId ?? log.latestAnalysis?.id ?? null, log.latestAnalysis).data;

  // PENDING → DONE/FAILED: refetch the error log (now ANALYZED) and, nested under it, the history.
  const seenPending = useRef(new Set<number>());
  useEffect(() => {
    if (!current) return;
    if (current.status === 'PENDING') seenPending.current.add(current.id);
    else if (seenPending.current.delete(current.id)) qc.invalidateQueries({ queryKey: errorLogKey(log.id) });
  }, [current, qc, log.id]);

  const send = (llmEndpointId: number, promptTemplateId: number) =>
    start.mutate({ llmEndpointId, promptTemplateId }, { onSuccess: (a) => setActiveId(a.id) });

  const running = current?.status === 'PENDING';
  const endpointOf = (a: AnalysisDto) => endpoints.data?.find((e) => e.id === a.llmEndpointId);
  // Retry resends the failed analysis' ids; only blocked once the lists have loaded without them (deleted).
  const retryGone =
    !!current &&
    ((!!endpoints.data && !endpointOf(current)) ||
      (!!prompts.data && !prompts.data.some((p) => p.id === current.promptTemplateId)));

  return (
    <Paper withBorder p="md" aria-label="Analysis">
      <Stack>
        <Title order={4}>LLM analysis</Title>

        {canSend && (
          <>
            {endpoints.data?.length === 0 && (
              <Alert color="yellow">
                No LLM endpoint yet. Add one in{' '}
                <Anchor component={Link} to="/settings/llm">
                  Settings → LLM endpoints
                </Anchor>
                .
              </Alert>
            )}
            {prompts.data?.length === 0 && (
              <Alert color="yellow">
                No prompt yet. Add one in{' '}
                <Anchor component={Link} to="/settings/prompts">
                  Settings → Prompts
                </Anchor>
                .
              </Alert>
            )}
            <Group align="flex-end">
              <Select
                label="LLM endpoint"
                placeholder="Select an endpoint"
                data={endpoints.data?.map((e) => ({ value: String(e.id), label: e.name })) ?? []}
                value={selectedEndpoint}
                onChange={setEndpointId}
                allowDeselect={false}
              />
              <Select
                label="Prompt"
                placeholder="Select a prompt"
                data={prompts.data?.map((p) => ({ value: String(p.id), label: p.name })) ?? []}
                value={selectedPrompt}
                onChange={setPromptId}
                allowDeselect={false}
              />
              <Button
                loading={start.isPending}
                disabled={!selectedEndpoint || !selectedPrompt || running}
                onClick={() => send(Number(selectedEndpoint), Number(selectedPrompt))}
              >
                {current ? 'Analyze again' : 'Send to LLM'}
              </Button>
            </Group>
          </>
        )}

        {current && (
          <Stack gap="xs">
            <Group gap="xs">
              <Text size="sm" fw={500}>
                {current.llmEndpointName} · {current.promptTemplateName}
              </Text>
              <Badge size="sm" variant="light" color={STATUS_COLOR[current.status]}>
                {current.status}
              </Badge>
            </Group>
            <AnalysisResult a={current} tz={tz} timeoutSec={endpointOf(current)?.timeoutSec} />
            {current.status === 'FAILED' && canSend && (
              <Group>
                <Button
                  variant="light"
                  loading={start.isPending}
                  disabled={retryGone}
                  onClick={() => send(current.llmEndpointId, current.promptTemplateId)}
                >
                  Retry
                </Button>
                {retryGone && (
                  <Text size="xs" c="dimmed">
                    The endpoint or prompt no longer exists; pick another above.
                  </Text>
                )}
              </Group>
            )}
          </Stack>
        )}
        {!current && !canSend && (
          <Text size="sm" c="dimmed">
            No analysis was run for this error log.
          </Text>
        )}

        {!!history.data?.length && (
          <div>
            <Text size="sm" fw={500} mb={4}>
              History ({history.data.length})
            </Text>
            <Accordion multiple variant="separated" chevronPosition="left">
              {history.data.map((a) => (
                <Accordion.Item key={a.id} value={String(a.id)}>
                  <Accordion.Control>
                    <Group gap="xs" wrap="nowrap">
                      <Badge size="sm" variant="light" color={STATUS_COLOR[a.status]}>
                        {a.status}
                      </Badge>
                      <Text size="sm">
                        {a.llmEndpointName} · {a.promptTemplateName}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formatInTz(a.createdAt, tz)}
                        {duration(a) && ` · ${duration(a)}`}
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <AnalysisResult a={a} tz={tz} />
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          </div>
        )}
      </Stack>
    </Paper>
  );
}
