# Logboard Frontend — Structure

React 19 · Vite 8 · TypeScript 5.9 · Mantine 9 (+ @mantine/form) · react-markdown + rehype-highlight · TanStack Query 5 · React Router 8 · openapi-fetch · MSW 3 · Vitest · Playwright.
Specs: `spec/logboard-mvp/` (todo.md, design.md §9, api-contract.md).

## Run

```bash
npm run dev:mock   # MSW mocks (loads .env.mock → VITE_USE_MOCKS=true), no backend needed
npm run dev        # real API: Vite proxies /api → http://localhost:8080
npm run gen:api    # regenerate src/api/schema.d.ts from the running backend's /v3/api-docs (scripts/gen-api.mjs)
npm run build | npm test | npm run lint | npm run format
npm run e2e        # Playwright (e2e/main-flow.spec.ts) against http://localhost:8088 (E2E_BASE_URL), needs the
                   # compose stack: cd .. && docker-compose --profile demo up -d --build
```

Production: `Dockerfile` (node build → nginx:alpine, classic builder, no BuildKit) + `nginx.conf` (port 80, SPA fallback,
`/api` and `/mcp` → `backend:8080`; `/mcp` unbuffered with a 1h read timeout). Root compose maps 8088 → 80.
docker-compose 1.29 on Docker ≥ 25 crashes when *recreating* a container (`KeyError: 'ContainerConfig'`):
`docker-compose rm -sf frontend` first, then `up -d --build`.
`public/mockServiceWorker.js` is dropped from non-mock builds (vite.config.ts), and MSW is only loaded when `VITE_USE_MOCKS=true`.

TypeScript is pinned to 5.9: typescript-eslint and openapi-typescript don't support TS 7 yet. `strict` is on.
No local JDK? Run the backend in `eclipse-temurin:21-jdk` (Docker, `--network host`) against the dev Postgres.

## Layout

