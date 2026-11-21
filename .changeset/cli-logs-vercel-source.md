---
"@evlog/cli": minor
"evlog": minor
---

`evlog logs --source vercel` reads the linked Vercel project's runtime logs, where evlog prints one JSON line per event, with every view and filter. It reads through the Vercel API-key connector that `logs.vercel.connector` names in `evlog.config.ts`; with none configured it fails with `cli.LOGS_VERCEL_NO_CONNECTOR` and points at `npx evlog setup vercel`. The CLI authenticates with the project's OIDC token from your `vercel login`, so no token goes in an env var, and reads are pinned to the linked project.

`npx evlog setup vercel` sets it up once: it links the project if needed, lists the team's API-key connectors and asks which one to use, or creates one under a name you give, attaches it to the project, and writes the choice to `evlog.config.ts`. An existing config only gains the setting when it names no connector, and setup prints the lines it added. Without a terminal, pass `--connector vercel/mcp`, or `--connector vercel/evlog --create` to create it; a run with neither stops and lists the team's connectors. `--json` reports the config file and what setup did to it as `config: { file, state }`.
