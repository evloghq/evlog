---
'evlog': patch
---

On Hono, React Router and SvelteKit, a request that evlog does not log now gets a logger that accepts every call and emits nothing, on `c.get('log')`, `context.get(loggerContext)` and `event.locals.log`. This covers a route that `include` or `exclude` filters out, and every route after `initLogger({ enabled: false })`. Before, nothing was attached: `c.get('log').set(...)` threw a `TypeError`, the documented Hono `onError` handler threw as well so the request got no response, and `context.get(loggerContext)` threw in React Router loaders. `log.fork()` still runs its work on these requests. `useLogger()` still throws on them.
