/**
 * E2E test for the sandbox Grafana: the datasources and dashboard that
 * `docker-compose.yml` provisions read what the Loki and ClickHouse drains write.
 *
 * Every query goes through Grafana's own query API (`/api/ds/query`), so a
 * provisioning mistake, a plugin that fails to install, or a dashboard query
 * that drifts from the ClickHouse schema fails here instead of on someone's
 * screen.
 *
 *   pnpm run sandbox:up
 *   pnpm run sandbox:e2e
 *
 * Required env vars:
 *   - GRAFANA_ENDPOINT (the sandbox runs anonymous admin, so no credentials)
 *   - LOKI_ENDPOINT and CLICKHOUSE_ENDPOINT, the backends that Grafana reads
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { sendBatchToClickHouse } from '../../src/adapters/clickhouse'
import { sendBatchToLoki } from '../../src/adapters/loki'
import { describeIfEnv, itWithCorrelationId, makeEvent, pollUntil, readEnv } from './_shared'

const LOKI = { type: 'loki', uid: 'evlog-loki' }
const CLICKHOUSE = { type: 'grafana-clickhouse-datasource', uid: 'evlog-clickhouse' }
const DASHBOARD_UID = 'evlog-wide-events'

interface Frame { data?: { values?: unknown[][] } }
interface QueryResult { status?: number, error?: string, frames?: Frame[] }

describeIfEnv('grafana e2e (sandbox)', ['GRAFANA_ENDPOINT', 'LOKI_ENDPOINT', 'CLICKHOUSE_ENDPOINT'], () => {
  const grafana = readEnv('GRAFANA_ENDPOINT')!
  const loki = { endpoint: readEnv('LOKI_ENDPOINT')! }
  const clickhouse = { endpoint: readEnv('CLICKHOUSE_ENDPOINT')!, table: 'evlog_events' }
  const dashboard = JSON.parse(readFileSync(join(__dirname, 'grafana-dashboards/wide-events.json'), 'utf8')) as {
    panels: { title: string, targets?: Record<string, unknown>[] }[]
  }
  const sqlTarget = dashboard.panels.flatMap(panel => panel.targets ?? []).find(target => typeof target.rawSql === 'string')!

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(new URL(path, grafana), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`Grafana ${path} answered ${res.status}: ${body}`)
    return JSON.parse(body) as T
  }

  /** One query through the datasource, as a dashboard panel would run it. */
  async function query(datasource: { type: string, uid: string }, target: Record<string, unknown>): Promise<QueryResult> {
    const body = await api<{ results: Record<string, QueryResult> }>('/api/ds/query', {
      method: 'POST',
      body: JSON.stringify({
        from: String(Date.now() - 3_600_000),
        to: String(Date.now() + 60_000),
        queries: [{ ...target, refId: 'A', datasource }],
      }),
    })
    return body.results.A!
  }

  const firstValue = (result: QueryResult) => result.frames?.[0]?.data?.values?.[0]?.[0]

  beforeAll(async () => {
    await pollUntil(
      async () => (await fetch(new URL('/api/health', grafana)).catch(() => null))?.ok ? true : null,
      { timeoutMs: 60_000, intervalMs: 1_000, label: 'grafana-health' },
    )
  }, 70_000)

  it('provisions both datasources and they reach their backend', async () => {
    for (const { uid } of [LOKI, CLICKHOUSE]) {
      const health = await api<{ status: string, message: string }>(`/api/datasources/uid/${uid}/health`)
      expect(health.status, `${uid}: ${health.message}`).toBe('OK')
    }
    const provisioned = await api<{ dashboard: { uid: string } }>(`/api/dashboards/uid/${DASHBOARD_UID}`)
    expect(provisioned.dashboard.uid).toBe(DASHBOARD_UID)
  }, 30_000)

  itWithCorrelationId('reads an event the drains wrote, through both datasources', async () => {
    const event = makeEvent('grafana-roundtrip', { method: 'GET', path: '/api/grafana-e2e', status: 200 })
    const id = event.e2e_correlation_id
    await sendBatchToLoki([event], loki)
    await sendBatchToClickHouse([event], clickhouse)

    await pollUntil(async () => {
      const result = await query(LOKI, { expr: `{service="evlog-e2e"} |= "${id}"`, queryType: 'range', maxLines: 10 })
      return JSON.stringify(result.frames ?? []).includes(id) ? result : null
    }, { timeoutMs: 30_000, intervalMs: 1_000, label: 'grafana-loki' })

    const rows = await pollUntil(async () => {
      const result = await query(CLICKHOUSE, { ...sqlTarget, rawSql: `SELECT count() FROM evlog_events WHERE position(data, '${id}') > 0` })
      if (result.error) throw new Error(result.error)
      return Number(firstValue(result)) === 1 ? result : null
    }, { timeoutMs: 30_000, intervalMs: 1_000, label: 'grafana-clickhouse' })
    expect(Number(firstValue(rows))).toBe(1)
  }, 90_000)

  it('runs every dashboard query against the ClickHouse schema', async () => {
    await sendBatchToClickHouse([makeEvent('grafana-dashboard', { method: 'POST', path: '/api/checkout', status: 500 })], clickhouse)

    const targets = dashboard.panels.flatMap(panel => (panel.targets ?? []).map(target => ({ panel: panel.title, target })))
    expect(targets.length).toBeGreaterThan(0)
    for (const { panel, target } of targets) {
      // `$service` is a dashboard variable, which the browser fills in before the query reaches Grafana.
      const rawSql = String(target.rawSql).replaceAll('$service', `'evlog-e2e'`)
      const result = await query(CLICKHOUSE, { ...target, rawSql })
      expect(result.error, `panel "${panel}"`).toBeUndefined()
      expect(result.frames?.length, `panel "${panel}" returned no frame`).toBeGreaterThan(0)
    }
  }, 60_000)
})
