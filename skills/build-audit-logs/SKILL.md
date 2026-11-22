---
name: build-audit-logs
description: >-
  Build or review audit trails in TypeScript/JavaScript apps using evlog (pipelines, typed actions,
  denials, multi-tenant audit logs, sending a customer's audit trail to their webhook, retention,
  compliance-style reviews). For application code, not for extending the evlog package.
---

# Build or Review an Audit System with evlog

For **application developers** who either need to add an audit trail to their product, or who already have one and want it reviewed. Walks through the design calls, the end-to-end implementation, and a review checklist for an existing setup.

This skill assumes the audit lives in **your app**. To extend the evlog package itself (new audit helper, new drain wrapper), see the contributor skills under `.agents/skills/`.

## Quick reference: call-site cheat sheet

When you already know the system is wired and just need to remember the API:

| Situation | Helper |
|---|---|
| Inside a request handler, action succeeded | `await log.audit({ action, actor, target, tenantId })` |
| Inside a request handler, AuthZ denial | `await log.audit.deny('reason', { action, actor, target, tenantId })` |
| A token, agent or impersonating admin acted for a user | `actor: { type: 'api', id: token.id, onBehalfOf: { type: 'user', id: user.id } }` |
| One action that touches several tenants | One `log.audit()` call per tenant, each with its own `tenantId` |
| Standalone job / script / CLI (no request) | `await audit({ action, actor, target, tenantId })` |
| Auto-record success / failure / denied for a function | `withAudit({ action, target }, fn)` |
| Recording a state change | add `changes: auditDiff(before, after)` |
| Free-form detail (resource name, environment) | add `metadata: { ... }` |
| Centralised typed action vocabulary | `defineAuditCatalog('billing', { INVOICE_REFUND: { target: 'invoice' } })`, or `defineAuditAction('invoice.refund', { target: 'invoice' })` for one-offs |
| Store audits | `auditOnly(drain)` around the drain that writes them |
| Send each tenant's records to their endpoint | `relayAudit({ cursor, read, send, save })` with `sendAuditWebhook` from `evlog/webhook` |
| Asserting audits in tests | `mockAudit()`, then `assertAudit()` or `toIncludeAuditOf()` |

Each call records one action as its own event and returns a promise that resolves once every drain has it. It never rejects. `await` it when the record must exist before the response (a UI or test reads the trail right after). Without `await`, evlog keeps the runtime alive with `waitUntil`, or the integration waits for it before finishing the request.

`AuditFields` schema (always provide `action` and `actor`; `target` and `tenantId` strongly recommended; `outcome` defaults to `'success'`; `id`, `timestamp`, `version` and `context` are filled in for you):

```ts
interface AuditFields {
  id: string                                      // UUIDv7, the dedupe key
  timestamp: string                               // ISO 8601, when the record was made
  action: string                                  // 'invoice.refund'
  actor: { type: 'user' | 'system' | 'api' | 'agent', id: string, email?, displayName?, model?, tools?, reason?, promptId?, onBehalfOf?: { type, id, email?, displayName?, ... } }
  target?: { type: string, id: string, [k: string]: unknown }
  tenantId?: string                               // organization, team or workspace
  outcome: 'success' | 'failure' | 'denied'
  reason?: string
  changes?: { before?: unknown, after?: unknown, patch?: AuditPatchOp[] }
  metadata?: Record<string, unknown>
  causationId?: string
  correlationId?: string
  version: 2                                      // AUDIT_SCHEMA_VERSION
  context?: { requestId?, traceId?, ip?, userAgent?, ... }   // read from the request by log.audit()
  signature?: string                              // added by signed(drain, { strategy: 'hmac' })
  prevHash?: string                               // added by signed(drain, { strategy: 'hash-chain' })
  hash?: string                                   // added by signed(drain, { strategy: 'hash-chain' })
}
```

## What "audit logging" actually means

An audit log answers a forensic question: **who did what, on which resource, when, from where, with which outcome.** That's a different shape from observability logs, which is why the operational rules differ:

