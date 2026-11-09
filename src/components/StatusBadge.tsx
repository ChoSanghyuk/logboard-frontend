import { Badge } from '@mantine/core';
import type { components } from '../api/schema';

type ErrorStatus = components['schemas']['ErrorLogSummary']['status'];

const STATUS_META: Record<ErrorStatus, { label: string; color: string }> = {
  CROPPED: { label: 'Cropped', color: 'yellow' },
  CONFIRMED: { label: 'Confirmed', color: 'blue' },
  ANALYZED: { label: 'Analyzed', color: 'violet' },
  DEV_REQUIRED: { label: 'Dev required', color: 'orange' },
  TERMINATED: { label: 'Terminated', color: 'green' },
  DISCARDED: { label: 'Discarded', color: 'gray' },
};

export function StatusBadge({ status }: { status: ErrorStatus }) {
  const { label, color } = STATUS_META[status];
  return (
    <Badge color={color} variant="light">
      {label}
    </Badge>
  );
}
