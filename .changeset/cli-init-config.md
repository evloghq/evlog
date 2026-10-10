---
"@evlog/cli": minor
---

`evlog init` writes `evlog.config.ts` with the service name, drains, enrichers and sampling you pick, dev and production branched in one place. Nuxt and Nitro load it through the module, and on Next.js, Hono, Express and Fastify the generated `evlog.ts` imports it. In a workspace with a root `evlog.config.ts`, the app config extends it and leaves out what the root already sets. A config you already have is read and never rewritten: a setting it lacks becomes a manual step.