```
src/
 ├─ main.tsx          starts MSW if VITE_USE_MOCKS=true, then renders providers + router
 ├─ AppProviders.tsx  MantineProvider(theme) + Notifications + QueryClientProvider, Mantine CSS
 ├─ theme.ts          Mantine theme
 ├─ routes.tsx        route table under AppLayout: / → /search, /errors, /errors/:id, /servers,
 │                    /settings → /settings/llm, /settings/prompts; * → not found. Pages are lazy (route `lazy`,
 │                    one chunk each); the layout shows a loader until the first page chunk loads
 ├─ api/
 │   ├─ schema.d.ts   GENERATED from /v3/api-docs (do not edit, no hand patches; paths include /api)
 │   ├─ client.ts     `api` (openapi-fetch), `unwrap()`, `ApiRequestError {status, code, details}`
 │   ├─ servers.ts    query/mutation hooks: useServers, useLogPatterns, useSaveServer, useDeleteServer, useTestServer, useResetHostKey
 │   │                (test + reset refetch the list: a first successful test pins the host key)
 │   ├─ llmEndpoints.ts / prompts.ts  same pattern (list, save, delete; useTestLlmEndpoint)
 │   ├─ analyses.ts   useAnalysis (polls every 2s while PENDING), useAnalysisHistory, useStartAnalysis
 │   ├─ errorLogs.ts  useSearchErrorLog (NO_EXCEPTION_FOUND / FETCH_FAILED inline); useErrorLog(id); useErrorLogs(query)
 │   │                (paged list, keeps previous page); useCrop/Confirm/Discard/Terminate/DevRequiredErrorLog:
 │   │                response → setQueryData; 409 INVALID_STATUS → message + refetch; terminate / dev-required
 │   │                leave 400 VALIDATION_FAILED to the modal form
 │   └─ queryClient.ts createQueryClient(): global error → Mantine notification
 ├─ mocks/
 │   ├─ fixtures.ts   seed data (servers, patterns, LLM, prompts, error logs + raw log: 20261108-001 CROPPED (most
 │   │                tests), 20261107-002 DEV_REQUIRED, 20261107-001 TERMINATED by AGENT (eu-gateway),
 │   │                20261106-002 TERMINATED by USER, 20261106-001 DISCARDED)
 │   ├─ handlers.ts   all contract endpoints over an in-memory db; resetDb()
 │   └─ browser.ts / server.ts  MSW worker (dev) / node server (tests)
 ├─ test/             setup.ts (jsdom shims, MSW, cleanup), render.tsx (renderWithProviders, renderApp → {…, router}),
 │                    captureBodies.ts (collect request bodies)
 ├─ components/
 │   ├─ AppLayout.tsx   AppShell: header + nav (Search · Errors · Servers · Settings ▸ LLM, Prompts), <Outlet/>
 │   ├─ AnalysisPanel.tsx  endpoint/prompt (defaults preselected) → send; current analysis (resumes a PENDING
 │   │                  latestAnalysis; DONE/FAILED → refetch error log); retry; collapsed history
 │   ├─ CandidateSwitcher.tsx  radio list of candidates (time in server tz, class, message); hidden if ≤ 1
 │   ├─ ConfirmDeleteModal.tsx  delete confirm; 409 IN_USE shown inline, other errors notified
 │   ├─ MarkdownReply.tsx  reply as markdown + highlight.js + copy; raw HTML never rendered
 │   ├─ LlmEndpointForm.tsx / PromptForm.tsx  settings forms (apiKey hint + "Remove stored key" → clearApiKey;
 │   │                  {{errorLog}} check + click-to-insert)
 │   ├─ LogViewer.tsx   crop viewer: plain DOM rows (no virtualization; ~185 ms for 2,000 lines in a prod
 │   │                  build), ANCHOR/STACK highlight, no wrap, copy, scrolls the anchor into view
 │   ├─ Resolution.tsx  ResolutionActions: Terminate (CONFIRMED/ANALYZED/DEV_REQUIRED) / Developer needed (ANALYZED)
 │   │                  → modal with a required text (400 field → modal, 409 → close + refetch);
 │   │                  ResolutionInfo: dev-required note; resolution, note, resolvedBy (AGENT = "code agent (MCP)"), resolvedAt
 │   ├─ ServerForm.tsx  add/edit form: client rules (secret, pattern, regex groups) + server field-error mapping
 │   └─ StatusBadge.tsx ErrorStatus → label + color (CROPPED yellow, CONFIRMED blue, ANALYZED violet,
 │                      DEV_REQUIRED orange, TERMINATED green, DISCARDED gray)
 ├─ pages/            one component per route. Servers / LlmEndpoints / Prompts = table + form modal +
 │                    delete confirm (+ test → notification). Servers also: host key column (fingerprint or "Not
                    yet trusted"), "Reset host key" + confirm; a test message matching /Host key .* changed/ shows a
                    red alert with the reset instead of the toast. SearchPage = server/time (default today 00:00:00)/window form →
 │                    /errors/:id. ErrorDetailPage = header, candidates, expand buttons (disabled reason in
 │                    a tooltip), LogViewer, confirm/discard; AnalysisPanel from CONFIRMED on; ResolutionInfo/Actions.
 │                    ErrorListPage = filters (status multi, server, requestedTime days in the server's tz, else the
 │                    browser's) + table + paging (20); state in the URL: ?status=A&status=B&server=&from=&to=&page=
 │                    (1-based); no `status` = all but TERMINATED/DISCARDED (sent explicitly), `status=` = any;
                    "Reset filters" clears the query
 ├─ lib/              crop.ts (expandBlockers: why expand is disabled; cropText)
 │                    formErrors.ts (applyApiErrors: API errors → form fields)
 │                    format.ts (formatInTz, formatBytes)
 │                    timezone.ts (zonedWallTimeToIso: wall time in server tz → ISO with DST-correct
 │                    offset, null in a DST gap; offsetLabel)
 │                    logPattern.ts (missingGroups: ts/level, rotatedPatternError: %d once; form + mock)
e2e/main-flow.spec.ts  add server → test (TOFU) → search → expand → confirm → analyze → dev-required → terminate →
                       /errors filters; LLM endpoint + prompt created via API; fails on any console error
public/mockServiceWorker.js   generated by `msw init`
```

