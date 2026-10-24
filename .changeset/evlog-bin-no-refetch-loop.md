---
"evlog": patch
---

`pnpm dlx evlog <command>` and `pnpm dlx @evlog/cli <command>` work on pnpm 11 instead of hanging. pnpm 11 links packages from its global store, so the `evlog` bin in a dlx install could not find the `@evlog/cli` installed next to it and fetched it again, forever. The bin now also looks for `@evlog/cli` from the `node_modules/.bin` folder that launched it. If a fetch it started still lands back on it, it exits with status 1 and suggests `npx --yes @evlog/cli <command>` instead of fetching a third time.
