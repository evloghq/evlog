---
"evlog": patch
---

`evlog/sveltekit` no longer logs a `redirect()` or `error()` thrown by a hook after `evlog()` as a 500 with `[object Object]`, and rethrows it untouched for SvelteKit to build the response, the way `evlog/next` treats `redirect()` and `notFound()`.
