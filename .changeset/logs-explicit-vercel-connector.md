---
"@evlog/cli": minor
"@evlog/eve": minor
"evlog": patch
---

Vercel runtime logs are read only through the connector `logs.vercel.connector` names; there is no default `vercel/evlog` any more. Reading local files is unchanged.

- `npx evlog setup vercel` lists the team's Vercel API-key connectors and asks which one to use, or creates one under a name you give, then writes the choice to `evlog.config.ts`. An existing config only gains the setting when it names no connector, and setup prints the lines it added. Without a terminal, pass `--connector vercel/mcp`, or `--connector vercel/evlog --create` to create it; a run with neither stops and lists the team's connectors. The `reused` field of `--json` is replaced by `config: { file, state }`.
- `evlog logs --source vercel` with no connector configured fails with `cli.LOGS_VERCEL_NO_CONNECTOR` and points at `npx evlog setup vercel`.
- The `@evlog/eve` logs tool on Vercel (`source: 'auto'` or `'vercel'`) with no connector fails every call with `Vercel logs are not set up` instead of reading through `vercel/evlog`, and the turn event records the call as failed. It does not fall back to the local files.

To keep reading through `vercel/evlog`, set it explicitly: `logs: { vercel: { connector: 'vercel/evlog' } }` in `evlog.config.ts`, passed to the evlog mount of an eve agent.
