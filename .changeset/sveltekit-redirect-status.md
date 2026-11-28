---
"evlog": patch
---

`evlog/sveltekit` now logs a `redirect()` or 4xx `error()` thrown by a hook after `evlog()` with its own status (303, 403, ...) and no error, instead of as a 500 with `[object Object]`, and still rethrows it for SvelteKit to build the response.
