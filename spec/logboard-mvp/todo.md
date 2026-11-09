# Frontend Roadmap & TODO — Logboard MVP

Read first: `design.md` (§9 screens), `api-contract.md` (same folder).
Stack: TypeScript · React 19 · Vite · Mantine (+ @mantine/dates, @mantine/notifications) ·
TanStack Query · React Router · openapi-typescript + openapi-fetch · react-markdown +
rehype-highlight · MSW · Vitest + Testing Library · Playwright.

## Folder layout (proposal)
```
src/
 ├─ api/          generated schema.d.ts, client.ts (openapi-fetch), query hooks per resource
 ├─ mocks/        MSW handlers + fixtures (mirror api-contract.md)
 ├─ pages/        SearchPage, ErrorListPage, ErrorDetailPage, ServersPage,
 │                LlmEndpointsPage, PromptsPage
 ├─ components/   LogViewer, CandidateSwitcher, AnalysisPanel, ResolutionActions,
 │                ServerForm, StatusBadge, AppLayout
 └─ lib/          date/format helpers
```

## Milestones (aligned with backend)
| M | Deliverable | Depends on |
|---|-------------|------------|
| M1 | Setup, layout, Servers + Settings pages (on MSW) | — |
| M2 | Search + Error detail with crop/expand/confirm | BE M2 for real API |
| M3 | Analysis panel + resolution + error list | BE M3 |
| M4 | Switch fully to real API, e2e, Docker/nginx | BE M4 |

Development may start right away against **MSW mocks written from api-contract.md**. Switch each
area to the real API when the backend milestone lands. Regenerate types from `/v3/api-docs`.

## TODO

### F0 — Project setup (M1)
- [x] Vite React-TS, ESLint + Prettier, Mantine provider + theme, React Router, TanStack Query
- [x] `npm run gen:api` → `openapi-typescript http://localhost:8080/v3/api-docs -o src/api/schema.d.ts`
      (until the backend is up, hand-write types matching the contract)
- [x] MSW enabled when `VITE_USE_MOCKS=true`. Vite dev proxy `/api` → `localhost:8080`
- [x] Shared API error handling: show `ApiError.message` as a notification
- [x] `structure.md` created
- Verify: `npm run build`, `npm test` green.

### F1 — Layout (M1)
- [x] AppLayout with nav: Search · Errors · Servers · Settings (LLM endpoints, Prompts)
- [x] `StatusBadge` with a color per status (CROPPED, CONFIRMED, ANALYZED, DEV_REQUIRED, TERMINATED, DISCARDED)

### F2 — Servers page (M1)
- [x] Table (name, host:port, user, logPath, pattern). Add/Edit modal (`ServerForm`), delete with confirm
- [x] Auth type toggle: password field / private key textarea. On edit, a blank secret keeps the stored one
      (show "secret stored" hint when `hasSecret`)
- [x] Log pattern select from `/log-patterns` (show example line) or custom regex
- [x] "Test connection" button → shows ok / message / file size
- Verify: component tests for form validation and secret-handling behavior.

### F3 — Settings pages (M1)
- [x] LLM endpoints CRUD + "Test" button + default toggle
- [x] Prompt templates CRUD with a large textarea, placeholder help (`{{errorLog}}` required — validate
      client-side as well), default toggle

### F4 — Search page (M2)
- [x] Server select, date-time picker (seconds precision, server timezone shown), window select (±1/2/5/10/30 min)
- [x] Submit → loading state (fetch may take several seconds) → navigate to `/errors/:id`
- [x] `NO_EXCEPTION_FOUND` → inline message with a hint to widen the window. `FETCH_FAILED` → show message

### F5 — Error detail: crop review (M2)
- [x] Header: ID, server, status, exception class/message, requested time
- [x] `LogViewer`: monospace, line numbers, highlight ANCHOR/STACK lines, horizontal scroll, copy button.
      Must stay smooth for ~2,000 lines (virtualize if needed)
- [x] "+50 before" / "+50 after" buttons → `PATCH crop`. Only enabled in CROPPED. Disabled at file bounds
      (`startLine==1`, `endLine==totalLines`)
- [x] `CandidateSwitcher` when `candidates.length > 1` → `PATCH crop {anchorLine}`
- [x] Confirm / Discard buttons
- Verify: tests for expand-button enablement and highlighting by `kind`.

### F6 — Analysis panel (M3) — shown when status ≥ CONFIRMED
- [x] Select LLM endpoint + prompt (preselect defaults) → "Send to LLM"
- [x] Poll `GET /analyses/{id}` every 2s while PENDING (TanStack `refetchInterval`). Show elapsed time
- [x] Render reply as markdown with code highlighting. FAILED → error + retry
- [x] Analysis history (collapsed list) and allow re-analysis with another prompt/endpoint

### F7 — Resolution + error list (M3)
- [x] `ResolutionActions`: "Terminate" (modal, resolution required), "Developer needed" (modal, note required)
- [x] Show resolution / note / resolvedBy (USER vs AGENT) on terminated errors
- [x] `/errors` list: filters status/server/date range, paging, row → detail. Default filter: not TERMINATED/DISCARDED

### F8 — Quality & delivery (M4)
- [x] Remove mock-only paths, regenerate types from real backend, fix drift
- [x] Playwright e2e for the main flow: add server → search → expand → confirm → analyze → dev-required
      (run against docker compose)
- [x] Production Dockerfile: build → nginx. `nginx.conf` serves SPA fallback, proxies `/api` and `/mcp` to backend
- [x] (pm-next-F8.md) Host-key UI (fingerprint / "Not yet trusted", reset with confirm, "Host key … changed" warning),
      lazy-loaded routes, `/errors` "Reset filters"
- Verify: e2e green in compose.

### Post-MVP backlog
- [ ] Search page: on a "Host key … changed" FETCH_FAILED, show the same warning + "Reset host key" action as the Servers page

## Definition of Done (per task)
Types come from the contract/OpenAPI. Tests are green. No console errors. `structure.md` is updated if the structure changed.