|                | Audit log                                       | Observability log                  |
| -------------- | ----------------------------------------------- | ---------------------------------- |
| Question       | "Who tried to do what, was it allowed?"         | "How did this request behave?"     |
| Sampling       | Never                                           | Often (head + tail)                |
| Retention      | 1 – 7 years (compliance)                        | 30 – 90 days                       |
| Mutability     | Append-only, tamper-evident                     | Mutable, lossy                     |
| Audience       | Auditors, security, legal                       | Engineers                          |
| Storage        | Often dedicated (separate dataset / DB)         | Shared with telemetry              |

evlog ships the audit layer as a thin extension of its wide-event pipeline: each audit is an event with a typed `audit` field, plus a few helpers and drain wrappers. You compose with the primitives the app already uses: same drains, same enrichers, same redact, same framework integration. There is no parallel system to maintain.

## Mental model

```text
log.audit(...) ──► one audit event (id, request context) ──► enrichers ──► redact ──► every drain (emails, IPs masked)
                   sampling, discard() and route filters never apply      └──────► auditOnly(store) (emails, IPs kept)
```

The request's own wide event is emitted separately and carries no `audit` field. The two share `requestId`.

| Building block                              | Role                                                                | Required?               |
| ------------------------------------------- | ------------------------------------------------------------------- | ----------------------- |
| `log.audit()` / `audit()` / `withAudit()`   | Record one action as its own event                                  | Yes                     |
| `auditOnly(drain)`                          | Makes a drain the audit store: audit records only, identities kept  | Yes                     |
| `auditEnricher({ tenantId })`               | Fills `tenantId` from the request when the call left it empty       | Optional                |
| `signed(drain, ...)`                        | Adds tamper-evident integrity (HMAC or hash-chain)                  | Optional (compliance)   |
| `relayAudit()` + `evlog/webhook`            | Forwards each tenant's stored records to an endpoint they own       | Optional (customers)    |
| `auditRedactPreset`                         | Strict PII preset for audit events                                  | Recommended             |
| `mockAudit()`                               | Captures audit records in tests                                     | Yes (in tests)          |

## Design calls before writing code

Make these explicit and write them down somewhere a security reviewer can find. Without a written rule, the system can't be audited. Auditors look for the policy first, then the enforcement.

### 1. Where do audits live?

| Drain                              | Use when                                          | Trade-offs                                                                                  |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **FS** (`evlog/fs` + `signed`)    | Self-hosted, simple, you control the disk         | Manual rotation/backup; single-process unless you persist hash-chain `state` externally     |
| **Dedicated Axiom dataset**       | You already use Axiom                             | Easy queries, separate retention/billing; cost scales with volume                           |
| **Postgres / Neon / Aurora**      | You want SQL queries, joins with app data         | Need a schema, indexes, retention job; `audit.id` as primary key prevents duplicates        |
| **S3 + Object Lock**              | Append-only WORM compliance (HIPAA / FINRA)       | Read latency; pair with a queryable mirror (Athena)                                         |
| **Multiple drains**                | Different audiences (engineers ↔ legal)           | Use `auditOnly` per drain; drains fail in isolation by design                                 |

> **Rule of thumb.** Pick at least two: a queryable one (Axiom / Postgres) for day-to-day forensics + an append-only one (FS journal with hash-chain, or S3 Object Lock) as the compliance artefact. The two-drain pattern protects against vendor outages and admin mistakes on the queryable side.

### 2. Do you need integrity (`signed`)?

Yes if any of:

- A compliance framework requires tamper-evidence (SOC2 CC7, HIPAA §164.312(c)(1), PCI 10.5).
- The drain is mutable by engineers / admins.
- You may need to prove to a regulator that no events were modified after the fact.

Skip if:

- Drain is already WORM (S3 Object Lock, BigQuery append-only, Postgres with row-level immutability + monitored DDL).
- You're prototyping.

Strategies:

- `'hmac'`: per-event signature; quick to verify; rotate `secret` annually and embed a key id (extend `AuditFields`).
- `'hash-chain'`: sequence integrity; deleting a row breaks the chain forward; persist `state.{load,save}` across restarts (Redis is the typical store). `load` and `save` are not a compare-and-set, so concurrent writers fork the chain: keep it to one writer, and use HMAC on serverless functions that scale out.

