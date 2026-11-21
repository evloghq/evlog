# @evlog/eve

[evlog](https://evlog.dev) for [eve](https://eve.dev) agents. An eve extension that emits one wide event per agent turn: outcome, duration, tokens and cost, every tool, skill and subagent call, and the evlog error a tool threw, redacted before it leaves the process. It also gives the agent a `logs` tool to read its own events.

Requires eve 1.0 or later, Node 24 and evlog 3.

## Set up

In an eve project, `evlog init` installs both packages, writes `evlog.config.ts`, mounts the extension in each agent and adds the trace hook:

```bash
npx @evlog/cli@beta init
```

By hand:

```bash
pnpm add evlog@beta @evlog/eve@beta
```

```ts
// agent/extensions/evlog.ts
import evlog from '@evlog/eve'
import config from '../../evlog.config'

export default evlog(config)
```

With no options, `export { default } from '@evlog/eve'` mounts it with the defaults: service `eve-agent`, `record: 'standard'`, redaction on. The `beta` tags are needed until evlog 3.0 is stable, because plain `evlog` still resolves to 2.x, which does not satisfy the peer.

## Add context and errors from tools

```ts
// agent/tools/issue_refund.ts
import { useLogger } from '@evlog/eve/logger'

useLogger().set({ order: { id, amount } })
throw billing.PAYMENT_DECLINED({ order }) // code, status, why and fix reach the turn's event
```

Fields set with `useLogger()` are stored with the eve session, so they reach the event even when the turn resumes in another process after an approval.

## What a turn records

`record` sets how much: `minimal` (outcome, duration, usage, errors), `standard` (adds every call, approvals and lineage) or `debug` (adds tool input, output and reply previews). Per-tool rules override it:

```ts
export default evlog({
  ...config,
  tools: {
    lookup_order: { output: true },               // a 2,000-character preview
    researcher: { output: { maxLength: 8000 } },  // a longer one
    crm__search: false,                           // left out of the event
  },
})
```

Every recorded value is redacted first, then cut to its preview, and carries `<field>_size`, plus `<field>_truncated: true` when it was cut. `'full'` keeps the whole value.

## Traces

Export `evlogTraces()` from an instrumentation file to put each turn's `traceId` and `invoke_agent` `spanId` on its event, so a drain such as OTLP links the event to eve's trace. `evlog init` and `npx evlog setup eve` write it:

```ts
// agent/instrumentation/evlog.ts
import { evlogTraces } from '@evlog/eve/instrumentation'

export default evlogTraces()
```

## The `logs` tool

The mount adds `evlog__logs`, which runs the query behind `evlog logs` on the agent's own turns: the `recent`, `errors`, `slow`, `sessions`, `stats` and `trace` views with the CLI's filters. Scheduled turns read every turn, a signed-in caller its own session, and an anonymous caller gets no tool; `logs.access` changes that per caller.

Locally it reads the files the [fs drain](https://evlog.dev/integrate/adapters/self-hosted/fs) writes to `.evlog/logs`. On Vercel it reads the project's runtime logs through the Vercel Connect connector `logs.vercel.connector` names. There is no default connector: run `npx evlog setup vercel` once, which writes the one you pick to `evlog.config.ts`. Until then every call fails with `Vercel logs are not set up` rather than reading nothing.

## Docs

Options, the full event shape and the coverage check with `evlog map`: https://evlog.dev/use-cases/eve
