import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import type { components } from '../api/schema';
import { renderWithProviders } from '../test/render';
import { LogViewer } from './LogViewer';

type CropLine = components['schemas']['CropLineDto'];

const LINES: CropLine[] = [
  { no: 1201, text: '2026-11-08 14:31:57 INFO request', kind: 'CONTEXT' },
  { no: 1202, text: '2026-11-08 14:31:58 ERROR Order failed', kind: 'ANCHOR' },
  { no: 1203, text: 'java.lang.NullPointerException: customer is null', kind: 'STACK' },
  { no: 1204, text: '\tat com.foo.Order.place(Order.java:42)', kind: 'STACK' },
  { no: 1205, text: '2026-11-08 14:31:59 INFO next', kind: 'CONTEXT' },
];
const row = (no: number) => document.querySelector<HTMLElement>(`[data-line="${no}"]`)!;

test('line numbers come from lines[].no; ANCHOR and STACK are highlighted differently, CONTEXT plain', () => {
  renderWithProviders(<LogViewer lines={LINES} anchorLine={1202} />);
  expect(row(1201)).toHaveTextContent(/^1201/);
  expect(screen.getByText('Lines 1201–1205 (5)')).toBeInTheDocument();

  expect(row(1202)).toHaveAttribute('data-kind', 'ANCHOR');
  expect(row(1202).style.background).toBe('var(--mantine-color-red-light)');
  expect(row(1203).style.background).toBe('var(--mantine-color-orange-light)');
  expect(row(1204).style.background).toBe('var(--mantine-color-orange-light)');
  expect(row(1201).style.background).toBe('');
  expect(row(1205).style.background).toBe('');
});

test('no wrapping: the crop scrolls horizontally, tabs/spaces preserved', () => {
  renderWithProviders(<LogViewer lines={LINES} anchorLine={1202} />);
  const box = screen.getByRole('region', { name: 'Log crop' });
  expect(box.style.whiteSpace).toBe('pre');
  expect(box.style.overflow).toBe('auto');
  expect(row(1204).textContent).toContain('\tat com.foo');
});

test('copy button copies the crop text (without line numbers)', async () => {
  const user = userEvent.setup();
  renderWithProviders(<LogViewer lines={LINES} anchorLine={1202} />);
  await user.click(screen.getByRole('button', { name: 'Copy crop' }));
  expect(await navigator.clipboard.readText()).toBe(LINES.map((l) => l.text).join('\n'));
});

test('scrolls the anchor line into view (a third from the top)', () => {
  const proto = HTMLElement.prototype;
  const offsetTop = Object.getOwnPropertyDescriptor(proto, 'offsetTop')!;
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;
  Object.defineProperty(proto, 'offsetTop', {
    configurable: true,
    get() {
      return (Number(this.dataset.line) - 1201) * 20;
    },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 30 });
  try {
    renderWithProviders(<LogViewer lines={LINES} anchorLine={1204} />);
    expect(screen.getByRole('region', { name: 'Log crop' }).scrollTop).toBe(60 - 10);
  } finally {
    Object.defineProperty(proto, 'offsetTop', offsetTop);
    Object.defineProperty(Element.prototype, 'clientHeight', clientHeight);
  }
});

test('render performance: 2,000 lines (maxLines) render quickly, all in the DOM', () => {
  const lines: CropLine[] = Array.from({ length: 2000 }, (_, i) => ({
    no: 10_001 + i,
    text: `2026-11-08T14:31:58.123+09:00 ${i % 40 === 0 ? 'ERROR' : 'INFO '} 4242 --- [nio-8080-exec-${i % 9}] c.f.OrderController : GET /orders/${i} 200 ${'x'.repeat(i % 120)}`,
    kind: i === 1000 ? 'ANCHOR' : i > 1000 && i < 1060 ? 'STACK' : 'CONTEXT',
  }));
  const t0 = performance.now();
  const { rerender } = renderWithProviders(<LogViewer lines={lines} anchorLine={11_001} />);
  const firstRender = performance.now() - t0;
  expect(document.querySelectorAll('[data-line]')).toHaveLength(2000);
  expect(row(11_001)).toHaveAttribute('data-kind', 'ANCHOR');

  // Typical update (e.g. a parent re-render with the same lines) is cheap thanks to memoized rows.
  const t1 = performance.now();
  rerender(<LogViewer lines={lines} anchorLine={11_001} />);
  const rerenderMs = performance.now() - t1;

  // jsdom is several times slower than a browser; these budgets are generous but catch regressions.
  expect(firstRender).toBeLessThan(1500);
  expect(rerenderMs).toBeLessThan(300);
  console.info(
    `LogViewer 2,000 lines: first render ${firstRender.toFixed(0)} ms, re-render ${rerenderMs.toFixed(0)} ms (jsdom)`,
  );
});
