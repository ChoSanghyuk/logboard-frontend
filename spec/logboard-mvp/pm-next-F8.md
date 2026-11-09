# PM → Frontend: notes after F7 + next task F8

F7 is accepted, including the Retry by ids, the explicit nulls in the mock, and validating the body before the status.

## Answers
1. **Date-range timezone**: accepted as built. Use the selected server's timezone, or the browser's when no server is
   selected, and label the inputs.
2. **Clearing all statuses**: accepted as "any status". Also add a small "Reset filters" action that restores the
   default four open statuses.
3. **Type drift**: it's handed to the backend as B9. Response nullable fields will become required + nullable, and the
   `latestAnalysis` description will be fixed. Regenerate types after B9 lands; until then, `field?: T | null` is fine.

## F8 — Quality & delivery (M4)
- **Production Dockerfile**: build → nginx. Must work with docker-compose v1.29 and without BuildKit.
  - nginx listens on 80, serves the SPA fallback, and proxies `/api` and `/mcp` to `backend:8080`. Streaming on `/mcp`
    needs `proxy_buffering off` and a long read timeout.
  - Root compose maps host 8088 → 80. `docker-compose up -d --build` must then succeed for the whole stack.
- **Remove mock-only paths** and regenerate types from the real backend (after B9 if it has landed). Report any drift.
- **Host-key UI** (carried over):
  - Show the fingerprint, or "not yet trusted".
  - Add a "Reset host key" action with a confirmation.
  - Show a prominent warning that offers the reset when the test message says "Host key … changed".
- **Lazy-load routes** to bring down the bundle size.
- **Playwright e2e** against compose with the `demo` profile (demo-sshd on 2222, demo-llm on 8089):
  - Flow: add server (`application.log` + `application-%d{yyyy-MM-dd}-%i.log.gz`) → search → expand → confirm →
    analyze → dev-required.
  - Then terminate, and check the `/errors` list filters.
  - `Backend Developer/demo/e2e_flow.py` shows the same flow via REST and MCP.
- **Verify**: e2e green in compose. `npm run build`, `npm test` and lint green. No console errors.
- **When done**: tick F8, update `structure.md`, and reply with a summary covering what was built, the drift found, and questions.
