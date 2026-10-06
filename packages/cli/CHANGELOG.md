# @evlog/cli

## 0.9.0

### Minor Changes

- [#773](https://github.com/evloghq/evlog/pull/773) [`a053adb`](https://github.com/evloghq/evlog/commit/a053adb9ec5813626c73c98274ae7188d18f62e5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog map --json` now carries `grade` next to `map` and `summary`, the same word the report prints, so a consumer no longer recomputes it from the score. `--baseline-label <text>` names the baseline in the report and the `--format github` annotations when the map was copied to a temp file, so CI can say `regressed against main` instead of printing a path.

- [#774](https://github.com/evloghq/evlog/pull/774) [`5ca8bd4`](https://github.com/evloghq/evlog/commit/5ca8bd4fbe481acaf05dd226e5cfc44618dd50c9) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog logs` reads the wide events the fs drain wrote to `.evlog/logs`: the last 50 (`evlog logs`), the failures (`evlog logs errors`), the slowest (`evlog logs slow --over 1s`), one request in full by id (`evlog logs <requestId>`, a UUID prefix is enough), or the shape of the traffic (`evlog logs stats`: per route, status class and level). Filters compose with every view: `--since 15m`, `--until`, `--level error,fatal`, `--path`, `--status 5xx`, `--where payment.amount>5000` on any field of the event (`=`, `!=`, `>`, `>=`, `<`, `<=`, `~regex`, present, `!absent`, repeatable), `--limit`, `--dir`. `-f` follows new events like `tail -f`; `--json` returns the events as JSON. It finds the project's log directory the way `doctor` does, reads every app of a workspace when the root has none, reads the memory drain's dev endpoint with `--url` (a follow there survives the app restarting, and says so when the endpoint stays quiet), handles both the compact and the pretty layout, and never writes.

### Patch Changes

- Updated dependencies [[`302fd0e`](https://github.com/evloghq/evlog/commit/302fd0ea8726e19dfb9ac6e7fb8f09d926878aba)]:
  - @evlog/telemetry@0.3.4

## 0.8.0

### Minor Changes

- [#766](https://github.com/evloghq/evlog/pull/766) [`53e3837`](https://github.com/evloghq/evlog/commit/53e38371d31ce73125f2fb647810719b7a512554) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog map` and `evlog init` now support Express and Fastify. `map` finds `app.get('/path', …)` and `router.*` registrations (Fastify's `app.route({ method, url })` too), credits handlers that use `req.log` / `request.log`, and treats the per-request event as ambient once `app.use(evlog())` or `app.register(evlog)` is found. `init` writes `src/evlog.ts` with `initLogger` and the middleware (Express) or the plugin options (Fastify), and prints the registration line to paste. Internally every framework is now one directory under `lib/frameworks/`, so adding one no longer touches the scanner, the planner dispatch or the help text.

- [#765](https://github.com/evloghq/evlog/pull/765) [`c7f1356`](https://github.com/evloghq/evlog/commit/c7f135629c8dfa6ab0190508d1f25175541d8623) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The CLI now requires Node 22 or later. `--cwd <dir>` is accepted by every command, not only `doctor`, `map`, `init` and `agents`. `evlog --help` no longer loads any command module, and `tinyglobby` is replaced by Node's own `fs.globSync`, so the install carries one fewer dependency tree.

- [#767](https://github.com/evloghq/evlog/pull/767) [`30c9916`](https://github.com/evloghq/evlog/commit/30c9916f8a7c29a2a587b682766a8ffd96babd15) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog map --format github` writes GitHub Actions workflow commands to stdout so findings land on the pull request diff. With `--baseline` it emits the regressions as `::error`; without one, the FIX FIRST list as `::warning`, worst entry point first. `--limit <n>` caps the list (default 10, GitHub's per-step cap) and the closing `::notice` says how many were left out. Paths are rebased on `GITHUB_WORKSPACE` when it is set, so a package scanned with `--cwd` inside a monorepo checkout still annotates the right file. `--format json` is the same as `--json`; asking for both is refused.

### Patch Changes

- Updated dependencies [[`c7f1356`](https://github.com/evloghq/evlog/commit/c7f135629c8dfa6ab0190508d1f25175541d8623)]:
  - @evlog/telemetry@0.3.3

## 0.7.0

### Minor Changes

- [#754](https://github.com/evloghq/evlog/pull/754) [`aebed60`](https://github.com/evloghq/evlog/commit/aebed601afce00aeeb4250cf1b075d4504067f5d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog` now ships the `evlog` executable: once evlog is installed, `npx evlog init`, `npx evlog map`, `npx evlog doctor` and `npx evlog agents` are available without adding anything. The executable runs `@evlog/cli` when it is installed and otherwise fetches it with the package manager that launched it (`npx`, `pnpm dlx`, `bunx`, `yarn dlx`), so `evlog` gains no dependency. Add `@evlog/cli` as a dev dependency for a pinned, instant run in CI. `@evlog/cli` now declares `evlog` as a peer dependency instead of a dependency, so a project carries one copy of the logger.

- [#747](https://github.com/evloghq/evlog/pull/747) [`6d7a6e5`](https://github.com/evloghq/evlog/commit/6d7a6e5d2bf556507c94024c74291b47ed97f40a) Thanks [@evlogai](https://github.com/apps/evlogai)! - `evlog init` now puts the drain credentials where they cannot be missed: when a chosen production destination reads environment variables that are set nowhere (neither the process nor the project's `.env`), the variable list becomes the first manual step, with what each variable is, where to put the value, and a link to the adapter docs. Variables that already exist are left out, and the separate `Set these before anything is received` note (interactive) and `SET BEFORE ANYTHING IS RECEIVED` block (non-interactive) are gone.

### Patch Changes

- [#754](https://github.com/evloghq/evlog/pull/754) [`aebed60`](https://github.com/evloghq/evlog/commit/aebed601afce00aeeb4250cf1b075d4504067f5d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog` now loads only the command it runs, so `evlog doctor` and `evlog telemetry` no longer load the source parser that `evlog map` and `evlog init` use. `withTelemetry` in `@evlog/telemetry` accepts lazy citty subcommands (`() => import('./cmd').then(m => m.default)`) and wraps them when citty resolves them, without loading the other commands.

- [#744](https://github.com/evloghq/evlog/pull/744) [`76ec0b1`](https://github.com/evloghq/evlog/commit/76ec0b1d3d7a092efe92b5b17ad01d4ef6ef9222) Thanks [@evlogai](https://github.com/apps/evlogai)! - Fix `evlog init` writing invalid config for Nuxt (and TanStack Start) when the last property of the config object has no trailing comma: two appended properties each added their own separator, producing `},,` that fails `nuxt prepare`. Properties appended at the same spot also landed in reverse order.

- [#745](https://github.com/evloghq/evlog/pull/745) [`ccd7063`](https://github.com/evloghq/evlog/commit/ccd70633f2774fc00a26bae355b4a75c7dfe4aa3) Thanks [@evlogai](https://github.com/apps/evlogai)! - On Nuxt 5 and Nitro v3 targets, `evlog init` now generates server plugins with `import { definePlugin } from 'nitro'` instead of relying on the auto-imported `defineNitroPlugin`, which no longer exists there and crashed generated apps with `ReferenceError: defineNitroPlugin is not defined`. Nuxt 4 and Nitro v2 keep the previous form.

- Updated dependencies [[`aebed60`](https://github.com/evloghq/evlog/commit/aebed601afce00aeeb4250cf1b075d4504067f5d)]:
  - @evlog/telemetry@0.3.2

## 0.6.3

### Patch Changes

- Updated dependencies [[`4debb2d`](https://github.com/evloghq/evlog/commit/4debb2d3301d104ba4196306b0227acc11ac6b8a), [`07db128`](https://github.com/evloghq/evlog/commit/07db12893f8c3dfa59ce4ca49c83f5c4c4600ae0), [`3a84ba9`](https://github.com/evloghq/evlog/commit/3a84ba9f5f181502dd331db57f7e471b0990ed36), [`7811f7d`](https://github.com/evloghq/evlog/commit/7811f7d51469245958a16f105289bc4b94293d12)]:
  - evlog@2.29.0

## 0.6.2

### Patch Changes

- [#649](https://github.com/evloghq/evlog/pull/649) [`0417784`](https://github.com/evloghq/evlog/commit/0417784dc9e6d3825c10b5d715ff2cb1e7e3acdd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Point the package metadata (`repository`, `bugs`) and README links at the repository's new home, `evloghq/evlog`.

- Updated dependencies [[`0417784`](https://github.com/evloghq/evlog/commit/0417784dc9e6d3825c10b5d715ff2cb1e7e3acdd)]:
  - evlog@2.28.1
  - @evlog/telemetry@0.3.1

## 0.6.1

### Patch Changes

- Updated dependencies [[`ada6408`](https://github.com/HugoRCD/evlog/commit/ada6408caa7271f7f4a2595dc7f56dd934367052), [`c0a0385`](https://github.com/HugoRCD/evlog/commit/c0a03855d476224039154aee46064a38da008836), [`c2af424`](https://github.com/HugoRCD/evlog/commit/c2af424256789c0b957325455acbc3d14003cf06)]:
  - evlog@2.28.0

## 0.6.0

### Minor Changes

- [#630](https://github.com/HugoRCD/evlog/pull/630) [`f1c37d0`](https://github.com/HugoRCD/evlog/commit/f1c37d0765e5352e6c2ee4383698e7e4ad607a10) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog init` wires Hono projects. It creates `src/evlog.ts` with `initLogger` and a configured `evlog()` middleware export: drains and enrichers land in the middleware options, sampling in `initLogger`. Registering the middleware stays yours, so init prints the `app.use(evlogMiddleware)` line to paste. Hono joins the framework prompt, `--framework hono`, and init telemetry.

- [#629](https://github.com/HugoRCD/evlog/pull/629) [`0a8793b`](https://github.com/HugoRCD/evlog/commit/0a8793b2ddc0cac0ed3ade95280c51974d781131) Thanks [@cavalluccijohann](https://github.com/cavalluccijohann)! - Add Hono support to `evlog map`. The scanner detects Hono projects and extracts routes from `app.get('/path', handler)` registrations, including `app.on()` with array methods or paths. The facts layer recognizes `c.get('log')` as a logger binding, so Hono handlers using the idiomatic accessor score correctly, and the report distinguishes an app that registered `app.use(evlog())` (thin ambient events) from one that never did (dark). `evlog map <file>` suggests the handler shape in Hono's own idiom, and `evlog agents` documents the accessor in its AGENTS.md block.

### Patch Changes

- Updated dependencies [[`f030d01`](https://github.com/HugoRCD/evlog/commit/f030d01a6423c3cb7843e33cb8b95d9bbc4b9c12)]:
  - evlog@2.27.1

## 0.5.3

### Patch Changes

- Updated dependencies [[`1704339`](https://github.com/HugoRCD/evlog/commit/17043394e7bcf8c1603ffb44f0f4952a5be77a31), [`72093df`](https://github.com/HugoRCD/evlog/commit/72093df2e658bf307312feaf57cecaf0c2cad19f), [`c40e0fd`](https://github.com/HugoRCD/evlog/commit/c40e0fd5a60ab094b28bd98aa8ff3b5120784d7f)]:
  - evlog@2.27.0

## 0.5.2

### Patch Changes

- [#561](https://github.com/HugoRCD/evlog/pull/561) [`bae4413`](https://github.com/HugoRCD/evlog/commit/bae44137f363d6e57852af294b1735f9189afb1d) Thanks [@evlogai](https://github.com/apps/evlogai)! - fix: `evlog map --baseline git:<ref>` now tells a ref that does not resolve apart from a ref that is fine but has no committed `evlog.map.json`. The ratchet reads the map through git, so a map you gitignored is unreachable: instead of a generic "not found", the CLI says `no evlog.map.json in <ref>, and the ratchet needs a committed map` and names the fix (`evlog map && git add -f evlog.map.json`), while a nonexistent ref gets its own error (`no git ref <ref>`).

- [#559](https://github.com/HugoRCD/evlog/pull/559) [`e72019a`](https://github.com/HugoRCD/evlog/commit/e72019a46f3fcb9740c52cb41c41bb04e1de1a37) Thanks [@evlogai](https://github.com/apps/evlogai)! - fix: `evlog map --baseline` records the CLI and rule-set versions in `evlog.map.json` and refuses to diff (exit 2) when the committed rule set does not match the running CLI, instead of reporting regressions caused by a rule change

- [#549](https://github.com/HugoRCD/evlog/pull/549) [`9eb98cf`](https://github.com/HugoRCD/evlog/commit/9eb98cfb803d60658b5f833305ce486d2399c521) Thanks [@evlogai](https://github.com/apps/evlogai)! - fix: `evlog doctor` treats a wired fs drain as a local sink before the first event, and no longer warns when no local sink is configured

- [#564](https://github.com/HugoRCD/evlog/pull/564) [`b45eed5`](https://github.com/HugoRCD/evlog/commit/b45eed545f531fb99e5cd70b87e2f81d0c14d58a) Thanks [@evlogai](https://github.com/apps/evlogai)! - `evlog map` telemetry now records per-kind entry point totals and dark counts (`mapKindPage`, `mapDarkPage`, ...), and the same split by sensitivity (`mapSensitiveMoney`, `mapDarkMoney`, ...). A kind absent from the project is omitted rather than sent as zero. The disclosure table from `evlog telemetry status` and the CLI telemetry docs were updated to match.

- Updated dependencies [[`15b292d`](https://github.com/HugoRCD/evlog/commit/15b292d2e824f90738b69ccdfb3ba41da3710f16), [`ebed9cf`](https://github.com/HugoRCD/evlog/commit/ebed9cf8936672552ebb2ed125f3722b53c183ba)]:
  - evlog@2.26.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`16d5323`](https://github.com/HugoRCD/evlog/commit/16d5323efb132fead23643bc002d2411d1f48124), [`f8fb677`](https://github.com/HugoRCD/evlog/commit/f8fb677d5a267d2a25bca52bff2453b5f0c1bdf2), [`1838d60`](https://github.com/HugoRCD/evlog/commit/1838d609ed41f973a48ebf62dc0557a16117221d), [`8ffba92`](https://github.com/HugoRCD/evlog/commit/8ffba925f5fedb94cce782aa173011cde0245ace), [`68b05fa`](https://github.com/HugoRCD/evlog/commit/68b05fa1456ee3b7d6cfe9e34abe3175c74cb5d0), [`2dfde11`](https://github.com/HugoRCD/evlog/commit/2dfde11d5c79a2b119a5c64110dc25d0e2f43656)]:
  - evlog@2.25.0

## 0.5.0

### Minor Changes

- [`429e4a7`](https://github.com/HugoRCD/evlog/commit/429e4a7661fd6ab7b625fe0522aca4baa957f5dc) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Record what a `map` scan found, and more of what `doctor` diagnosed.

  `evlog map` reported nothing at all. It now records the shape of a scan: the score and its grade, entry point counts split by coverage, the detected framework, which gate ran and whether it failed the command, and — per rule — how many entry points failed it against how many waived it with an `evlog-map-disable` comment.

  Rule ids are the CLI's own closed set and are already public. Everything read out of your source is a count — no route path, no file name, no project name, no snippet. `evlog telemetry status` prints the full field list, and `evlog telemetry disable`, `EVLOG_TELEMETRY=0` or `DO_NOT_TRACK=1` turn all of it off.

  `evlog doctor` additionally reports how many checks passed, whether evlog resolved, whether a logs sink was found, and how many stack entries were detected.

### Patch Changes

- Updated dependencies [[`7b2f9ec`](https://github.com/HugoRCD/evlog/commit/7b2f9ecf57b89c9b7992278cdd5ac386f51ccf18)]:
  - @evlog/telemetry@0.3.0

## 0.4.0

### Minor Changes

- [#492](https://github.com/HugoRCD/evlog/pull/492) [`31e5084`](https://github.com/HugoRCD/evlog/commit/31e50844f9108b89bf7ac050be5326f3d724e887) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat: add `evlog agents` — teach the AI agents working in a project how to use evlog. It writes a short, marker-delimited block of evlog conventions into `AGENTS.md` (one wide event per operation, grouped context via `log.set()`, `createError({ why, fix, internal })` over bare throws, `defineErrorCatalog()` once an error repeats, `log.audit()` on sensitive actions, and what never gets logged) and creates a `CLAUDE.md` pointing at it with `@AGENTS.md`. The block names the request-logger accessor for the detected framework (`useLogger(event)` on Nuxt and Nitro, `useLogger()` from `lib/evlog.ts` on Next.js, `req.context.log` on TanStack Start) and falls back to a generic one when detection finds nothing, so the command is useful outside the four frameworks `evlog map` covers.

  The agent skills are installed by shelling out to `npx skills add https://www.evlog.dev`, the same way `evlog init` runs your package manager rather than unpacking a tarball itself. Each agent reads a different directory (`.claude/skills`, `.agents/skills`, `.codex/skills`, …) and the skills CLI already resolves them, symlinks a canonical copy, and supports a global scope — and since it keeps no manifest, a copy written behind its back would be a second one it could never update. Skills already installed, in any agent directory and either scope, are detected and left for `npx skills update`. `--skills <a,b>` narrows the selection, `--global` installs for every project, `--no-skills` writes the block with nothing spawned, `--source` points at another host, and `--dry-run` prints the plan. Interactive runs hand the terminal to the skills CLI so it can ask which agents to install for; non-interactive runs pass `--yes` so nothing blocks on a prompt nobody will answer.

  `evlog init` now offers the same step as its last question — the `AGENTS.md` and `CLAUDE.md` writes are planned alongside the wiring so there is still one plan and one confirmation, and the skills run next to the package-manager install. `--no-agents` skips it. The block never needs the network, so a skills failure is reported without costing the rest of the run.

  `--source` must be an `http:`/`https:` URL and `--skills` entries must be lowercase dashed names, both rejected with a catalog error before anything is spawned — on Windows the spawn needs a shell to resolve `npx`, so those values would otherwise reach a `cmd.exe` command line. If the skills install fails, the `AGENTS.md` block is rewritten without the pointer to a skill that is now known not to be on disk.

  Both flows report the skills step whether or not it did anything — in the plan, in the written report, and through clack in an interactive run — so "already installed" is never confusable with "forgot to do it".

  `CliContext` gains a `home` field, so the search for installed skills reads the home directory through the context like every other `process.*` value rather than calling `os.homedir()` directly.

### Patch Changes

- Updated dependencies [[`c739cf8`](https://github.com/HugoRCD/evlog/commit/c739cf87aa2dfbc72dd9d868b688fdf7bed5d8dd), [`44705f7`](https://github.com/HugoRCD/evlog/commit/44705f7bd90ef2d903e9a10beea7a704c724e50e)]:
  - evlog@2.24.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`f39ab30`](https://github.com/HugoRCD/evlog/commit/f39ab30d90af608acb1527a766d4823460dc99bd), [`899464a`](https://github.com/HugoRCD/evlog/commit/899464a6c4a2dcf0a2816ddd39eb74203c4d4a82), [`d7f482a`](https://github.com/HugoRCD/evlog/commit/d7f482aa41ad696db21ba07ffaaa355bf7fd0b56), [`f5d7474`](https://github.com/HugoRCD/evlog/commit/f5d7474232379a3346f2dfa8e23335b4a9bfa44a), [`12852d3`](https://github.com/HugoRCD/evlog/commit/12852d31ad10e990091c6cb1740d201fb9fc95ac), [`ecc3ea6`](https://github.com/HugoRCD/evlog/commit/ecc3ea60db28d7513c515958f127af6a1ec6a0d5), [`f662848`](https://github.com/HugoRCD/evlog/commit/f6628484226c11456611543f0930ef9ad6c9c857), [`4e12ebb`](https://github.com/HugoRCD/evlog/commit/4e12ebbbc33a04d8cc77c7bf09edce418466d804), [`2c20be7`](https://github.com/HugoRCD/evlog/commit/2c20be7620e4eeea1bb31cfbca91af66e60e849e), [`35431c2`](https://github.com/HugoRCD/evlog/commit/35431c2685a10b0448e22fd416a9b37e626ec1e0), [`9e3bd96`](https://github.com/HugoRCD/evlog/commit/9e3bd96d401890ff24001da742848b14ce65a4b7), [`1b0edb8`](https://github.com/HugoRCD/evlog/commit/1b0edb80b080b3c03fc2f60e848191fac2a6a2f7), [`c5e85b0`](https://github.com/HugoRCD/evlog/commit/c5e85b0b121a60b69699b4f6f2fe5831dee62f19), [`5d99391`](https://github.com/HugoRCD/evlog/commit/5d99391638a13bb7ea3a8b98f3ac71e07b9b72cb), [`374abfd`](https://github.com/HugoRCD/evlog/commit/374abfdd01522a7e74d26ecfc8f20c2ae8571e1a), [`2540aa5`](https://github.com/HugoRCD/evlog/commit/2540aa5eb526f9cd25a637cde1bc7115575a280e)]:
  - evlog@2.23.0

## 0.3.0

### Minor Changes

- [#459](https://github.com/HugoRCD/evlog/pull/459) [`161260e`](https://github.com/HugoRCD/evlog/commit/161260ee04f0785483fd668c847053b3dfd3cec6) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat(cli): add `evlog init` — an interactive setup that reads the project, then wires evlog into an existing Nuxt, Nitro, Next.js, or TanStack Start app

  It runs the same analysis `evlog map` runs and offers only what the project can back up: an error catalog when the same `createError` appears in more than one file, audit actions when sensitive entry points have no trail, the AI SDK and auth integrations when their packages are installed, batching when something actually leaves the process. Offers carry their evidence — "3 repeated errors found" — and the catalogs are seeded with the project's own errors and routes rather than scaffolded from a template

  Development and production destinations are asked for separately, because nobody sends local traffic to Axiom and nobody reads production logs off the box's filesystem. Production takes several destinations at once and fans the event out to each; the generated plugin branches on the environment in one place. Only the filesystem drain is gated to development, and batching wraps the network sends but never the local write

  Config files are patched at the exact AST offsets so comments and formatting survive; existing files are never overwritten, and a drain file that already wires the same destinations is left alone rather than duplicated. Secrets are never prompted for — the adapter's variables are appended to `.env.example`, never `.env`. The run finishes by executing `evlog doctor`, so it answers "did it work" instead of pointing at another command

  Every prompt has a flag, so an agent reproduces exactly what a human just did: `--yes`, `--json`, a non-TTY, or `CI` selects the non-interactive path, and an unknown `--drain` or `--extras` value stops the run rather than silently defaulting. Run from a workspace root, it sets up the apps rather than the root package

  `init` records which options were picked on its telemetry event — framework, destinations, extras, sampling preset, and counts — so the flow can lead with what people use. Every value is an id from the CLI's own catalog behind an allowlist; the service name and anything read out of the user's source are never sent

- [#459](https://github.com/HugoRCD/evlog/pull/459) [`44a33b1`](https://github.com/HugoRCD/evlog/commit/44a33b12c656116dde07dbe81b54191fcde7c38a) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat(cli): add `evlog map --baseline` — gates a pull request on regressions against the committed `evlog.map.json` instead of an absolute threshold, which keeps CI honest across releases that move the rules. Compares per check: a requirement going from pass to fail gates, and so does silencing one with a disable comment. New dark entry points are reported without failing (`--min-score` is the bar for new work). Reads a local file or `git:<ref>` — no network, no repository access, so it behaves the same on a private repo. A run that reports a regression leaves the map file untouched rather than ratcheting the baseline down to the worse state

### Patch Changes

- [#454](https://github.com/HugoRCD/evlog/pull/454) [`2f0e98a`](https://github.com/HugoRCD/evlog/commit/2f0e98ae2d2120c7e6a34fb319a3eb50ca6fe6ac) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(cli): detect Nuxt 4 `app/pages` (and `src/pages`) in `evlog map` — pages under the Nuxt 4 default layout were invisible, which could leave a project at 100/100 with zero entry points

## 0.2.0

### Minor Changes

- [#448](https://github.com/HugoRCD/evlog/pull/448) [`8338bf5`](https://github.com/HugoRCD/evlog/commit/8338bf5b58a2d0c11ca0210108a5411bcce39eea) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog map` — a static observability score for your app, Lighthouse-style. It detects your framework (Nuxt, Nitro, Next.js App Router, or TanStack Start), scans every entry point, and scores wide-event coverage: `useLogger()`, request context (`log.set()`), structured errors (`createError({ why, fix })`), audit trails on sensitive routes, and error handling.

  `evlog map` prints the score, which areas of the app it comes from, and the three entry points to fix first with the file, the line, and a docs link for each. `evlog map --all` shows every entry point as a check matrix grouped by directory, and `evlog map <route-or-file>` explains one entry point in full: why it was scanned, why it was flagged sensitive, each rule's verdict, and the shape the handler could take in your framework. `evlog.map.json` is written to the project root (skip with `--no-write`), and `--min-score <n>` gates CI with an explicit pass/fail verdict.

  Coverage is checked by a rule engine rather than a bag of heuristics: each rule has a stable id, a documented weight, and a docs link, and every finding carries the exact file and line it came from. Detection is AST-based, so a locally defined `useLogger()` stub does not count as instrumentation, `log.audit?.deny()` counts as an audit record, wrappers like `withEvlog` count as instrumentation, helpers re-exported through a local module count as evlog's, and a package only counts as sensitive when it is genuinely imported. Every documented way of reaching the request logger is read, including the one that never calls a factory — `req.context.log`, the shape evlog's TanStack Start and Nitro guides use. A rule with nothing to look at reports itself as not applicable instead of passing for free, and an entry point with nothing to instrument — a static page, evlog's own ingest endpoint — is set aside rather than counted as a gap, and left out of the project average instead of lifting it with a free 100.

  The report also suggests going further with evlog features the project has already adopted: promoting an error spelled out identically in several handlers into an entry of your existing catalog, extending an audit trail to a state change it does not cover yet, and installing `evlog/ai` or `evlog/better-auth` when those packages are dependencies. Suggestions are gated on evidence rather than on file names and never change the score, so a `--min-score` gate cannot fail because of one.

  A verdict you disagree with costs one comment instead of your CI gate:

  ```ts
  // evlog-map-disable-next-line wide-event, context -- liveness probe, deliberately silent
  export default defineEventHandler(() => ({ ok: true }));
  ```

  `evlog-map-disable-line` covers the line it trails, and `evlog-map-disable` on its own covers the whole file. Name several rule ids separated by commas or spaces, name none to cover every rule, and put your reason after `--`. The check is then reported as `n/a` with your reason attached, so it costs no score — but it stays visible: the report ends with `○ 2 checks disabled by comment in 1 entry point`, and in the JSON the check carries `"suppressed": true` with `summary.suppressedChecks` for the project total, so a CI job can tell how much of a green score is suppressed.

  `map` is safe to run and covered by tests, but it is early: it ships adapters for four frameworks and its rules are still being refined, so verdicts and scores can move between releases. Pin `@evlog/cli` as a dev dependency when a CI gate depends on the number.

### Patch Changes

- Updated dependencies [[`8f294d1`](https://github.com/HugoRCD/evlog/commit/8f294d17b65e17a77aa40f2be721168be35b61bb)]:
  - evlog@2.22.4

## 0.1.5

### Patch Changes

- Updated dependencies [[`c58ded1`](https://github.com/HugoRCD/evlog/commit/c58ded1f45bfb9b7117489667048f7eee1e83406)]:
  - @evlog/telemetry@0.2.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`73a4d3c`](https://github.com/HugoRCD/evlog/commit/73a4d3c25bbcf528b92e928c9925a48147e87954)]:
  - @evlog/telemetry@0.1.2

## 0.1.3

### Patch Changes

- [`c448a1f`](https://github.com/HugoRCD/evlog/commit/c448a1fbc3c374d6be67ab54786b8d9591d8a73d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Wire a default telemetry ingestion endpoint (`https://telemetry.evlog.cloud/api/telemetry/ingest`) so `evlog` CLI usage data is actually delivered instead of only buffering locally. This only changes _where_ already-consented events go — opt-out (`DO_NOT_TRACK=1`, `EVLOG_TELEMETRY=0`, `evlog telemetry disable`) and the `EVLOG_TELEMETRY_ENDPOINT` override still work exactly as before.

## 0.1.2

### Patch Changes

- Updated dependencies [[`00fadc9`](https://github.com/HugoRCD/evlog/commit/00fadc9573ae8d49b64a5deccd6d2e93ee3ad66b)]:
  - evlog@2.22.3

## 0.1.1

### Patch Changes

- Updated dependencies [[`8f7b5e3`](https://github.com/HugoRCD/evlog/commit/8f7b5e3c933bfd58e910dfa501dbfc0789260cb5)]:
  - evlog@2.22.2

## 0.1.0

### Minor Changes

- [#431](https://github.com/HugoRCD/evlog/pull/431) [`0b90010`](https://github.com/HugoRCD/evlog/commit/0b90010a614ae4e03ec823592ff3a5eec592dc66) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Introduce the evlog CLI (`@evlog/cli`, binary `evlog`). First release ships `evlog doctor` — diagnoses your setup (Node version, evlog install, local `.evlog/logs` sink) with a branded terminal report or `--json` output — plus `evlog telemetry status|enable|disable`. Opt into debug with `--debug` / `EVLOG_CLI_DEBUG=1`. Commands use `defineEvlogCommand` → `{ cli, log, ui }`: `log.step` / `log.finding(cliErrors.X)` for diagnostics, `ui.done` for human/json/exit. Compact case-file on stderr; raw event with `--json --debug`. Workspace detection covers pnpm, bun (`bun.lock` / `bun.lockb`), npm, and yarn.

  `--json`, `--debug`, and telemetry all include an `environment` stage (`development` | `preview` | `production`). Packaged installs (`npx` / `node_modules`) report `production`; workspace builds report `development`. Override with `EVLOG_CLI_ENV` / `EVLOG_TELEMETRY_ENV`, or inherit `VERCEL_ENV`.

  `withTelemetry()` is now generic over citty `ArgsDef`, so root commands with typed flags (e.g. `--debug`) type-check cleanly. `evlog telemetry status` (and any tool using `defineTelemetryCommands`) prints the local data directory path. Telemetry `env.environment` is part of the standard envelope; authors may pass `environment` in `TelemetryOptions`.

### Patch Changes

- Updated dependencies [[`0b90010`](https://github.com/HugoRCD/evlog/commit/0b90010a614ae4e03ec823592ff3a5eec592dc66), [`573f772`](https://github.com/HugoRCD/evlog/commit/573f772cdb0d69425739c389b780119fbb63259e), [`9b2d3d9`](https://github.com/HugoRCD/evlog/commit/9b2d3d94ad0e922942f35cc6b604db7e8b764fa0)]:
  - @evlog/telemetry@0.1.1
  - evlog@2.22.1
