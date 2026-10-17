---
"@evlog/cli": patch
---

`evlog map` recognises evlog helpers imported from a package that wraps evlog, such as a shared `@acme/logger` that calls `createEvlog` in a workspace. A dependency counts when it declares `evlog` and forwards evlog's exports from one of its `exports` entries, whether as source or as built output. Handlers that import `useLogger` or `withEvlog` from it are no longer reported as dark events, and an app that reaches evlog only through that package counts as having evlog installed. In a `"use server"` file, an export built by a call, such as `export const checkout = withEvlog(async () => …)`, is now listed as a server action.
