---
"@evlog/cli": patch
---

On Nuxt 5 and Nitro v3 targets, `evlog init` now generates server plugins with `import { definePlugin } from 'nitro'` instead of relying on the auto-imported `defineNitroPlugin`, which no longer exists there and crashed generated apps with `ReferenceError: defineNitroPlugin is not defined`. Nuxt 4 and Nitro v2 keep the previous form.