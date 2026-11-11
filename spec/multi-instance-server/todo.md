# PM → Frontend: Multi-instance servers (F9)

Read first: `design.md` (§6 screens), `api-contract.md` in this folder (changes on top of `../logboard-mvp/`).
Start on MSW mocks; regenerate `schema.d.ts` once the backend B12 is up (`npm run gen:api`). Raise contract doubts with the PM.

## F9 — Multi-instance servers
- [x] `ServerForm`: shared fields (name, patterns, tz, charset) + "Instances" list (host, port=22, log path, username,
      auth type, password / private key with the "Secret stored" hint per instance), add / remove (min 1, max 20), keep
      `id` of existing instances on edit; secret required on a new instance or when its auth type changes. Server field errors `instances[N].field` → the right row (`applyApiErrors` mapping)
- [x] Servers table: host column "first host:port +N" with a tooltip listing all; host key shown per instance
- [x] Test connection: per-instance result list (✓/✗ + message); "Host key … changed" → red alert + "Reset host key" for
      that instance (`/servers/{id}/instances/{instanceId}/reset-host-key`, confirm dialog)
- [x] Error detail: header shows `instance` host:port; yellow alert listing `fetchFailures` ("Logs of {host}:{port} could not
      be read: {message}. The error may be on that node."); `CandidateSwitcher` shows the host and sends
      `{ anchorLine, instanceId }`
- [x] Search page: `404 NO_EXCEPTION_FOUND` shows the searched instances and any failures; `502` lists every failure
- [x] Error list: show instance host next to the server name
- [x] Prompt form: `{{host}}` in the placeholder help / click-to-insert
- [x] Mocks: server 1 gets 2 instances with candidates on both (anchor on instance 2); a new server with 2 instances where
      one fails → `201` with `fetchFailures`; server 3 (eu-gateway) all instances fail → `502 details.failures`;
      update fixtures to the new shapes (`instance`, `fetchFailures: []`, candidate `instanceId`)
- [x] e2e: add a server with 2 instances against the compose demo stack (`demo-sshd`, `demo-sshd-2`), search finds the
      error on instance 2
- [x] `structure.md` updated

## Verify
Tests for the instance list form (add/remove/min 1/per-instance secret rules/nested field errors), per-instance test results and reset,
fetch-failure alert, candidate switch across instances. `npm test`, `npm run lint`, `npm run build` green; e2e green in compose.
Reply with changed files and test results; update todo.md.

## Status (Frontend, 2026-11-11)
All items done. `npm test` 158/158, `npm run lint`, `npm run build` green.
- `schema.d.ts` regenerated from the B12 backend (compose, :8080): no drift.
- Mocks follow the settled details (404 `searchedInstances` = read instances only, candidate order, 502 message).
- e2e green on the rebuilt compose stack (backend + frontend rebuilt, demo-sshd-2 added; V7 applied to the existing DB,
  old error logs still open).
- Servers table: User / Log path columns show the first instance; the Host tooltip lists host:port · user · log path of all.
