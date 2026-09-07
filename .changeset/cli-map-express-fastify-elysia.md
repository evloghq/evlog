---
"@evlog/cli": minor
---

`evlog map` now scans Express, Fastify, and Elysia apps: it detects the framework from `package.json`, finds literal route registrations, and scores entry-point coverage the same way as Nuxt, Nitro, Next.js, TanStack Start, and Hono.

Override detection with `--framework express`, `--framework fastify`, or `--framework elysia` when needed.
