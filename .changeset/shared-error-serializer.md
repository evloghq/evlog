---
"evlog": patch
---

In the browser, errors are serialized the way the server logger does it: an h3 or Nuxt error that wraps another is logged once instead of repeating its message and stack, and the options object `createError()` keeps as `cause` is dropped. With `pretty: true`, DevTools now receives the logged Error itself, with its stack. On the server, `why`, `fix` and `link` are logged on any error, not only on `EvlogError`.
