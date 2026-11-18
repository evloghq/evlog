---
"evlog": major
---

A second `log.error()` on the same request or job logger now replaces the first error instead of merging into it. Before, the event took the second error's `message` and `code` but kept fields only the first had, such as its `fix` or `cause`, so it described neither error. Fields you set on `error` yourself with `log.set()`, or through the `error()` context argument, are kept.

To keep both failures, record the earlier one under its own key: `log.set({ receipt: { error } })`.
