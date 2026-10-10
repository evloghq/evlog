---
"evlog": minor
---

`defineEvlog()` accepts `extends`, another config to build on, such as a preset published to npm. Objects merge key by key with the config winning on each key, lists are replaced except `redact.paths`, `redact.patterns` and `sampling.keep`, which add up, `plugins` merge by `name`, and a config extends one level only. `mergeEvlogConfig()` applies the same merge outside `defineEvlog()`. `EvlogConfig` also takes `map` and `logs`, the settings `evlog map` and `evlog logs` read from `evlog.config.ts`, and `toLoggerConfig()` and `toMiddlewareOptions()` leave them out.
