---
"@evlog/cli": minor
"evlog": minor
---

`evlog logs --source vercel` reads the linked Vercel project's runtime logs, where evlog prints one JSON line per event, with every view and filter. `npx evlog setup vercel` sets it up once: it links the project if needed, reuses a Vercel API-key connector the team already has or creates `vercel/evlog`, and attaches it to the project. The CLI authenticates with the project's OIDC token from your `vercel login`, so no token goes in an env var, and reads are pinned to the linked project. `logs.vercel.connector` in `evlog.config.ts` names the connector to read through.
