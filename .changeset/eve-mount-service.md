---
"@evlog/eve": patch
---

A `service` set on the mount names each turn's event when the host app, such as Next.js with `instrumentation.ts`, initialised evlog first. The turns used to carry the app's service, so the agent and the app could not be told apart. `evlog({ ...config, service: 'support-agent' })` now gives the agent its own service either way.
