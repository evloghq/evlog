---
"evlog": patch
---

An `Error` inside an event field is now serialized the same way as `log.error(err)`, with `name`, `message`, `stack`, and `cause`, instead of being written as `{}`. This covers the object form of `log.info/warn/error/...({ ... })` at any depth, and `set()` plus the context argument of the level methods on a request logger.
