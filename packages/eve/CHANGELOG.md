# @evlog/eve

## 1.0.0-beta.2

### Minor Changes

- [#1189](https://github.com/evloghq/evlog/pull/1189) [`2676d35`](https://github.com/evloghq/evlog/commit/2676d35d30bdfbe349f7651c8334f124fb92c7d2) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Tool inputs and outputs in `gen_ai.tools` are now previews. Under `record: 'debug'` or a tool rule, each recorded value is redacted, then kept whole when its JSON fits in 2,000 characters and cut to the start of its JSON past that, with `output_truncated: true`. Every recorded value carries `input_size` or `output_size`, its length before the cut. A tool rule sets the limit per field: `{ output: { maxLength: 8000 } }` for a longer preview, `{ output: 'full' }` for the whole value. Before, a subagent's reply or a large tool result was copied into the event whole.

- [#1179](https://github.com/evloghq/evlog/pull/1179) [`e09968c`](https://github.com/evloghq/evlog/commit/e09968c963e2e2d8c81c575c1166ffb88b413aa7) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The `logs` tool's results say what they cover: `origin` (files or Vercel, with the project and environment), `caller` (the session and turn the tool was called from), `window`, `filters`, `matched` and `returned`, and `coverage`. The tool's description tells the model not to claim nothing failed or was slow from an incomplete read.

  - Each row has `result`: `completed`, `recovered` (finished after a tool call failed, with status 200), `failed` or `cancelled`. `detail: 'diagnostic'` adds models, model calls, cost, cache reads and trace ids.
  - `view: 'sessions'` returns one summary per session, the caller's marked `current`, within the caller's access scope.
  - `expect: { source, environment }` refuses a read from another store with a 409, instead of an empty answer.
  - `trace` returns full wide events within a size budget (`full: true` for all of them), with `omitted` and `traces` naming each event's trace and span ids. It is labelled as wide events, not the OTel span tree.
  - `logs.source: 'vercel'` reads the linked project's runtime logs from `eve dev`, with the `VERCEL_OIDC_TOKEN` that `vercel env pull` writes. The default `'auto'` is unchanged.
  - `logs.diagnostics: true` records each call's source, view, redacted filters, counts, coverage and duration under `evlog.logs.<callId>`, never the rows it returned.

- [#1156](https://github.com/evloghq/evlog/pull/1156) [`fa16a6f`](https://github.com/evloghq/evlog/commit/fa16a6fd1d24cbea8079cc29580310d4452a9638) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The extension adds a `logs` tool (`evlog__logs` for a mount named `evlog`) that reads the agent's own events with the query behind `evlog logs`: the `recent`, `errors`, `slow`, `stats` and `trace` views, and the `session`, `where`, `since`, `until`, `level`, `path`, `status` and `over` filters. List views return one short row per turn (status, duration, the error's code, why and fix, the tools that failed, tokens), with extra fields on request through `fields`; `trace` returns one request's events in full. On Vercel (`source: 'auto'` or `'vercel'`) it reads the project's runtime logs with the deployment's OIDC token, through the connector `logs.vercel.connector` names, set up once with `npx evlog setup vercel`. With no connector, every call fails with `Vercel logs are not set up`, the turn's event records the call as failed, and the tool does not fall back to the local files. Elsewhere it reads `logs.dir`. The agent's scheduled work reads every turn, a signed-in caller its own session, and an anonymous caller gets no tool; `logs.access(ctx)` returns `'agent'`, `'session'` or `false` to change that per caller. The new `logs: { dir, vercel: { connector }, access }` option configures it.

- [#1160](https://github.com/evloghq/evlog/pull/1160) [`f252449`](https://github.com/evloghq/evlog/commit/f25244958d324f348036d780b4f136ceed633fa5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Each `gen_ai.tools` entry carries `call_id`, the `gen_ai.tool.call.id` of eve's `execute_tool` span for that call, so a failed call in the event points at its span in the trace. A failed call also carries the `code`, `why` and `fix` of the evlog error its tool threw, next to `error`.

- [#1160](https://github.com/evloghq/evlog/pull/1160) [`f252449`](https://github.com/evloghq/evlog/commit/f25244958d324f348036d780b4f136ceed633fa5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlogTraces()`, from the new `@evlog/eve/instrumentation` entry, puts each turn's `traceId` and `invoke_agent` `spanId` on its wide event, so the OTLP drain links the event to the trace eve records and `vercel traces inspect` opens it. eve runs no span while tools and hooks run, so `createOtelPlugin()` cannot read one there. Export it from a file of the agent's own, since extensions cannot declare instrumentation:

  ```ts
  // agent/instrumentation/evlog.ts
  import { evlogTraces } from "@evlog/eve/instrumentation";

  export default evlogTraces();
  ```

### Patch Changes

- [#1160](https://github.com/evloghq/evlog/pull/1160) [`f252449`](https://github.com/evloghq/evlog/commit/f25244958d324f348036d780b4f136ceed633fa5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - A tool call that fails with a plain `Error` gets an `error` block on the turn's event, with the name and message eve kept, so `evlog logs errors` and the logs tool's `errors` view list the turn. When two calls in a turn fail with the same message and different evlog errors, neither call gets a `code`, `why` or `fix`; they used to both get the last one's.

- [#1181](https://github.com/evloghq/evlog/pull/1181) [`e0794f7`](https://github.com/evloghq/evlog/commit/e0794f7860cd883316bb5eeda30ed41862cd290e) Thanks [@HugoRCD](https://github.com/HugoRCD)! - - Every `logs` result stays under 24,000 characters of JSON, or 200,000 with `full: true`, list rows and session summaries included. A row that does not fit drops its `fields`, then all but its identifying keys, and names them in `omittedFields`. A `trace` event that does not fit is left out whole, and its trace and span ids stay in `traces`. The notes say whether `full: true` would help.
  - On files, the read stops at the `window.until` it reports.
  - `sessions` reports the newest failure and trace ids by timestamp, and sums only the token counts the turns reported.
  - `diagnostics: true` records a call that failed before reading, such as one without an OIDC token.

- [#1190](https://github.com/evloghq/evlog/pull/1190) [`2531afe`](https://github.com/evloghq/evlog/commit/2531afe3ef563849bd9770932b5d734fc9ed7179) Thanks [@HugoRCD](https://github.com/HugoRCD)! - A `service` set on the mount names each turn's event when the host app, such as Next.js with `instrumentation.ts`, initialised evlog first. The turns used to carry the app's service, so the agent and the app could not be told apart. `evlog({ ...config, service: 'support-agent' })` now gives the agent its own service either way.

- [#1194](https://github.com/evloghq/evlog/pull/1194) [`e343b43`](https://github.com/evloghq/evlog/commit/e343b438f1b6173bcf36f946d341874cbe36d8da) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The `evlog` peer range is now `^3.0.0-beta.4`. The extension redacts tool inputs and outputs with `redactEvent` from `evlog/toolkit`, which evlog exports from that release, instead of a copy of evlog's redaction bundled into the extension. Upgrade evlog with `pnpm add evlog@beta`.

- [#1160](https://github.com/evloghq/evlog/pull/1160) [`f252449`](https://github.com/evloghq/evlog/commit/f25244958d324f348036d780b4f136ceed633fa5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - A complete request id selects only the events that carry it. `evlog logs wrun_1:turn_1` and the Eve logs tool's `trace` view used to match every id starting with it, so `turn_10` to `turn_19` crowded `turn_1` out of the results. A prefix still works when no event carries the id whole.

## 1.0.0-beta.1

### Patch Changes

- [#1139](https://github.com/evloghq/evlog/pull/1139) [`43f5994`](https://github.com/evloghq/evlog/commit/43f59941ecba51560949709df60c159eb669c1c8) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The `eve` peer range is now `>=1.0.0` (was `*`), the floor the README and the docs already state. A package manager flags an eve 0.x install as an unmet peer, and npm 7 and later stops the install. Upgrade eve to 1.0 or later. The install commands use the `beta` tags until evlog 3.0 is stable.

## 1.0.0-beta.0

### Major Changes

- [#1134](https://github.com/evloghq/evlog/pull/1134) [`6e1b1ac`](https://github.com/evloghq/evlog/commit/6e1b1aca76ba20ed1fad78bf47c49226b8f83afc) Thanks [@HugoRCD](https://github.com/HugoRCD)! - New package: evlog for eve 1.0, mounted as an eve extension with `export { default } from '@evlog/eve'` in `agent/extensions/evlog.ts`. Each turn emits one wide event with the id `sessionId:turnId`, read from the session eve stores, so a turn resumed in another process is complete. Tools add fields with `useLogger()` from `@evlog/eve/logger`, and a thrown evlog error keeps its code, status, why and fix on the event. Records are redacted in every environment, and `record: 'minimal' | 'standard' | 'debug'` with per-tool rules decides what a turn carries.
