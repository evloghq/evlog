---
"evlog": patch
---

Request loggers created by the framework integrations no longer register each emitted event in a global `WeakMap` to track the late `log.set({ ai })` window, and `finish` only copies the context for tail sampling when a `keep` hook or plugin is set. Behavior is unchanged; building a request's wide event costs about a third less CPU.
