---
"@evlog/cli": minor
---

A global `evlog` now hands off to the `@evlog/cli` installed in the project it runs in, so a project always runs the CLI version it pins. In a directory with no install, the global copy runs as before.
