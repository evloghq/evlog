---
"evlog": minor
---

The Nuxt and Nitro modules (v2 and v3) load `evlog.config.ts` (or `.mts`, `.js`, `.mjs`), the nearest one from the app up to the workspace root, and bundle it into the server. Options passed to the module, or set under the `evlog` key in `nuxt.config.ts`, override the file with the same merge as `extends`. The `drain`, `enrich` and `keep` of the file run next to the `evlog:drain`, `evlog:enrich` and `evlog:emit:keep` hooks, and a drain built with `createDrainPipeline()` is flushed when the server closes. On Nuxt the file applies to the server only, and the browser logger keeps reading the `evlog` key. `defineEvlogHook()` from `evlog/eve` takes the settings of `evlog.config.ts`, so an Eve agent spreads its config into the hook: `defineEvlogHook({ ...config, message: 'preview' })`. Its logger settings start the logger on the first turn, and `init` still replaces them when given.
