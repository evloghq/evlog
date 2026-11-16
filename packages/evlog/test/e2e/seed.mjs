/**
 * Fill the local sandbox with realistic wide events so you can browse them in
 * the provisioned Grafana dashboard.
 *
 * Events go through the real public API — `createRequestLogger()` + the actual
 * drains — so what you see is exactly what an instrumented app produces, not a
 * hand-written payload.
 *
 *   pnpm run sandbox:seed
 */
import { initLogger, createRequestLogger } from 'evlog'
import { createLokiDrain } from 'evlog/loki'
import { createClickHouseDrain } from 'evlog/clickhouse'

const LOKI = process.env.LOKI_ENDPOINT ?? 'http://localhost:3100'
const CLICKHOUSE = process.env.CLICKHOUSE_ENDPOINT ?? 'http://localhost:8123'
const COUNT = Number(process.env.SEED_COUNT ?? 40)
/** Total wall-clock the run is spread over, so the timeseries is not one spike. */
const SPREAD_MS = Number(process.env.SEED_SPREAD_MS ?? 120_000)

const loki = createLokiDrain({ endpoint: LOKI })
const clickhouse = createClickHouseDrain({ endpoint: CLICKHOUSE })

initLogger({
  env: { service: 'evlog-sandbox', environment: 'development' },
  pretty: false,
  silent: true,
  drain: async (ctx) => {
    await Promise.all([loki(ctx), clickhouse(ctx)])
  },
})

const ROUTES = [
  { method: 'GET', path: '/api/users', weight: 5 },
  { method: 'GET', path: '/api/orders', weight: 4 },
  { method: 'POST', path: '/api/checkout', weight: 3 },
  { method: 'POST', path: '/api/auth/login', weight: 2 },
  { method: 'GET', path: '/api/products/search', weight: 4 },
  { method: 'DELETE', path: '/api/sessions', weight: 1 },
]

const PLANS = ['free', 'pro', 'enterprise']
const REGIONS = ['cdg', 'iad', 'fra', 'sin']

const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const pickRoute = () => {
  const pool = ROUTES.flatMap(r => Array.from({ length: r.weight }, () => r))
  return pick(pool)
}

/** One request's worth of context, the way an instrumented handler builds it. */
async function emitRequest(index) {
  const route = pickRoute()
  const log = createRequestLogger({
    method: route.method,
    path: route.path,
    requestId: `seed-${Date.now()}-${index}`,
  })

  log.set({
    user: { id: `usr_${100 + Math.floor(Math.random() * 40)}`, plan: pick(PLANS) },
    region: pick(REGIONS),
    db: { queries: 1 + Math.floor(Math.random() * 6) },
  })

  // Actually spend time, so `duration` is a real measurement rather than 0ms.
  await new Promise(r => setTimeout(r, 5 + Math.floor(Math.random() * 60)))

  // ~12% errors, ~8% slow, rest healthy — enough variety to make dashboards useful.
  const roll = Math.random()
  if (roll < 0.12) {
    const failures = [
      { status: 500, name: 'DatabaseError', message: 'connection pool exhausted' },
      { status: 402, name: 'PaymentDeclined', message: 'card declined by issuer' },
      { status: 404, name: 'NotFound', message: 'order does not exist' },
      { status: 401, name: 'Unauthorized', message: 'token expired' },
    ]
    const failure = pick(failures)
    log.error(Object.assign(new Error(failure.message), { name: failure.name }))
    log.emit({ status: failure.status })
    return failure.status
  }

  if (roll < 0.20) {
    // A slow request: an extra beat on the clock makes p95 panels meaningful.
    await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 900)))
    log.set({ cache: { hit: false }, slowQuery: true })
    log.emit({ status: 200 })
    return 200
  }

  log.set({ cache: { hit: Math.random() > 0.4 } })
  log.emit({ status: route.method === 'POST' ? 201 : 200 })
  return 200
}

/**
 * Drains swallow their errors by design — a failing destination must never break
 * a request. That makes a silent "Done" the default when the sandbox is down, so
 * check the backends are actually reachable before claiming anything was seeded.
 */
async function preflight() {
  const checks = [
    ['Loki', `${LOKI}/ready`],
    ['ClickHouse', `${CLICKHOUSE}/ping`],
  ]
  const down = []
  for (const [name, url] of checks) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) down.push(`${name} (HTTP ${res.status})`)
    } catch {
      down.push(`${name} (unreachable at ${url})`)
    }
  }
  if (down.length > 0) {
    console.error(`\nCannot seed — backend not reachable: ${down.join(', ')}`)
    console.error('Start the sandbox first:  pnpm run sandbox:up\n')
    process.exit(1)
  }
}

await preflight()

console.log(`Seeding ${COUNT} wide events over ${Math.round(SPREAD_MS / 1000)}s`)
console.log(`  Loki       ${LOKI}`)
console.log(`  ClickHouse ${CLICKHOUSE}\n`)

const statuses = []
const gap = Math.max(0, Math.floor(SPREAD_MS / COUNT))
for (let i = 0; i < COUNT; i++) {
  statuses.push(await emitRequest(i))
  process.stdout.write(`\r  ${i + 1}/${COUNT}`)
  // Spread the run out so the Grafana timeseries has a shape, not one spike.
  await new Promise(r => setTimeout(r, gap))
}
process.stdout.write('\r')

// Drains are fire-and-forget from emit(); give them a beat to flush.
await new Promise(r => setTimeout(r, 1500))

const errors = statuses.filter(s => s >= 400).length
console.log(`Done — ${COUNT} events (${errors} errors, ${COUNT - errors} ok)\n`)
console.log('Browse them:')
console.log('  Dashboard  http://localhost:3001/d/evlog-wide-events')
console.log('  Explore    http://localhost:3001/explore  →  Loki: {service="evlog-sandbox"}')