### 3. Multi-tenancy?

If the app is multi-tenant, **tenant isolation on every audit record is non-negotiable.** A query that mixes tenants is a privacy incident. Pass the tenant at the call site, where the handler already knows it:

```ts
await log.audit({ action: 'member.add', actor, target, tenantId: team.id })
```

An action that touches several tenants is one call per tenant. A record that lists several tenants leaks one customer's ids into another's trail.

When every audit of a request belongs to one tenant that the request itself names (a subdomain per workspace), `auditEnricher({ tenantId: ctx => resolveTenant(ctx) })` fills it instead. The resolver sees `ctx.request` and `ctx.headers`, not the request's wide event. Never resolve it from a header the client controls.

Then filter every read on `audit.tenantId`: the list API, exports and relays. Use one drain per tenant only when hard isolation is required.

### 4. Stored before or after the response?

| You write | Stored | Costs |
| --- | --- | --- |
| `await log.audit(...)` | Before the handler continues | The drain's write time, on the response |
| `void log.audit(...)` | After the response, kept alive with `waitUntil` | A crash in that window loses the record |

Await it when anything reads the trail right after the action (an activity UI, an e2e test). An audit store batched through `createDrainPipeline` resolves when the batch is queued, not written: write to the store directly when the record must exist before the response.

### 5. Do customers need their trail?

Enterprise customers ask for their audit log in their own SIEM. Store every record first, then forward each tenant's records with `relayAudit`, which moves a cursor through your store and stops at the first failure without moving it:

```ts
import { relayAudit } from 'evlog'
import { sendAuditWebhook } from 'evlog/webhook'

const result = await relayAudit({
  cursor: destination.cursor,
  read: (after, limit) => db.audit.readTeam(destination.teamId, after, limit),
  send: records => sendAuditWebhook(records, { url: destination.url, secret: destination.secret }),
  save: next => db.auditDestinations.moveCursor(destination.id, destination.cursor, next),
})
if (result.error) await db.auditDestinations.markFailing(destination.id, result.error)
```

