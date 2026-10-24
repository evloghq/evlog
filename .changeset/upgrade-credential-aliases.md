---
"@evlog/cli": minor
---

`evlog upgrade` renames the removed credential options to `apiKey`: `token` on the Axiom drain and `sourceToken` on the Better Stack drain, in drain calls and in `evlog.axiom` of a Nuxt config. It reports an options object that sets both names, options built elsewhere, and the old `AXIOM_TOKEN`, `NUXT_AXIOM_TOKEN`, `BETTER_STACK_SOURCE_TOKEN` and `NUXT_BETTER_STACK_SOURCE_TOKEN` environment variables.
