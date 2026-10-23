---
"evlog": major
---

`createLoggerStorage` is no longer exported from `evlog/toolkit`. Import it from `evlog/toolkit/storage`, which has exported it since 2.x. The main toolkit barrel no longer pulls in `node:async_hooks`, so framework integrations built on it stay edge-safe.

```diff
- import { createLoggerStorage, defineFrameworkIntegration } from 'evlog/toolkit'
+ import { defineFrameworkIntegration } from 'evlog/toolkit'
+ import { createLoggerStorage } from 'evlog/toolkit/storage'
```
