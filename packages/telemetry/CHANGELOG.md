# @evlog/telemetry

## 0.3.4

### Patch Changes

- [#782](https://github.com/evloghq/evlog/pull/782) [`302fd0e`](https://github.com/evloghq/evlog/commit/302fd0ea8726e19dfb9ac6e7fb8f09d926878aba) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `createGitHubActionsTelemetry()` to expose `set()`, `flush()`, and a live `enabled` getter alongside `run()`.

## 0.3.3

### Patch Changes

- [#765](https://github.com/evloghq/evlog/pull/765) [`c7f1356`](https://github.com/evloghq/evlog/commit/c7f135629c8dfa6ab0190508d1f25175541d8623) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `withTelemetry` now reads a command's `args` when the command runs, so a command whose `args` are declared lazily (`args: async () => …`) still has its defaulted flags filtered out of the telemetry event.

## 0.3.2

### Patch Changes

- [#754](https://github.com/evloghq/evlog/pull/754) [`aebed60`](https://github.com/evloghq/evlog/commit/aebed601afce00aeeb4250cf1b075d4504067f5d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog` now loads only the command it runs, so `evlog doctor` and `evlog telemetry` no longer load the source parser that `evlog map` and `evlog init` use. `withTelemetry` in `@evlog/telemetry` accepts lazy citty subcommands (`() => import('./cmd').then(m => m.default)`) and wraps them when citty resolves them, without loading the other commands.

## 0.3.1

### Patch Changes

- [#649](https://github.com/evloghq/evlog/pull/649) [`0417784`](https://github.com/evloghq/evlog/commit/0417784dc9e6d3825c10b5d715ff2cb1e7e3acdd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Point the package metadata (`repository`, `bugs`) and README links at the repository's new home, `evloghq/evlog`.

## 0.3.0

### Minor Changes

- [`7b2f9ec`](https://github.com/HugoRCD/evlog/commit/7b2f9ecf57b89c9b7992278cdd5ac386f51ccf18) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Report the flags the user actually passed, instead of the parser's view of them.

  Three kinds of parser noise are dropped before an event is built, so `flags` answers "what did they type?" rather than "what did citty fill in?":
  - **Positionals** — citty's `_` bucket holds argument values, not flag names, and it was being reported as `_: true` on every run that took an argument
  - **Defaults** — a flag still sitting at its declared `default` is not a choice anyone made. `withTelemetry()` now reads the command's `args` to recognise them, so `my-tool build` sends `{}` where it used to send every defaulted switch. Negation still reports: `--no-write` against `write: { default: true }` records `write: false`
  - **Kebab-case duplicates** — `--min-score` arrives from the parser as both `minScore` and `min-score`. Only the camelCase name is kept, and that is the name `collect.flags` allowlists

  A string flag whose value is not allowlisted now records the exported `FLAG_VALUE_SET` sentinel (`"<set>"`) rather than `true`. `--baseline main` and a genuine boolean switch are different facts about a run, and reporting both as `true` made a value-carrying option indistinguishable from a switch once the runs were aggregated. The value itself is still never sent.

  `TelemetryHandle.run()` takes an optional `args` alongside `flags` for tools that call it directly; `withTelemetry()` passes it for you.

## 0.2.0

### Minor Changes

- [#446](https://github.com/HugoRCD/evlog/pull/446) [`c58ded1`](https://github.com/HugoRCD/evlog/commit/c58ded1f45bfb9b7117489667048f7eee1e83406) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Collect `env.os` (operating system platform) and `env.arch` (CPU architecture) on every run event. Both fields are nullable and the ingest validator accepts events from older clients that omit them, so no action is required — update `@evlog/telemetry` on your ingest endpoint to store the new fields.

## 0.1.2

### Patch Changes

- [#444](https://github.com/HugoRCD/evlog/pull/444) [`73a4d3c`](https://github.com/HugoRCD/evlog/commit/73a4d3c25bbcf528b92e928c9925a48147e87954) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix the outbox getting permanently stuck when the ingest endpoint rejects a batch with a 4xx response (oversized batch, unknown tool, schema drift on older buffered events, etc.). Previously, any non-2xx response kept the batch buffered forever, and since the whole outbox is resent together on every run, one bad batch silently blocked all future telemetry for the tool. Batches rejected with 400/401/403/404 (anything but 429, which is treated as transient) are now dropped instead of retried indefinitely.

## 0.1.1

### Patch Changes

- [#431](https://github.com/HugoRCD/evlog/pull/431) [`0b90010`](https://github.com/HugoRCD/evlog/commit/0b90010a614ae4e03ec823592ff3a5eec592dc66) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Introduce the evlog CLI (`@evlog/cli`, binary `evlog`). First release ships `evlog doctor` — diagnoses your setup (Node version, evlog install, local `.evlog/logs` sink) with a branded terminal report or `--json` output — plus `evlog telemetry status|enable|disable`. Opt into debug with `--debug` / `EVLOG_CLI_DEBUG=1`. Commands use `defineEvlogCommand` → `{ cli, log, ui }`: `log.step` / `log.finding(cliErrors.X)` for diagnostics, `ui.done` for human/json/exit. Compact case-file on stderr; raw event with `--json --debug`. Workspace detection covers pnpm, bun (`bun.lock` / `bun.lockb`), npm, and yarn.

  `--json`, `--debug`, and telemetry all include an `environment` stage (`development` | `preview` | `production`). Packaged installs (`npx` / `node_modules`) report `production`; workspace builds report `development`. Override with `EVLOG_CLI_ENV` / `EVLOG_TELEMETRY_ENV`, or inherit `VERCEL_ENV`.

  `withTelemetry()` is now generic over citty `ArgsDef`, so root commands with typed flags (e.g. `--debug`) type-check cleanly. `evlog telemetry status` (and any tool using `defineTelemetryCommands`) prints the local data directory path. Telemetry `env.environment` is part of the standard envelope; authors may pass `environment` in `TelemetryOptions`.

## 0.1.0

### Minor Changes

- [#417](https://github.com/HugoRCD/evlog/pull/417) [`0a66edf`](https://github.com/HugoRCD/evlog/commit/0a66edf3d67ac4e52050eeacea201e119d530465) Thanks [@HugoRCD](https://github.com/HugoRCD)! - # @evlog/telemetry

  Initial release of `@evlog/telemetry` — evlog's wide-event model for CLIs and automation. One structured event per command via citty `withTelemetry` or `createTelemetry()`, privacy-safe flag capture, disk-buffered outbox, auto-generated disclosure, GitHub Actions helper, and `@evlog/telemetry/ingest` with `parseIngestBody()` for server endpoints. Opt-out via `DO_NOT_TRACK`, `EVLOG_TELEMETRY=0`, or persisted preference.
