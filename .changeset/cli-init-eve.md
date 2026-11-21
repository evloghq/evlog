---
"@evlog/cli": minor
---

`evlog init` sets up eve agents. It detects an `eve` dependency at 1.0 or later next to `agent/`, or `agents/<name>/agent/` in an agent workspace. It installs `evlog` and `@evlog/eve` (`@beta` from a prerelease CLI), and writes `evlog.config.ts`, an `extensions/evlog.ts` mount (`export default evlog(config)`) and the `evlogTraces()` instrumentation in each agent.

- An agent inside a Next.js, Nuxt or other supported app gets the app set up beside it from the same `evlog.config.ts`, an existing one included. The agent is its own service: its mount sets `<service>-agent`, and each member of an agent workspace its eve name. `--framework eve` or `--framework next` picks one.
- Nothing the agent has is rewritten. A mount of `@evlog/eve` under any name, as a file or a directory, counts, and the report names its logs tool. A file of the same name that does something else is left alone with the lines to add.
- The agent's `evlog__logs` tool is on and reads `.evlog/logs` locally. An interactive run asks; `--no-agent-logs` hides it.
- In a linked Vercel project, an interactive run lists the team's connectors that can read runtime logs and asks which one the deployed agent reads through, or offers to create one. The choice is written to `evlog.config.ts` and attached the way `evlog setup vercel` does. `--yes` never contacts Vercel.
- `init` prints the `engines` line when `engines.node`, `.nvmrc` or `.node-version` allows a Node older than 24, explains why an agent on eve before 1.0 is not set up, and points a web app whose `eveRoot` names another directory at it.

`evlog setup eve` writes the instrumentation into every member of an agent workspace instead of creating a root `agent/`, which eve reads as a single-agent project. Its `--json` output is now `{ agents: [{ file, state }] }`, one entry per agent.
