import { Radio, Stack, Text } from '@mantine/core';
import type { components } from '../api/schema';
import { formatInTz } from '../lib/format';

type Candidate = components['schemas']['CandidateDto'];

/** Exception entries found in the window; picking one re-crops around it. Hidden when there is only one. */
export function CandidateSwitcher({
  candidates,
  anchorLine,
  timeZone,
  disabled,
  onSelect,
}: {
  candidates: Candidate[];
  anchorLine: number;
  timeZone: string;
  disabled: boolean;
  onSelect: (anchorLine: number) => void;
}) {
  if (candidates.length <= 1) return null;
  return (
    <Radio.Group
      label={`Candidates (${candidates.length})`}
      description="Exception entries found in the window. Pick the one to review."
      value={String(anchorLine)}
      onChange={(v) => onSelect(Number(v))}
    >
      <Stack gap={6} mt="xs">
        {candidates.map((c) => (
          <Radio
            key={c.anchorLine}
            value={String(c.anchorLine)}
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
            description={`line ${c.anchorLine}${c.anchorLine === anchorLine ? ' · current' : ''}`}
          />
        ))}
      </Stack>
    </Radio.Group>
  );
}