## Conventions

- API calls: `unwrap(api.GET('/api/servers'))` inside `queryFn`/`mutationFn`. Use only `paths` /
  `components['schemas'][...]` from schema.d.ts so regenerating it is a drop-in. Enums are inline
  (e.g. `ErrorLogSummary['status']`). Response nullable fields are required `field: T | null` (backend B9): the
  mock must send them as `null`, never omit them.
- Timestamps: UTC, fractions of any length (`…58.1Z`, `…13.10093Z`) — parse with `new Date()` / `formatInTz`.
- Query params: openapi-fetch encodes `+` as `%2B` and arrays as `?status=A&status=B` (tested).
- Errors: any failed query/mutation shows `ApiError.message` as a red notification. Use
  `meta: { silentError: true }` to show it inline instead (e.g. NO_EXCEPTION_FOUND). 4xx are not retried.
- Form errors: save mutations use `silentError`; `onError` calls `applyApiErrors(error, form)` →
  `VALIDATION_FAILED` fields on inputs (unknown → returned for an inline alert), `DUPLICATE_NAME` on `details.field`,
  anything else → notification. Write-only secrets: blank = omitted (kept); hint "Secret stored" when `hasSecret`.
- Lists refetch after save (`isDefault` on one clears the others server-side).
- Times: API returns UTC; display with `formatInTz(iso, server.timezone)`. User input is a wall time
  (`YYYY-MM-DD HH:mm:ss`) in the server's timezone; send `zonedWallTimeToIso(wall, server.timezone)`.
- Mock rules: search by server 1 → `201` (after 1.5s), server 2 → `404 NO_EXCEPTION_FOUND`, server 3
  (`eu-gateway`, Europe/Berlin) → `502 FETCH_FAILED`. Like the backend: `errorTime` without offset →
  `400 BAD_REQUEST`, `windowMin` ∉ 1–1440 / list `size` ∉ 1–100 → `400 VALIDATION_FAILED`, unknown or
  soft-deleted server → `404 NOT_FOUND`. PATCH crop: empty body / non-candidate anchor → 400; crop has
  `expandStep` 50, `maxLines` 2000 (clamped). Illegal transition → `409 INVALID_STATUS {status, action}`.
  Server 2 connection test fails. Server 3 test → "Host key … changed" until reset; a successful test pins
  `SHA256:mockPinned{id}` when none is stored; changing host/port forgets the fingerprint.
  Deleting a server referenced by error logs soft-deletes it (hidden from list, name kept on logs).
  LLM endpoint 1 / prompt 1 are referenced by analyses → DELETE `409 IN_USE`. LLM endpoint 2 test → `ok:false`.
  Names are unique per resource → `409 DUPLICATE_NAME`.
  Analyses: PENDING → DONE on the 2nd `GET /analyses/{id}` (→ log ANALYZED if allowed); LLM endpoint 2 → FAILED.
  Terminate / dev-required: blank → 400 on `fields.resolution` / `fields.note` (checked before status, like the
  backend), values trimmed, terminate sets `resolvedBy: USER` + `resolvedAt`. List sorted `createdAt` desc.
- Tests: polling uses `vi.useFakeTimers({ shouldAdvanceTime: true })` + `vi.advanceTimersByTimeAsync`.
  Mantine Select is role `combobox`; its options need `findByRole('option', { name, hidden: true })` in jsdom. MSW fails any unmocked request. Override per test with `server.use(...)`; db and notifications reset after each test.
