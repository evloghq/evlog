---
"evlog": major
---

Remove the deprecated credential aliases. The Axiom and Better Stack drains, and the Nuxt module, read the API key from `apiKey` only.

| Removed | Use |
| --- | --- |
| Axiom `token` option | `apiKey` |
| `AXIOM_TOKEN` / `NUXT_AXIOM_TOKEN` | `AXIOM_API_KEY` / `NUXT_AXIOM_API_KEY` |
| Better Stack `sourceToken` option | `apiKey` |
| `BETTER_STACK_SOURCE_TOKEN` / `NUXT_BETTER_STACK_SOURCE_TOKEN` | `BETTER_STACK_API_KEY` / `NUXT_BETTER_STACK_API_KEY` |
| Nuxt `evlog.axiom.token` | `evlog.axiom.apiKey` |

A project that still sets only the old name gets the drain's "Missing apiKey" error and sends nothing.

`applyDeprecatedAlias` is no longer exported from `evlog/toolkit`.
