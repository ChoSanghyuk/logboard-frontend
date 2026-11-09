import { useState } from 'react';
import {
  Alert,
  Button,
  type ButtonProps,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useParams } from 'react-router';
import { ApiRequestError } from '../api/client';
import { useConfirmErrorLog, useCropErrorLog, useDiscardErrorLog, useErrorLog } from '../api/errorLogs';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { CandidateSwitcher } from '../components/CandidateSwitcher';
import { LogViewer } from '../components/LogViewer';
import { ResolutionActions, ResolutionInfo } from '../components/Resolution';
import { StatusBadge } from '../components/StatusBadge';
import { expandBlockers } from '../lib/crop';
import { formatInTz } from '../lib/format';

/** A button that explains in a tooltip why it is disabled. */
function ReasonButton({
  reason,
  disabled,
  onClick,
  children,
  ...props
}: ButtonProps & { reason: string | null; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={reason} disabled={!reason}>
      {/* span: disabled buttons don't fire the mouse events the tooltip needs */}
      <span>
        <Button {...props} disabled={!!reason || disabled} onClick={onClick}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}

export function ErrorDetailPage() {
  const { id = '' } = useParams();
  const log = useErrorLog(id);
  const crop = useCropErrorLog(id);
  const confirm = useConfirmErrorLog(id);
  const discard = useDiscardErrorLog(id);
  const [discarding, setDiscarding] = useState(false);

  if (log.isPending) return <Loader />;
  if (log.isError) {
    const notFound = log.error instanceof ApiRequestError && log.error.code === 'NOT_FOUND';
    return (
      <Alert
        color={notFound ? 'yellow' : 'red'}
        title={notFound ? 'Error log not found' : 'Could not load the error log'}
      >
        {notFound ? `There is no error log ${id}.` : log.error.message}
      </Alert>
    );
  }

  const d = log.data;
  const tz = d.serverTimezone;
  const cropped = d.status === 'CROPPED';
  const busy = crop.isPending || confirm.isPending || discard.isPending;
  const blockers = expandBlockers(d.crop, d.status);
  const atLimit = cropped && d.crop.endLine - d.crop.startLine + 1 >= d.crop.maxLines;

  return (
    <Stack>
      <div>
        <Group gap="sm">
          <Title order={2} ff="monospace">
            {d.id}
          </Title>
          <Text fw={500}>{d.serverName}</Text>
          <StatusBadge status={d.status} />
        </Group>
        <Text mt={4}>
          <b>{d.exceptionClass ?? 'ERROR (no stack trace)'}</b>
          {d.exceptionMessage ? `: ${d.exceptionMessage}` : ''}
        </Text>
        <Text size="sm" c="dimmed">
          Requested {formatInTz(d.requestedTime, tz)} ({tz}) · window ± {d.windowMin} min
        </Text>
      </div>

      <ResolutionInfo log={d} tz={tz} />

      <CandidateSwitcher
        candidates={d.candidates}
        anchorLine={d.crop.anchorLine}
        timeZone={tz}
        disabled={!cropped || busy}
        onSelect={(anchorLine) => crop.mutate({ anchorLine })}
      />

      <Group gap="sm">
        <ReasonButton
          reason={blockers.before}
          variant="default"
          size="xs"
          loading={crop.isPending && crop.variables?.expandBefore != null}
          disabled={busy}
          onClick={() => crop.mutate({ expandBefore: d.crop.expandStep })}
        >
          ▲ +{d.crop.expandStep} before
        </ReasonButton>
        {atLimit && (
          <Text size="xs" c="dimmed">
            The crop is at the {d.crop.maxLines.toLocaleString('en-US')}-line limit.
          </Text>
        )}
      </Group>
      <LogViewer lines={d.crop.lines} anchorLine={d.crop.anchorLine} />
      <Group gap="sm">
        <ReasonButton
          reason={blockers.after}
          variant="default"
          size="xs"
          loading={crop.isPending && crop.variables?.expandAfter != null}
          disabled={busy}
          onClick={() => crop.mutate({ expandAfter: d.crop.expandStep })}
        >
          ▼ +{d.crop.expandStep} after
        </ReasonButton>
        <Text size="xs" c="dimmed">
          File has {d.crop.totalLines.toLocaleString('en-US')} lines
        </Text>
      </Group>

      {cropped && (
        <Group justify="space-between">
          <Button variant="default" color="red" disabled={busy} onClick={() => setDiscarding(true)}>
            Discard
          </Button>
          <Button loading={confirm.isPending} disabled={busy} onClick={() => confirm.mutate(undefined)}>
            Confirm crop ✓
          </Button>
        </Group>
      )}

      {/* CONFIRMED and later, except DISCARDED (never analyzed). */}
      {!cropped && d.status !== 'DISCARDED' && <AnalysisPanel log={d} tz={tz} />}

      <ResolutionActions log={d} />

      <Modal opened={discarding} onClose={() => setDiscarding(false)} title="Discard error log">
        <Text mb="md">
          Discard <b>{d.id}</b>? It can&apos;t be analyzed or changed afterwards.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDiscarding(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={discard.isPending}
            onClick={() => discard.mutate(undefined, { onSettled: () => setDiscarding(false) })}
          >
            Discard
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
