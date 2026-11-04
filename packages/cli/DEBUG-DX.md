# CLI debug DX — frictions & wishlist

Notes from wiring `--debug` on `@evlog/cli` (dogfooding `evlog` + the error catalog). Keep this file for maintainers; not user-facing docs.

## Command author contract

`defineEvlogCommand` injects **`{ args, cli, log, ui }`** plus shared flags (`json`, `debug`, `noHeader`).

| Object | Role | API |
| --- | --- | --- |
| `cli` | Inputs (cwd, env, color, …) | read-only context |
| `log` | Debug / diagnostics | `step`, `finding`, `set`, `raw` |
| `ui` | Terminal output + exit | `human`, `json`, `exit`, `done` |

```ts
export default defineEvlogCommand('audit', {
  meta: { description: '…' },
  args: { since: { type: 'string' } },
  async run({ args, cli, log, ui }) {
    const data = await log.step('load', () => load(cli.cwd))
    if (!data) {
      log.finding(cliErrors.EVLOG_DECLARED_NOT_INSTALLED, { id: 'evlog' })
      ui.done({ human: 'No evlog.', summary: { ok: 0, warn: 1, fail: 0 } })
      return
    }
    // unexpected throw inside step → steps trail + cli.COMMAND_FAILED when --debug
    ui.done({
      jsonMode: args.json,
      json: { data },
      human: format(data),
      summary: { ok: 1, warn: 0, fail: 0 },
    })
  },
})
```

Rules:

1. **Filet** (header, debug event, catch throw) = zero lines in the command  
2. **Récit** = `log.step` / `log.finding(cliErrors.X)` only where useful  
3. **Pixels / JSON / exit** = `ui.*` only — never touch `process.stdout` / `exitCode` in commands  

## Target flow

```bash
evlog <cmd> --debug                 # compact case-file report on stderr
evlog <cmd> --json --debug 2>e.json # stdout = contract, stderr = raw wide event
```

## What works today

- `defineEvlogCommand` → `{ cli, log, ui }` + `COMMON_ARGS`
- `log.step('name', fn)` / `log.finding(cliErrors.X, { id, status })`
- `ui.done({ human, json, summary, jsonMode })`
- Human `--debug` → `formatDebugReport`; `--json --debug` → raw event on stderr
- `environment` on `--json` / debug / telemetry: packaged install → `production`, workspace → `development` (`EVLOG_CLI_ENV` / `VERCEL_ENV` override)

## Friction / wishlist

- Soft findings still mapped in doctor via `findingsForChecks` — ideal: checks carry a catalog ref
- `DefinedError.toFinding()` on evlog catalog would remove `toCliFinding` glue
- Pretty → stderr / isolated logger still useful upstream in `evlog`
- Live breadcrumbs (`--debug -v`) for long commands later

## Publish note — `workspace:*` deps

`package.json` keeps `"evlog": "workspace:*"` and `"@evlog/telemetry": "workspace:*"` for local linking. **The release packs each package with `pnpm pack`, which rewrites `workspace:` to real semver** on the tarball it stages.

Doctor resolves the install via `require.resolve('evlog/package.json')` — that subpath is exported on `evlog` (`"./package.json": "./package.json"`).
