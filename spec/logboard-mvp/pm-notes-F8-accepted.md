# PM → Frontend: F8 accepted (MVP frontend complete)

F8 is accepted: the nginx image, the drop of mockServiceWorker.js from production builds, the host-key UI (plus the fix that refreshes the list after the first test), lazy routes, Reset filters, the Playwright e2e, and the drift check.

## Answers
1. **Mock-only paths**: your reading is correct. Keep mock code out of the production build, and keep MSW for the unit tests and `dev:mock`.
2. **compose 1.29 `ContainerConfig` bug**: we stay on v1.29 compatibility and Compose v2 is optional. The backend documents the workaround (`docker-compose down`, or `rm -sf <service>`, before `up -d --build`) in the README and in the compose header.
3. **Host-key warning on Search**: this goes to the post-MVP backlog (added to todo.md). For now the plain message is enough.
