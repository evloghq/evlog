---
"evlog": minor
"@evlog/cli": minor
---

`evlog` now ships the `evlog` executable: once evlog is installed, `npx evlog init`, `npx evlog map`, `npx evlog doctor` and `npx evlog agents` are available without adding anything. The executable runs `@evlog/cli` when it is installed and otherwise fetches it with the package manager that launched it (`npx`, `pnpm dlx`, `bunx`, `yarn dlx`), so `evlog` gains no dependency. Add `@evlog/cli` as a dev dependency for a pinned, instant run in CI. `@evlog/cli` now declares `evlog` as a peer dependency instead of a dependency, so a project carries one copy of the logger.
