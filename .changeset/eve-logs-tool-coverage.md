---
"@evlog/eve": minor
---

The `logs` tool's results say what they cover: `origin` (files or Vercel, with the project and environment), `caller` (the session and turn the tool was called from), `window`, `filters`, `matched` and `returned`, and `coverage`. The tool's description tells the model not to claim nothing failed or was slow from an incomplete read.

- Each row has `result`: `completed`, `recovered` (finished after a tool call failed, with status 200), `failed` or `cancelled`. `detail: 'diagnostic'` adds models, model calls, cost, cache reads and trace ids.
- `view: 'sessions'` returns one summary per session, the caller's marked `current`, within the caller's access scope.
- `expect: { source, environment }` refuses a read from another store with a 409, instead of an empty answer.
- `trace` returns full wide events within a size budget (`full: true` for all of them), with `omitted` and `traces` naming each event's trace and span ids. It is labelled as wide events, not the OTel span tree.
- `logs.source: 'vercel'` reads the linked project's runtime logs from `eve dev`, with the `VERCEL_OIDC_TOKEN` that `vercel env pull` writes. The default `'auto'` is unchanged.
- `logs.diagnostics: true` records each call's source, view, redacted filters, counts, coverage and duration under `evlog.logs.<callId>`, never the rows it returned.
