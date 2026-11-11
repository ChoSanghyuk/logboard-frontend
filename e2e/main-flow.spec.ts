/**
 * Main flow against the compose stack with the demo profile (nginx on 8088 → backend, demo-sshd, demo-sshd-2, demo-llm):
 *   cd .. && docker-compose --profile demo up -d --build && cd "Frontend Developer" && npm run e2e
 * add server with 2 instances → test (per instance) → search (found on instance #2) → expand → confirm → analyze →
 * dev-required → terminate → /errors filters.
 * Names carry a run suffix, so the test can be re-run against the same database.
 */
import { expect, type Page, test } from '@playwright/test';

const run = Date.now().toString(36);
const SERVER = `e2e-demo-${run}`;
const LLM = `e2e-llm-${run}`;
const PROMPT = `e2e-prompt-${run}`;

/** Mantine Select / MultiSelect: open by label, pick the option. */
async function pick(page: Page, label: string | RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('add server → search → expand → confirm → analyze → dev-required → terminate → list filters', async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // LLM settings are not part of this flow (covered by unit tests): create them through the API.
  expect(
    (
      await request.post('/api/llm-endpoints', {
        data: { name: LLM, baseUrl: 'http://demo-llm:8080', model: 'demo-model' },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await request.post('/api/prompts', {
        data: {
          name: PROMPT,
          content: 'Explain this {{exceptionClass}} on {{serverName}} ({{host}}):\n{{errorLog}}',
        },
      })
    ).status(),
  ).toBe(201);

  // ── Add server with two instances (two nodes of the demo app, each with its own login) ──
  await page.goto('/servers');
  await page.getByRole('button', { name: 'Add server' }).click();
  const form = page.getByRole('dialog', { name: 'Add server' });
  await form.getByRole('textbox', { name: /^Name/ }).fill(SERVER);
  await form.getByRole('button', { name: '+ Add instance' }).click();
  for (const [n, host, user, password] of [
    [1, 'demo-sshd', 'demo', 'demo-password'],
    [2, 'demo-sshd-2', 'demo2', 'demo2-password'],
  ] as const) {
    const inst = form.getByRole('group', { name: `Instance #${n}` });
    await inst.getByRole('textbox', { name: /^Host/ }).fill(host);
    await inst.getByRole('textbox', { name: /^SSH port/ }).fill('2222');
    await inst.getByRole('textbox', { name: /^Username/ }).fill(user);
    await inst.getByRole('textbox', { name: /^Password/ }).fill(password);
    await inst.getByRole('textbox', { name: /^Log path/ }).fill('/logs/application.log');
  }
  await form
    .getByRole('textbox', { name: /^Rotated file pattern/ })
    .fill('application-%d{yyyy-MM-dd}-%i.log.gz');
  await pick(page, /^Preset/, 'SPRING_BOOT_3');
  await form.getByRole('button', { name: 'Add server' }).click();
  await expect(form).toBeHidden();

  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: SERVER, exact: true }) });
  await expect(row.getByText('demo-sshd:2222 +1')).toBeVisible();
  await expect(row.getByText('Not yet trusted')).toHaveCount(2);
  await row.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(`Connection OK: ${SERVER}`)).toBeVisible();
  await expect(page.getByText(/^✓ demo-sshd:2222: /)).toBeVisible();
  await expect(page.getByText(/^✓ demo-sshd-2:2222: /)).toBeVisible();
  await expect(row.getByText(/^SHA256:/)).toHaveCount(2); // each instance trusted on first use

  // ── Search: both instances are read; the error (15:04:47) is only in instance #2's log ──
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Search' }).click();
  await pick(page, /^Server/, SERVER);
  const time = page.getByRole('textbox', { name: /^Error time/ });
  await time.fill('2026-11-08 15:05:00');
  await time.blur();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/errors\/\d{8}-\d{3}$/, { timeout: 30_000 });
  const id = page.url().split('/').at(-1)!;
  await expect(page.getByRole('heading', { name: id })).toBeVisible();
  await expect(page.getByText('demo-sshd-2:2222', { exact: true })).toBeVisible(); // the crop's instance
  await expect(page.getByText('java.net.SocketTimeoutException', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/could not be read/)).toBeHidden(); // no fetchFailures
  await expect(page.getByText('추출됨', { exact: true })).toBeVisible();

  // ── Expand → confirm ──
  const before = page.getByRole('button', { name: /\+50 before/ });
  await before.click();
  await expect(before).toBeDisabled(); // the demo crop reaches line 1
  await page.getByRole('button', { name: 'Confirm crop ✓' }).click();
  await expect(page.getByText('확인됨', { exact: true })).toBeVisible();

  // ── Analyze ──
  const panel = page.getByLabel('Analysis');
  await pick(page, 'LLM endpoint', LLM);
  await pick(page, 'Prompt', PROMPT);
  await panel.getByRole('button', { name: 'Send to LLM' }).click();
  await expect(panel.getByRole('heading', { name: 'Cause' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('분석됨', { exact: true })).toBeVisible();

  // ── Developer needed ──
  await page.getByRole('button', { name: 'Developer needed' }).click();
  const dev = page.getByRole('dialog', { name: `Developer needed: ${id}` });
  await dev.getByRole('textbox').fill('customer.name can be null');
  await dev.getByRole('button', { name: 'Mark as developer needed' }).click();
  await expect(page.getByText('개발자 확인 필요', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'customer.name can be null' })).toBeVisible();

  // ── Terminate ──
  await page.getByRole('button', { name: 'Terminate' }).click();
  const term = page.getByRole('dialog', { name: `Terminate ${id}` });
  await term.getByRole('textbox').fill('Validate customer.name in OrderService.place');
  await term.getByRole('button', { name: 'Terminate' }).click();
  await expect(page.getByText('종료됨', { exact: true })).toBeVisible();
  await expect(page.getByText('Resolved by user')).toBeVisible();

  // ── /errors filters ──
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Errors' }).click();
  await pick(page, /^Server/, SERVER);
  await expect(page.getByText('No error logs match the filters.')).toBeVisible(); // default: open work only
  await page.getByLabel('Clear status').click(); // any status (Mantine hides the clear button from a11y)
  const link = page.getByRole('link', { name: id });
  await expect(link).toBeVisible();
  await expect(
    page.getByRole('row').filter({ has: link }).getByText('demo-sshd-2', { exact: true }),
  ).toBeVisible();
  await pick(page, /^Status/, '종료됨');
  await expect(link).toBeVisible();
  await expect(page).toHaveURL(/status=TERMINATED/);

  const from = page.getByRole('textbox', { name: /^Requested from/ });
  await from.fill('2026-11-09');
  await from.blur();
  await expect(page.getByText('No error logs match the filters.')).toBeVisible(); // requested on 11-08 (Seoul)
  await from.fill('2026-11-08');
  await from.blur();
  await expect(link).toBeVisible();

  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).toHaveURL(/\/errors$/);
  await expect(link).toBeHidden();

  // Back to the detail from the list.
  await page.goBack();
  await link.click();
  await expect(page.getByRole('heading', { name: id })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
