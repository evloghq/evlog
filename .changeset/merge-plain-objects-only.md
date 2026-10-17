---
"evlog": patch
---

`log.set()` only merges plain objects. A class instance or a `Date` is now a value: the next `set()` on the same key replaces it. Before, merging into one wrote the new fields into the caller's own object, and a second `Date` on the same key was ignored. `log.set({ account })` followed by `log.set({ account: { plan: 'pro' } })` now logs `{ plan: 'pro' }` and leaves `account` untouched.
