# Surface: docs page

`apps/docs/content/`. Docus + MDC. Read `apps/docs/AGENTS.md` before changing anything under `apps/docs/`, prose included: its MDC rules govern the content files, not only the components.

## What the reader owes you: nothing

They arrived from search or from a link inside another page, mid-task, with one question. They will read the first two sentences, scan the headings, look at a code block, and either paste it or leave.

## Anatomy

```
frontmatter        title, description, navigation.icon, links[]
opening            2-4 sentences: the situation, then what this page gives them
callout (optional) the exception a portion of readers hit immediately
prompt (optional)  the agent-runnable version of this page's task
sections           each one a heading that names what the reader achieves
next               a link out, on the thing they will need after this
```

- `title` is what appears in the sidebar. Short, no marketing.
- `description` is the answer in one sentence. It is the search snippet and the LLM summary. See D-02.
- `links:` in frontmatter are the two or three lateral pages, with `color: neutral` and `variant: subtle` to match the rest of the site.

## Which section directory

| Directory | The reader is | Page owes them |
| --- | --- | --- |
| `1.start/` | deciding whether to adopt | the cost and the payoff, honestly |
| `2.learn/` | learning a concept | the wrong shape, then the right one |
| `3.cli/` | running a command | flags, exit codes, what CI does with it |
| `4.integrate/` | wiring their stack | the exact install and the framework-native accessor |
| `5.use-cases/` | recognizing their problem | a concrete scenario end to end |
| `6.libraries/` | shipping evlog inside a reusable package | the contract, attribution, catalogs |
| `7.extend/` | building on the primitives | the contract and its guarantees |
| `8.reference/` | checking a fact | tables, defaults, no persuasion |

A page in the wrong directory is a structural finding, not a wording one.

## Integration pages carry the contract of their tier

The contract follows how the integration is built, so check the tier before flagging a page as incomplete:

- First-class integrations built on `defineFrameworkIntegration` (elysia, express, fastify, hono, next, nestjs, orpc, react-router, sveltekit, workers) take the full `BaseEvlogOptions` surface and expose a request-bound logger, but the entry point's own accessor names differ: `evlog()` and `withEvlog()` on orpc, `evlog()` on elysia, express, fastify, hono, react-router and sveltekit, `createEvlog()` and `evlogMiddleware()` on next, `EvlogModule` on nestjs, `withEvlog()` and `createWorkersLogger()` on workers. A framework page that documents only the framework-native accessor is incomplete, and one that documents only `useLogger()` misses the idiomatic path.
- `log.fork()` is wired where the request scope is `AsyncLocalStorage`-backed: every first-class integration except workers, which must stay free of `node:async_hooks`.
- Nuxt and Nitro are event-bound: `useLogger(event)`, and no `log.fork()`. Documenting `log.fork()` there claims an API that does not exist.
- Astro, AWS Lambda and standalone are guide-level on the core API (`initLogger`, `createLogger`, `createRequestLogger`): no `evlog()`, no `useLogger()`, no `log.fork()`. Do not add them to these pages.
- `evlog/workers` delivers the logger as the handler's fourth argument, not through `useLogger()`.

## Code blocks

- Label the file: ` ```typescript [server/api/checkout.post.ts] `
- `::code-group` when the same task differs by framework or runtime.
- Imports are exact and public: `evlog`, `evlog/toolkit`, `evlog/http`. Never `evlog/shared`, never `evlog/browser`.
- The sample runs. If you cannot verify it, verify it against `packages/evlog/src` or `examples/` before shipping the page.

## Animated components

`EnricherChain`, `DrainFanOut`, `StreamBus` and friends follow the strict rules in `apps/docs/AGENTS.md`: fixed outer size, every slot pre-allocated, `useTimedSequence`, reduced-motion honored. A content pass never adds one and never edits one; that is a component change with its own review.
