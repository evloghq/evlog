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

Requires `POSTHOG_API_KEY` in the repo root `.env` for the drain (events still log to stdout without it).

## Files

| Path | Role |
| --- | --- |
| `agent/instructions.md` | Support copilot persona + fake CRM table |
| `agent/lib/support-data.ts` | Acme Corp & Startup Inc fake data |
| `agent/tools/lookup_*.ts` | CRM lookups → `useLogger()` |
| `agent/tools/issue_refund.ts` | Refund + approval gate + audit fields |
| `agent/extensions/evlog.ts` | Wide event per turn, tail-keep on failed tools and large refunds |

Docs: https://evlog.dev/use-cases/eve
