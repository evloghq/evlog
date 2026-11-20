// A day of a shop with a support agent, for measuring `evlog logs --ask` at scale.
// Seeded, so a count or a ranking that moves is the code's doing, not the data's.
// `node ask-scale.mjs <dir> [events]` writes it as an fs drain sink.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `needle` marks a checkout that took payment and created no order, with status
 * 200: what no filter finds. `declined` marks a 402. Neither is on the event.
 */
export function scaleEvents(count = 10_000, seed = 1) {
  const next = random(seed)
  const int = (min, max) => min + Math.floor(next() * (max - min + 1))
  const pick = values => values[int(0, values.length - 1)]
  const start = Date.parse('2026-10-01T00:00:00.000Z')
  const events = []
  for (let i = 0; i < count; i++) {
    const base = {
      timestamp: new Date(start + Math.floor((i * 86_400_000) / count)).toISOString(),
      level: 'info',
      service: 'shop',
      environment: 'production',
      requestId: `req-${i.toString(36).padStart(6, '0')}`,
    }
    const kind = next()
    if (kind < 0.15) {
      const durationMs = int(1, 5)
      events.push({ event: { ...base, method: 'GET', path: '/api/health', status: 200, durationMs, duration: `${durationMs}ms` } })
    }
    else if (kind < 0.75) {
      const durationMs = int(8, 120)
      events.push({ event: { ...base, method: 'GET', path: '/api/items', status: 200, durationMs, duration: `${durationMs}ms`, user: { id: `usr_${int(1, 200)}` }, items: { count: int(1, 50) } } })
    }
    else if (kind < 0.9) {
      const durationMs = int(200, 900)
      const checkout = { ...base, method: 'POST', path: '/api/checkout', durationMs, duration: `${durationMs}ms`, user: { id: `usr_${int(1, 200)}` }, cart: { items: int(1, 4) }, payment: { provider: pick(['stripe', 'paypal']) } }
      const outcome = next()
      if (outcome < 0.06) {
        events.push({ declined: true, event: { ...checkout, level: 'error', status: 402, payment: { ...checkout.payment, status: 'declined' }, error: { name: 'Error', message: 'Payment processing failed', why: 'Card declined by issuer', stack: 'Error: Payment processing failed\n    at charge (src/pay.ts:41:11)\n    at checkout (src/checkout.ts:88:5)\n    at handler (src/routes/checkout.ts:12:3)\n    at process (node:internal/process:1:1)' } } })
      }
      else if (outcome < 0.1) {
        events.push({ needle: true, event: { ...checkout, status: 200, payment: { ...checkout.payment, status: 'captured' } } })
      }
      else {
        events.push({ event: { ...checkout, status: 200, payment: { ...checkout.payment, status: 'captured' }, order: { id: `ord_${i}` } } })
      }
    }
    else {
      const durationMs = int(2_000, 20_000)
      const tools = Array.from({ length: int(3, 30) }, (_, n) => ({
        name: pick(['lookup_customer', 'lookup_order', 'issue_refund']),
        call_id: `call_${i}_${n}`,
        success: true,
        input: JSON.stringify({ order: `ord_${int(1, 9999)}`, note: 'x'.repeat(int(50, 400)) }),
        output: JSON.stringify({ ok: true, detail: 'y'.repeat(int(100, 1500)) }),
      }))
      events.push({ event: { ...base, method: 'EVE', path: '/agents/support/turns', status: 200, durationMs, duration: `${durationMs}ms`, eve: { sessionId: `wrun_${int(1, 400)}`, outcome: 'completed' }, gen_ai: { usage: { input_tokens: int(2_000, 40_000), output_tokens: int(100, 2_000) }, tools } } })
    }
  }
  return events
}

if (import.meta.main) {
  const [dir, count] = process.argv.slice(2)
  if (!dir) throw new Error('usage: node ask-scale.mjs <dir> [events]')
  const logs = join(dir, '.evlog', 'logs')
  mkdirSync(logs, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'shop' }))
  writeFileSync(join(logs, '2026-10-01.jsonl'), `${scaleEvents(Number(count ?? 10_000)).map(({ event }) => JSON.stringify(event)).join('\n')}\n`)
}
