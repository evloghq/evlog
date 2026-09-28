---
"evlog": patch
---

Serialize an `Error` in `error.cause` the same way as the top-level error, with `name`, `message`, `stack` and its metadata fields. A wrapped driver error such as the `pg` error inside a `DrizzleQueryError` no longer reaches drains as `{}`, and a cause chain that loops back emits `[Circular]`.
