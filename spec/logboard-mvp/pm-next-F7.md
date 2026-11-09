# PM → Frontend: notes after F6 + next task F7

F6 is accepted, including one analysis at a time and the markdown sanitizing.

## Do first
1. **Regenerate the types**: run `npm run gen:api` against the current backend.
   - Drop the nullable patch in `scripts/gen-api.mjs` and the HAND-ADDED `serverTimezone` (it's required now).
   - Remove the Asia/Seoul fallback.
   - Check that `resolvedBy` is `"USER" | "AGENT" | null` and `latestAnalysis` is `AnalysisDto | null`.
   - Report any drift.
2. **`latestAnalysis`**: it's always present, as an explicit `null` when there's none. This is now a general rule for all
   nullable fields. The backend is fixing the omission; keep tolerating both until then.
3. **Analysis ids**: `AnalysisDto` gets `llmEndpointId` and `promptTemplateId` (the backend is adding them). Once they're in
   the types, switch Retry to use the ids, and only disable it if the endpoint or prompt was deleted.
4. **Bundle size**: lazy-load in F8.
5. **Dev DB leftovers** (`fe-f5-check`, `20261108-001`): leave them.

**`resolvedAt` has landed** in `/v3/api-docs` (`string | null`, date-time, UTC; set on every terminate by USER or
AGENT; null otherwise). It comes in with the regeneration, so don't hand-add it.
**Also landed**: `AnalysisDto.llmEndpointId` / `promptTemplateId` (required int64). Switch Retry to the ids now.
`latestAnalysis` is an explicit `null`. The backend never omitted it: the earlier "missing" field came from an older build
or the mock. You can drop the omitted-field tolerance, and make the mock send `null` too.
Rebuild the backend image before checking against Docker (`docker-compose up -d --build`).

## F7 — Resolution + error list (M3)
Re-read the resolution rules in "Error-log rules" in api-contract.md.
- **`ResolutionActions`** on the detail page:
  - "Terminate" opens a modal requiring a resolution. It's allowed from CONFIRMED/ANALYZED/DEV_REQUIRED.
  - "Developer needed" opens a modal requiring a note. It's only allowed from ANALYZED.
  - Show each button only in the statuses where it's allowed, with client-side not-blank validation.
  - Map `400` field errors (`fields.resolution` / `fields.note`) onto the modal. On `409`, refetch and show a message.
- **Resolved errors**: show the resolution, note, `resolvedBy` and `resolvedAt` (in the server's timezone). Mark AGENT
  resolutions clearly ("Resolved by code agent (MCP)"). Also show the dev-required note on DEV_REQUIRED logs.
- **`/errors` list**:
  - **Filters**: status (multi-select), server, and a date range on `requestedTime`. The default is everything except
    TERMINATED and DISCARDED (send the statuses explicitly).
  - **Table**: ID, server, requested time (in its `serverTimezone`), exception class/message (truncated), status badge,
    created time.
  - **Paging**: size 20, newest first.
  - Clicking a row opens the detail page. Filters and page live in the URL query, so going back restores them.
- **Verify**: tests for showing the buttons by status, modal validation and 400 mapping, the AGENT label, the default
  filter, URL-synced filters and paging. `npm run build` and `npm test` green.
- **When done**: tick F7, update `structure.md`, and reply with a summary covering what was built, the type drift found, and questions.

## Heads-up for F8 (from backend B8, done)
- Root compose: `/home/lomon/workspace/logboard/docker-compose.yml`.
  - Service `frontend` is built from `./Frontend Developer`, **host 8088 → container 80**. nginx must listen on 80 and
    proxy `/api` and `/mcp` to `backend:8080`.
  - Profile `demo` adds `demo-sshd` (2222, user `demo`/`demo-password`, sample Spring Boot 3 logs) and `demo-llm`
    (WireMock OpenAI stub, host 8089). Use them for the Playwright e2e.
  - The machine has docker-compose v1.29 and no BuildKit, so keep your Dockerfile compatible.
- New API (in api-contract.md): `POST /servers/{id}/reset-host-key` and `ServerDto.hostKeyFingerprint` (nullable).
  On the Servers page:
  - show the fingerprint, or "not yet trusted";
  - add a "Reset host key" action with a confirmation;
  - when a test result message says "Host key … changed", show a prominent warning that offers the reset.
  This can be done in F7 or F8.
- The backend flow script `Backend Developer/demo/e2e_flow.py` shows the full happy path via REST and MCP.

## Real server log naming (owner confirmed)
All real servers: `logPath=/…/application.log`, `rotatedPattern=application-%d{yyyy-MM-dd}-%i.log.gz` (same directory).
- In the Servers form, use `application-%d{yyyy-MM-dd}-%i.log.gz` as the rotated-pattern placeholder and help example,
  instead of `app.%d{yyyy-MM-dd}.%i.log.gz`.
- Explain in the help text that past files are looked for in the same folder as the log path when no folder is given.
- Use this naming in the mock fixtures and in the Playwright e2e (F8).
