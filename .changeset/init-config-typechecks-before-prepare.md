---
"@evlog/cli": patch
---

`evlog init` now writes `evlog.config.ts` with `process.env.NODE_ENV` in place of `import.meta.dev` for Nuxt, Nitro and TanStack Start, the same condition Next, Hono, Express and Fastify already used. The generated file no longer reports `Property 'dev' does not exist on type 'ImportMeta'` in a fresh Nuxt project before `nuxi prepare` has run. The production drain is still selected in a Nuxt production build, because Nitro inlines `NODE_ENV` there. Existing `evlog.config.ts` files are not rewritten; change the condition by hand to pick this up.
