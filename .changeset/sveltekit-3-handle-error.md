---
"evlog": patch
---

`createEvlogHooks().handleError` and `evlogHandleError()` now accept SvelteKit 3's `handleError` input (`kind`, `error`, `event`) and type-check as Kit 3's `HandleServerError`. On SvelteKit 3, errors that are not an `EvlogError` keep Kit's own status and message instead of being overwritten with `undefined`, which made production responses return HTTP 200. The hook no longer reads Kit 3's deprecated `status` and `message` input properties, so dev mode stops logging deprecation warnings. SvelteKit 2 behavior is unchanged.
