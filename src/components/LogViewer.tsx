import { memo, useLayoutEffect, useRef } from 'react';
import { ActionIcon, CopyButton, Group, Paper, Text, Tooltip } from '@mantine/core';
import type { components } from '../api/schema';

type CropLine = components['schemas']['CropLineDto'];

const KIND_STYLE: Record<CropLine['kind'], React.CSSProperties> = {
  ANCHOR: {
    background: 'var(--mantine-color-red-light)',
    boxShadow: 'inset 3px 0 0 var(--mantine-color-red-filled)',
    fontWeight: 600,
  },
  STACK: { background: 'var(--mantine-color-orange-light)' },
  CONTEXT: {},
};

// Rows are plain DOM (no virtualization): 2,000 lines render fast enough and stay searchable with Ctrl+F.
const LogLine = memo(function LogLine({ line, gutter }: { line: CropLine; gutter: string }) {
  return (
    <div
      data-line={line.no}
      data-kind={line.kind}
      style={{
        ...KIND_STYLE[line.kind],
        display: 'flex',
      }}
    >
      <span
        aria-hidden
        style={{
          width: gutter,
          flex: 'none',
          paddingInline: '0.75ch',
          textAlign: 'right',
          color: 'var(--mantine-color-dimmed)',
          userSelect: 'none',
        }}
      >
        {line.no}
      </span>
      <span style={{ paddingRight: '1ch' }}>{line.text}</span>
    </div>
  );
});

/**
 * Monospace log crop: line numbers from `lines[].no`, ANCHOR/STACK highlighted, horizontal scroll (no wrap).
 * Scrolls the anchor line into view on load and whenever the anchor or the crop start changes.
 */
export function LogViewer({
  lines,
  anchorLine,
  height = '60vh',
}: {
  lines: CropLine[];
  anchorLine: number;
  height?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstNo = lines[0]?.no;
  const gutter = `${String(lines.at(-1)?.no ?? 0).length + 1.5}ch`;
  const text = lines.map((l) => l.text).join('\n');

  useLayoutEffect(() => {
    const box = scrollRef.current;
    const row = box?.querySelector<HTMLElement>(`[data-line="${anchorLine}"]`);
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 3);
  }, [anchorLine, firstNo]);

  return (
    <Paper withBorder>
      <Group
        justify="space-between"
        px="sm"
        py={4}
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        <Text size="xs" c="dimmed">
          Lines {firstNo}–{lines.at(-1)?.no} ({lines.length.toLocaleString('en-US')})
        </Text>
        <CopyButton value={text}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied' : 'Copy crop'}>
              <ActionIcon
                variant="subtle"
                color={copied ? 'teal' : 'gray'}
                onClick={copy}
                aria-label="Copy crop"
              >
                {copied ? '✓' : '⧉'}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      <div
        ref={scrollRef}
        role="region"
        aria-label="Log crop"
        tabIndex={0}
        style={{
          position: 'relative', // so rows' offsetTop is relative to this box
          maxHeight: height,
          overflow: 'auto',
          fontFamily: 'var(--mantine-font-family-monospace)',
          fontSize: 'var(--mantine-font-size-xs)',
          lineHeight: 1.45,
          whiteSpace: 'pre',
        }}
      >
        <div style={{ width: 'max-content', minWidth: '100%' }}>
          {lines.map((line) => (
            <LogLine key={line.no} line={line} gutter={gutter} />
          ))}
        </div>
      </div>
    </Paper>
  );
}
