---
'evlog': patch
---

Fix every route returning 500 with `Cannot find package 'evlog'` in a Next.js app built with Turbopack and deployed without `node_modules` (Vercel, `output: 'standalone'`) when root `instrumentation.ts` uses `defineNodeInstrumentation({ ... })`. The gate loaded `evlog/next/instrumentation/create` through a computed `import()` that the build left out of the output file trace. It now imports the module behind `process.env.NEXT_RUNTIME === 'nodejs'`, so Next.js bundles it into the Node.js build and drops it from the Edge build. With webpack, the module used to load unbundled from `node_modules`, where `NEXT_RUNTIME` is unset, so `captureOutput` never applied. It applies now.
