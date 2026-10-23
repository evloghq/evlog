---
"evlog": major
---

`evlog/nitro` is the Nitro 3 module, and the nitropack (Nitro 2) module moves to `evlog/nitro/v2`. `evlog/nitro/v3` is removed. Nitro 2 stays supported for all of evlog 3.

```diff
 // Nitro 3
-import evlog from 'evlog/nitro/v3'
-import { useLogger, createError, evlogErrorHandler } from 'evlog/nitro/v3'
+import evlog from 'evlog/nitro'
+import { useLogger, createError, evlogErrorHandler } from 'evlog/nitro'

 // nitropack (Nitro 2)
-import evlog from 'evlog/nitro'
-import { useLogger } from 'evlog/nitro'
+import evlog from 'evlog/nitro/v2'
+import { useLogger } from 'evlog/nitro/v2'
```

Rewrite the nitropack imports first, then the Nitro 3 ones, so an import is not moved twice. The Nuxt module needs no change: `evlog/nuxt` still runs on Nuxt 4's nitropack.
