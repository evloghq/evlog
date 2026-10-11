---
'evlog': patch
---

Stop the Nuxt client transport endpoint from emitting a request wide event for every batch of client logs. A successful `POST /api/_evlog/ingest` (204) no longer adds a server event next to each `source: "client"` event, in drains or on the console. Failed transport requests (4xx and 5xx) still emit, so a broken transport stays visible. A custom `transport.endpoint` is honoured, and an explicit `exclude` pattern still excludes the route.
