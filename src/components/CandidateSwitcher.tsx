import { Radio, Stack, Text } from '@mantine/core';
import type { components } from '../api/schema';
import { formatInTz } from '../lib/format';

type Candidate = components['schemas']['CandidateDto'];
export type CandidateRef = Pick<Candidate, 'anchorLine' | 'instanceId'>;

// Line numbers are per instance: a candidate is identified by (instanceId, anchorLine).
const keyOf = (c: CandidateRef) => `${c.instanceId}:${c.anchorLine}`;

/**
 * Exception entries found in the window, over all instances; picking one re-crops around it (on its instance).
 * Hidden when there is only one.
 */
export function CandidateSwitcher({
  candidates,
  current,
  timeZone,
  disabled,
  onSelect,
}: {
  candidates: Candidate[];
  current: CandidateRef;
  timeZone: string;
  disabled: boolean;
  onSelect: (candidate: CandidateRef) => void;
}) {
  if (candidates.length <= 1) return null;
  return (
    <Radio.Group
      label={`Candidates (${candidates.length})`}
      description="Exception entries found in the window. Pick the one to review."
      value={keyOf(current)}
      onChange={(v) => {
        const c = candidates.find((x) => keyOf(x) === v)!;
        onSelect({ anchorLine: c.anchorLine, instanceId: c.instanceId });
      }}
    >
      <Stack gap={6} mt="xs">
        {candidates.map((c) => (
          <Radio
            key={keyOf(c)}
            value={keyOf(c)}
            disabled={disabled}
            label={
              <Text size="sm" span>
                <Text span ff="monospace" size="sm">
                  {formatInTz(c.time, timeZone)}
                </Text>{' '}
                · <b>{c.exceptionClass ?? 'ERROR (no stack trace)'}</b>
                {c.message ? `: ${c.message}` : ''}
              </Text>
            }
            description={`${c.host} · line ${c.anchorLine}${keyOf(c) === keyOf(current) ? ' · current' : ''}`}
          />
        ))}
      </Stack>
    </Radio.Group>
  );
}
