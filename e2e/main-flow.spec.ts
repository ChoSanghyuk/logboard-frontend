/**
 * Main flow against the compose stack with the demo profile (nginx on 8088 → backend, demo-sshd, demo-llm):
 *   cd .. && docker-compose --profile demo up -d --build && cd "Frontend Developer" && npm run e2e
 * add server → test → search → expand → confirm → analyze → dev-required → terminate → /errors filters.
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
        data: { name: PROMPT, content: 'Explain this {{exceptionClass}} on {{serverName}}:\n{{errorLog}}' },
      })
    ).status(),
  ).toBe(201);

  // ── Add server ──
  await page.goto('/servers');
  await page.getByRole('button', { name: 'Add server' }).click();
  const form = page.getByRole('dialog', { name: 'Add server' });
  await form.getByRole('textbox', { name: /^Name/ }).fill(SERVER);
  await form.getByRole('textbox', { name: /^Host/ }).fill('demo-sshd');
  await form.getByRole('textbox', { name: /^SSH port/ }).fill('2222');
  await form.getByRole('textbox', { name: /^Username/ }).fill('demo');
  await form.getByRole('textbox', { name: /^Password/ }).fill('demo-password');
  await form.getByRole('textbox', { name: /^Log path/ }).fill('/logs/application.log');
  await form
    .getByRole('textbox', { name: /^Rotated file pattern/ })
    .fill('application-%d{yyyy-MM-dd}-%i.log.gz');
  await pick(page, /^Preset/, 'SPRING_BOOT_3');
  await form.getByRole('button', { name: 'Add server' }).click();
  await expect(form).toBeHidden();

  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: SERVER, exact: true }) });
  await expect(row.getByText('Not yet trusted')).toBeVisible();
  await row.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(`Connection OK: ${SERVER}`)).toBeVisible();
  await expect(row.getByText(/^SHA256:/)).toBeVisible(); // trusted on first use

  // ── Search ──
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Search' }).click();
  await pick(page, /^Server/, SERVER);
  const time = page.getByRole('textbox', { name: /^Error time/ });
  await time.fill('2026-11-08 14:32:00');
  await time.blur();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/errors\/\d{8}-\d{3}$/, { timeout: 30_000 });
  const id = page.url().split('/').at(-1)!;
  await expect(page.getByRole('heading', { name: id })).toBeVisible();
  await expect(page.getByText('java.lang.NullPointerException', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Cropped', { exact: true })).toBeVisible();

  // ── Expand → confirm ──
  const before = page.getByRole('button', { name: /\+50 before/ });
  await before.click();
  await expect(before).toBeDisabled(); // the demo crop reaches line 1
  await page.getByRole('button', { name: 'Confirm crop ✓' }).click();
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

  // ── Analyze ──
  const panel = page.getByLabel('Analysis');
  await pick(page, 'LLM endpoint', LLM);
  await pick(page, 'Prompt', PROMPT);
  await panel.getByRole('button', { name: 'Send to LLM' }).click();
  await expect(panel.getByRole('heading', { name: 'Cause' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Analyzed', { exact: true })).toBeVisible();

  // ── Developer needed ──
  await page.getByRole('button', { name: 'Developer needed' }).click();
  const dev = page.getByRole('dialog', { name: `Developer needed: ${id}` });
  await dev.getByRole('textbox').fill('customer.name can be null');
  await dev.getByRole('button', { name: 'Mark as developer needed' }).click();
  await expect(page.getByText('Dev required', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'customer.name can be null' })).toBeVisible();

  // ── Terminate ──
  await page.getByRole('button', { name: 'Terminate' }).click();
  const term = page.getByRole('dialog', { name: `Terminate ${id}` });
  await term.getByRole('textbox').fill('Validate customer.name in OrderService.place');
  await term.getByRole('button', { name: 'Terminate' }).click();
  await expect(page.getByText('Terminated', { exact: true })).toBeVisible();
  await expect(page.getByText('Resolved by user')).toBeVisible();

  // ── /errors filters ──
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Errors' }).click();
  await pick(page, /^Server/, SERVER);
  await expect(page.getByText('No error logs match the filters.')).toBeVisible(); // default: open work only
  await page.getByLabel('Clear status').click(); // any status (Mantine hides the clear button from a11y)
  const link = page.getByRole('link', { name: id });
  await expect(link).toBeVisible();
  await pick(page, /^Status/, 'Terminated');
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