Messages are signed [Standard Webhooks](https://www.standardwebhooks.com). The receiver checks them with `verifyWebhook(rawBody, headers, secret)` and dedupes on the returned record's `id`. The app keeps scheduling, backoff, notifications and refusing internal URLs. With a database sequence as the cursor, `read` leaves out rows written in the last few seconds, since concurrent inserts commit out of order.

### 6. Retention

Pick a window per drain and document it. Enforce at the drain layer, not in app code, because the drain already has audited mechanisms for it (lifecycle policies, `DELETE` jobs, dataset retention).

| Framework | Typical retention                                                   |
| --------- | ------------------------------------------------------------------- |
| SOC2      | 1 year minimum, 7 years recommended                                 |
| HIPAA     | 6 years                                                             |
| PCI DSS   | 1 year (3 months immediately accessible)                            |
| GDPR      | "As long as necessary" (see "GDPR vs append-only" below)           |

How to enforce per drain:

- **FS**: `createFsDrain({ maxFiles })` + a daily compactor.
- **Postgres**: `DELETE FROM audit_events WHERE timestamp < now() - interval '7 years'` on a cron.
- **Axiom / Datadog / Loki**: dataset-level retention policy.

### 7. GDPR vs append-only

The right to be forgotten collides with audit immutability. Recommended pattern:

1. Keep audit rows immutable and chain-verified.
2. Encrypt PII fields (email, name, IP) with a per-actor key held outside the audit store.
3. To "forget" a user, delete their key. The audit row stays, the chain stays valid, the PII becomes unreadable (crypto-shredding).

A built-in `cryptoShredding` helper is on the roadmap; until then, encrypt in a custom enricher.

## Step-by-step buildout

### Step 1: Wire the pipeline (one-time)

The wiring shape is the same in every framework: a main drain, plus your audit store wrapped in `auditOnly()`. `log.audit()` records `requestId`, `traceId`, IP and user agent itself, so no enricher is required.

The minimal Nuxt / Nitro setup looks like this:

```ts
// server/plugins/evlog.ts
import { auditOnly, signed } from 'evlog'
import { createAxiomDrain } from 'evlog/axiom'
import { createFsDrain } from 'evlog/fs'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createAxiomDrain({ dataset: 'logs' }))
  nitroApp.hooks.hook('evlog:drain', auditOnly(
    signed(createFsDrain({ dir: '.audit/' }), { strategy: 'hash-chain' }),
  ))
})
```

Wrap only stores you control in `auditOnly`: it receives emails, IPv4 addresses and phone numbers unmasked. Every other drain gets them masked.

For Hono, Express, Next.js, or standalone scripts / workers, see [`references/framework-wiring.md`](references/framework-wiring.md). The pattern is identical. Only the framework integration helper changes.

### Step 2: Define the action vocabulary

Audits get queried and alerted on by `audit.action`. A typo is a missing alert, so centralise the list. For a bounded context with several actions, prefer a catalog: one prefix, typed keys, autocomplete on the wire format `${prefix}.${KEY}`:

```ts
// app/audit/billing.ts
import { defineAuditCatalog } from 'evlog'

export const billingAudit = defineAuditCatalog('billing', {
  INVOICE_REFUND: { target: 'invoice' },
  PLAN_CHANGE:    { target: 'subscription' },
})
```

At the call site: `await log.audit(billingAudit.INVOICE_REFUND({ actor, target, tenantId }))`.

Add the opt-in `declare module 'evlog' { interface RegisteredAuditCatalogs { billing: typeof billingAudit } }` augmentation to get autocomplete everywhere. For one-off actions that don't fit a catalog, `defineAuditAction` still works:

```ts
// app/audit/actions.ts
import { defineAuditAction } from 'evlog'

export const InvoiceRefund = defineAuditAction('invoice.refund', { target: 'invoice' })
export const ApiKeyRevoke  = defineAuditAction('apiKey.revoke',  { target: 'apiKey' })
```

Catalog conventions and scaling recipes (folder per domain, npm packages per bounded context): https://www.evlog.dev/learn/catalogs

Naming conventions:

- `noun.verb` (`invoice.refund`, not `refundInvoice`).
- Past tense if the audit is logged after the fact (`invoice.refunded`); present tense when wrapped by `withAudit()` (which resolves the outcome itself).
- Lowercase, dot-delimited, no spaces: for hand-written action ids (`defineAuditAction`, inline `log.audit`). Catalog entries follow the catalog convention instead: UPPER_SNAKE_CASE keys under a lowercase prefix, producing wire actions like `billing.INVOICE_REFUND`. That is intentional. Do not lowercase the keys.

### Step 3: Instrument call sites

Three patterns, in order of preference:

**A. Wrap the action with `withAudit()`.** Pure audit-worthy actions (refund, delete, role change, password reset). Outcome resolution is automatic, so you can't forget to log a denial or failure:

```ts
import { withAudit, AuditDeniedError } from 'evlog'

export const refundInvoice = withAudit(
  {
    action: 'invoice.refund',
    target: ({ id }: { id: string }) => ({ type: 'invoice', id }),
  },
  async ({ id }, ctx) => {
    if (!ctx.actor) throw new AuditDeniedError('Anonymous refund denied')
    return db.invoices.refund(id)
  },
)
```

Outcome resolution:

- `fn` resolves: `outcome: 'success'`.
- `fn` throws `AuditDeniedError` (or any error with `status === 403`): `outcome: 'denied'`, and the error message becomes `reason`.
- Any other thrown error: `outcome: 'failure'`, then re-thrown.

`withAudit` records through standalone `audit()`, so pass `tenantId` and `correlationId: requestId` in its context argument.

**B. Manual `log.audit()` inside a handler.** Use it when the audit is one of several decisions in a larger handler, or when you need to emit before the action completes:

```ts
const log = useLogger(event)

if (!user.canRefund(invoice)) {
  await log.audit.deny('Insufficient permissions', {
    action: 'invoice.refund',
    actor: { type: 'user', id: user.id },
    target: { type: 'invoice', id: invoice.id },
    tenantId: invoice.orgId,
  })
  throw createError({ status: 403 })
}

const after = await db.invoices.refund(invoice.id)

await log.audit({
  action: 'invoice.refund',
  actor: { type: 'user', id: user.id, email: user.email },
  target: { type: 'invoice', id: after.id },
  tenantId: invoice.orgId,
  changes: auditDiff(invoice, after),
})
```

**C. Standalone `audit()` for jobs / scripts.** No request, no logger. Same shape, no request context. In a Nuxt or Nitro app it goes through the `evlog:drain` hooks. Await it so the process does not exit first:

```ts
import { audit } from 'evlog'

await audit({
  action: 'cron.cleanup',
  actor: { type: 'system', id: 'cron' },
  target: { type: 'job', id: 'cleanup-stale-sessions' },
  metadata: { deleted: 42 },
})
```

### Step 4: Add denial coverage

Auditors care most about denials, because they're how you prove the policy is actually being enforced. Every authorisation check should have a paired `log.audit.deny()`. Pulling the deny into a single helper guarantees coverage parity with successes:

```ts
function authorize(actor, action, resource) {
  const allowed = policy.check(actor, action, resource)
  if (!allowed) {
    void useLogger().audit.deny(`Policy denied ${action}`, {
      action,
      actor,
      target: { type: resource.type, id: resource.id },
    })
    throw createError({ status: 403 })
  }
}
```

### Step 5: Redact

The `auditOnly` store keeps emails, IPv4 addresses and phone numbers, and every other drain gets them masked. Paths, `secrets`, custom patterns, and the credential and card maskers apply to both. Apply `auditRedactPreset` (or merge it into the existing `RedactConfig`). It redacts HTTP auth headers and common credential field names (`password`, `token`, `apiKey`, `cardNumber`, `cvv`, `ssn`, plus `cookie` / `set-cookie`) at any nesting depth, including inside `audit.changes.before` / `audit.changes.after`:

```ts
import { initLogger, auditRedactPreset } from 'evlog'

initLogger({
  redact: {
    paths: [...(auditRedactPreset.paths ?? [])],
  },
})
```

### Step 6: Test it

`mockAudit()` captures every record `log.audit()`, `audit()` and `withAudit()` make, as soon as the call is made, without going through any drain. Make the denial test mandatory in code review, because untested denial paths are the most common cause of audit gaps:

```ts
import { mockAudit } from 'evlog'

it('refunds the invoice and records an audit', async () => {
  const captured = mockAudit()

  await refundInvoice({ id: 'inv_889' }, { actor: { type: 'user', id: 'u1' } })

  expect(captured.events).toHaveLength(1)
  expect(captured.toIncludeAuditOf({
    action: 'invoice.refund',
    target: { type: 'invoice', id: 'inv_889' },
    outcome: 'success',
  })).toBe(true)

  captured.restore()
})

it('denies refund for non-owners and records the denial', async () => {
  const captured = mockAudit()

  await expect(refundInvoice({ id: 'inv_889' }, { actor: null })).rejects.toThrow()

  expect(captured.toIncludeAuditOf({
    action: 'invoice.refund',
    outcome: 'denied',
  })).toBe(true)

  captured.restore()
})
```

### Step 7: Production readiness checklist

Walk through this with a security stakeholder before declaring the system production-ready (the same checklist powers the review mode below):

- [ ] The audit store is wrapped in `auditOnly()` and keyed on `audit.id`.
- [ ] `log.audit()` is awaited wherever the trail is read right after the action.
- [ ] Every authorisation check has a paired `log.audit.deny()` (greppable).
- [ ] Every mutating endpoint either uses `withAudit()` or calls `log.audit()` explicitly.
- [ ] At least two drains: one queryable (Axiom / Postgres) and one tamper-evident (FS + `signed` hash-chain, or S3 Object Lock).
- [ ] `auditRedactPreset` (or stricter) is in the global `RedactConfig`.
- [ ] Retention policy is documented per drain and enforced at the drain layer.
- [ ] Multi-tenant apps: `tenantId` is set on every audit event; queries always filter by tenant.
- [ ] Hash-chain `state.{load,save}` persists across process restarts (file / Redis / Postgres), with a single writer.
- [ ] Customer destinations: relayed from the store with a cursor per destination; registered URLs refuse internal addresses.
- [ ] HMAC `secret` rotation procedure is documented; `keyId` is embedded in `AuditFields` (extend via `declare module`).
- [ ] Tests include a denial path for every privileged action.
- [ ] Audit dataset access is itself logged. Meta-auditing matters.

## Review an existing audit setup

When the user already has an audit system and wants it reviewed, work through the four passes below in order. Each pass tells you exactly what to grep, what to look for, and what to flag.

### Pass 1: Pipeline wiring

Find where the logger is initialised and where drains / enrichers are registered:

```bash
rg -n "initLogger|defineNitroPlugin|createLogger|evlog:enrich|evlog:drain" --type ts
rg -n "auditEnricher|auditOnly|signed\(|relayAudit|createWebhookDrain" --type ts
```

Flag if:
- An audit-only drain exists but is not wrapped in `auditOnly(...)` → main events leak into the audit dataset (privacy & cost incident), and the stored records have emails and IPs masked.
- `auditOnly(...)` wraps a third-party drain the app does not control → that vendor receives unmasked emails and IPs.
- `auditOnly(drain, { await: true })` → the option is gone in evlog 3; every `log.audit()` call already waits for every drain.
- Only one drain → no tamper-evident copy. Acceptable only if the single drain is WORM (S3 Object Lock, BigQuery append-only, Postgres immutable).
- `signed()` is used without a persisted `state` while running multiple processes → hash-chain breaks across restarts / instances.
- The audit store is batched through `createDrainPipeline` while handlers rely on `await log.audit()` → the await resolves at enqueue, before the write.

### Pass 2: Coverage (call sites)

Inventory every mutating action and every authorisation check:

```bash
rg -n "log\.audit\(|log\.audit\.deny\(|withAudit\(|^.*audit\(" --type ts
rg -n "createError\(.*403|throw .*Forbidden|status:\s*403|statusCode:\s*403" --type ts
rg -n "(?i)\b(delete|update|create|refund|grant|revoke|promote|demote|reset|impersonate)\b.*async\s+function|defineEventHandler" --type ts
```

On Nuxt, Nitro, Next.js, TanStack Start, Hono, Express, Fastify, Effect, or an eve agent, you can also run `npx evlog map --no-write`, whose `audit` / `audit-coverage` checks flag sensitive routes that log nothing. Useful as a second pass; keep the greps above for denials and actor shape, which the CLI does not fully cover.

For each match, check:
- Mutating endpoint without a `log.audit()` or `withAudit()` → coverage gap.
- `403` / `Forbidden` thrown without a paired `log.audit.deny()` → silent denial. This is the single most common gap.
- `actor: { type: 'user', id: 'cron' }` or hard-coded actors in cron / queue handlers → wrong `actor.type`. Should be `'system'`, `'api'`, or `'agent'`.
- `actor.id` set to a session id or token instead of the stable user id → forensic ambiguity.
- `log.set({ audit: ... })` instead of `log.audit()` → makes no audit record: `auditOnly` drains skip it.
- `tenantId` missing on records in a multi-tenant app, or one record for several tenants → tenant isolation gap.
- Reads of `audit.context.tenantId` or `audit.idempotencyKey` → evlog 2 fields; evlog 3 has `audit.tenantId` and `audit.id`.
- `withAudit()` action name in present tense (`invoice.refund`) is fine; manual `log.audit()` after the fact should use past tense (`invoice.refunded`).

### Pass 3: Redaction & integrity

```bash
rg -n "auditRedactPreset|RedactConfig|paths:\s*\[" --type ts
rg -n "auditDiff\(" --type ts
rg -n "strategy:\s*['\"](?:hmac|hash-chain)" --type ts
```

Flag if:
- `auditRedactPreset` is not merged into the global redact config → `Authorization`, `Cookie`, `password`, `token`, `apiKey`, `cardNumber`, `cvv`, `ssn` may leak through `audit.changes`.
- `auditDiff()` is called on objects containing PII fields not listed in `redactPaths` → leak in the patch payload.
- HMAC `secret` is hard-coded or read from `process.env.SECRET` without a rotation plan / `keyId` → events become unverifiable after rotation.
- Hash-chain `state` is in-memory only → chain restarts each process boot, breaking continuity.

### Pass 4: Tests

```bash
rg -n "mockAudit\(|toIncludeAuditOf\(" --type ts
```

Flag if:
- No tests use `mockAudit()` → audit pipeline silently drifts unnoticed.
- Tests only assert success outcomes → denial paths can rot. Every privileged action should have at least one denied-outcome test.
- Tests assert against `RegExp` actions broadly → typos in `audit.action` slip through (an action typo is a missing alert in production).

### Reporting the findings

Group findings by severity for the user:

- **P0 (blocker)**: missing `auditOnly` wrap on an audit drain, missing `auditRedactPreset`, denials not logged, no tamper-evident drain in a regulated context.
- **P1 (compliance gap)**: missing tenant isolation, hash-chain state not persisted, no HMAC rotation, no denial test coverage.
- **P2 (hygiene)**: action naming inconsistency, in-line actor objects (should use `defineAuditAction`), missing `causationId` / `correlationId` on chained operations.

Then map each finding to the relevant step in the buildout above (e.g. P0 → Step 5 redact, P1 → Step 7 checklist) so the fix is unambiguous.

## Common pitfalls

- **Logging only successes.** Auditors care most about denials. Pair `log.audit()` with `log.audit.deny()` on every negative branch of every check.
- **Leaking PII through `changes`.** `auditDiff()` runs through `RedactConfig`, but only if the field paths are listed. Add `password`, `token`, `apiKey` once globally so it's never a per-call-site decision.
- **Treating audits as observability.** Don't downsample or summarise audit events downstream. evlog never samples them, but a vendor's retention or sampling rules can still drop them.
- **Conflating `actor.id` with the session id.** `actor.id` is the stable user id (or system identity); correlate sessions via `context.requestId` / `context.traceId`.
- **Forgetting standalone jobs.** Cron, queue workers, CLIs trigger audit-worthy actions too, use `audit()` or `withAudit()`.
- **Faking the actor type.** `actor.type: 'user'` for cron jobs gets flagged in audits. Use `'system'`, `'api'`, or `'agent'` accurately.
- **Single global secret with no rotation.** HMAC keys must rotate; without a `keyId`, old events become unverifiable after rotation.
- **One drain that fails takes audits down.** Drains must fail in isolation. Separate `evlog:drain` hooks and `composeDrains([...])` from `evlog/toolkit` do this; a hand-written `Promise.all` must not throw on a single rejection.

## Glossary

- **Action**: `audit.action`, the verb-on-noun identifier (`invoice.refund`).
- **Actor**: who/what performed the action (`user`, `system`, `api`, `agent`).
- **Target**: the resource the action was performed on.
- **Outcome**: `success`, `failure`, or `denied`.
- **Id**: `audit.id`, a UUIDv7 unique per record; the primary key that makes retried writes safe.
- **Tenant**: `audit.tenantId`, the organization, team or workspace the record belongs to.
- **On behalf of**: `actor.onBehalfOf`, the user a token, agent or impersonating admin acted for.
- **Causation id**: id of the action that caused this one (admin action → system reactions).
- **Correlation id**: shared by every action in one logical operation.
- **Hash-chain**: each event's `prevHash` matches the previous event's `hash`, forming a verifiable sequence.

## Reference

- Per-framework wiring (Hono, Express, Next.js, standalone): [`references/framework-wiring.md`](references/framework-wiring.md)
- Docs: [Audit logs overview](https://www.evlog.dev/use-cases/audit/overview). Source at [`apps/docs/content/5.use-cases/4.audit/`](https://github.com/evloghq/evlog/tree/main/apps/docs/content/5.use-cases/4.audit/)
- Source: [`packages/evlog/src/audit.ts`](https://github.com/evloghq/evlog/tree/main/packages/evlog/src/audit.ts)
- Tests: [`packages/evlog/test/core/audit.test.ts`](https://github.com/evloghq/evlog/tree/main/packages/evlog/test/core/audit.test.ts)
