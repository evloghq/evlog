# evlog + eve — Support refund demo

A **support copilot** for a fake SaaS ("Clearbill"). A rep asks for a refund → the agent looks up the customer and order → issues the refund (with **human approval** when amount > $100).

Each completed turn emits **one evlog wide event** with the full story: customer, order, refund, audit trail, token usage, and tool outcomes. That's the point of the demo — not abstract `tenantId` fields.

## The story

> "Acme Corp was double-charged on order #4821 ($890). Issue a refund."

1. `lookup_customer` → attaches `customer.{id, plan, mrr}` to the wide event  
2. `lookup_order` → attaches `order.{id, amount, product}`  
3. `issue_refund` → **approval UI** (amount > $100) → attaches `refund` + `audit.refund.issued`

Finance opens PostHog (or your drain) and gets **one JSON object** per turn — no log scavenger hunt.

### Example wide event (after approval)

```json
{
  "service": "clearbill-support-agent",
  "method": "EVE",
  "path": "/sessions/sess_…/turns/turn_…",
  "status": 200,
  "customer": {
    "id": "cust_8f2a",
    "slug": "acme-corp",
    "name": "Acme Corp",
    "plan": "enterprise",
    "mrr": 2400
  },
  "order": {
    "id": "4821",
    "amount": 890,
    "currency": "USD",
    "product": "Enterprise — annual add-on (5 seats)"
  },
  "refund": {
    "orderId": "4821",
    "amount": 890,
    "reason": "Double charge",
    "requiresApproval": true
  },
  "audit": {
    "action": "refund.issued",
    "actor": { "type": "agent", "id": "clearbill-support-copilot" },
    "target": { "type": "order", "id": "4821" },
    "outcome": "success"
  },
  "gen_ai": { "calls": 3, "tools": […] }
}
```

Compare with order **#1102** ($49) — same flow, **no approval** (under the $100 threshold).

## Run

From the monorepo root (Turbo runs dev:prepare so `evlog` and `@evlog/eve` resolve):

```bash
pnpm install
pnpm run example:eve
```

Open **http://localhost:3000** and click a starter prompt, or paste your own.

### Local or deployed: two named commands

Both open eve's terminal UI. The title bar says which agent answers and which logs its `logs` tool reads, for the whole session:

| Command | Talks to | The logs tool reads |
| --- | --- | --- |
| `pnpm dev:local` | the agent running on this machine (`eve dev`) | `.evlog/logs` |
| `pnpm dev:remote` | the deployed agent at `EVE_REMOTE_URL` | the Vercel project's runtime logs, through `vercel/evlog` |

`dev:remote` reads `EVE_REMOTE_URL`, and `VERCEL_AUTOMATION_BYPASS_SECRET` when the deployment has protection on, from `.env.local`. Neither goes in a prompt. The URL has to be `https` with no credentials in it, and `--url` or `--header` on the command line are refused, so the target stays the one in `.env.local`. The secret never reaches the command line: eve reads it from the environment and sends it only once the target is the deployment it checked.

The example's channel signs nobody in from a production browser: `placeholderAuth()` refuses them until you replace it with your own auth. When you do, the `logs` tool gives each signed-in caller the turns of the session it posts to, and eve does not check that the session is theirs; see [who reads what](https://evlog.dev/use-cases/eve) before letting several users share the deployment.

The events panel on http://localhost:3000 reads `.evlog/logs` through `/api/demo/logs`, which answers only under `next dev`. A build answers 404.

To have the local agent read the deployed agent's logs instead, set `logs: { source: 'vercel' }` in `agent/extensions/evlog.ts` and run `vercel env pull` first: it writes the project's `VERCEL_OIDC_TOKEN`, which pins reads to that project. Check the whole path without changing anything:

```bash
npx evlog setup vercel --check
```

Requires `POSTHOG_API_KEY` in the repo root `.env` for the drain (events still log to stdout without it).

## Files

| Path | Role |
| --- | --- |
| `agent/instructions.md` | Support copilot persona + fake CRM table |
| `agent/lib/support-data.ts` | Acme Corp & Startup Inc fake data |
| `agent/tools/lookup_*.ts` | CRM lookups → `useLogger()` |
| `agent/tools/issue_refund.ts` | Refund + approval gate + audit fields |
| `agent/extensions/evlog.ts` | Wide event per turn, tail-keep on failed tools and large refunds |
| `agent/instrumentation/evlog.ts` | Puts each turn's `traceId` and `spanId` on its event (`npx evlog setup eve` writes it) |
| `scripts/remote.mjs` | `pnpm dev:remote`: opens the deployed agent, labelled |

Docs: https://evlog.dev/use-cases/eve
