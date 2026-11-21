---
"@evlog/cli": minor
---

`evlog init` sets up eve agents. It detects an `eve` dependency at 1.0 or later next to an `agent/` directory, installs `evlog` and `@evlog/eve` (`@beta` from a prerelease CLI), and writes `evlog.config.ts`, `agent/extensions/evlog.ts` (`export default evlog(config)`) and the `evlogTraces()` instrumentation that `evlog setup eve` writes. A second run changes nothing: an existing `@evlog/eve` mount or `evlogTraces()` file is reported as already there, and a file of the same name that does something else is left alone with the lines to add. When `engines.node` allows a Node older than 24, `init` prints the line to add. `--framework eve` forces it.
