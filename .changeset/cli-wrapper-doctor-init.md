---
"@evlog/cli": patch
---

`evlog doctor` and `evlog init` now recognise an app that reaches evlog only through a wrapper package, such as a shared `@acme/logger` that calls `createEvlog`, the same way `evlog map` already does. `doctor` reports evlog as reached through that package (for example "evlog via `@acme/logger`") instead of "not found in this project", drops the `pnpm add evlog` hint, and no longer warns that the framework still needs evlog. `init` stops in that case and says evlog is already wired through the wrapper, rather than offering to install evlog and scaffold a second setup next to it. `doctor --json` reports the same result.
