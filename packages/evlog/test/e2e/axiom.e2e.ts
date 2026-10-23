/**
 * E2E test for the Axiom adapter.
 *
 * Two modes depending on token capabilities:
 *   1. Full round-trip (send → query back via APL → assert) when the token
 *      has the `query:read` scope (Personal Access Token, requires AXIOM_ORG_ID).
 *   2. Smoke only (assert ingest doesn't throw) when the token is ingest-only.
 *
 * The mode is detected at runtime by a preflight APL query.
 *
 * Required env vars:
 *   - AXIOM_API_KEY
 *   - AXIOM_DATASET
 *   - AXIOM_ORG_ID (required for Personal Access Tokens, optional otherwise)
 */
import { randomUUID } from 'node:crypto'
import { beforeAll, expect, it } from 'vitest'
import { sendBatchToAxiom } from '../../src/adapters/axiom'
import { describeIfEnv, itWithCorrelationId, makeEvent, readEnv } from './_shared'

const AXIOM_API_BASE = 'https://api.axiom.co'

interface AplResponse {
  tables?: Array<{
    fields?: Array<{ name: string }>
    columns?: unknown[][]
  }>
}

async function queryApl(
  apiKey: string,
  apl: string,
  orgId: string | undefined,
): Promise<AplResponse> {
  // Look back 15 minutes — well above ingestion lag, well below quota.
  const endTime = new Date()
  const startTime = new Date(endTime.getTime() - 15 * 60 * 1000)

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (orgId) headers['X-Axiom-Org-Id'] = orgId

  const response = await fetch(`${AXIOM_API_BASE}/v1/datasets/_apl?format=tabular`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      apl,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Axiom APL query failed: ${response.status} ${response.statusText} ${body.slice(0, 200)}`)
  }

  return response.json() as Promise<AplResponse>
}

function rowCount(response: AplResponse): number {
  return response.tables?.[0]?.columns?.[0]?.length ?? 0
}

describeIfEnv('axiom e2e', ['AXIOM_API_KEY', 'AXIOM_DATASET'], () => {
  const apiKey = readEnv('AXIOM_API_KEY')!
  const dataset = readEnv('AXIOM_DATASET')!
  const orgId = readEnv('AXIOM_ORG_ID')
  let canQuery = false

  beforeAll(async () => {
    canQuery = await tokenCanQuery(apiKey, dataset, orgId)
    if (!canQuery) {
      console.warn(
        '[axiom e2e] token cannot query (missing query:read scope or AXIOM_ORG_ID) — '
        + 'falling back to smoke-only. Use a Personal Access Token with '
        + 'query:read and set AXIOM_ORG_ID to enable round-trip assertions.',
      )
    }
  })

  itWithCorrelationId('ingest endpoint accepts a single event', async () => {
    const correlationId = randomUUID()
    const event = makeEvent('axiom-single', {
      action: 'e2e_single_event',
      e2e_correlation_id: correlationId,
    })

    await expect(
      sendBatchToAxiom([event], { apiKey, dataset, orgId }),
    ).resolves.toBeUndefined()

    if (!canQuery) return
    const apl = `['${dataset}'] | where ['e2e_correlation_id'] == "${correlationId}" | limit 5`
    const found = await pollFor(apiKey, apl, orgId, { timeoutMs: 60_000 })
    expect(rowCount(found)).toBeGreaterThanOrEqual(1)
  }, 90_000)

  itWithCorrelationId('ingest endpoint accepts a multi-level batch', async () => {
    const batchId = randomUUID()
    const events = (['info', 'warn', 'error'] as const).map((level, idx) =>
      makeEvent('axiom-batch', {
        level,
        action: `e2e_batch_${idx}`,
        e2e_correlation_id: `${batchId}-${idx}`,
        e2e_batch_id: batchId,
        nested: { count: idx, ratio: idx + 0.5 },
      }),
    )

    await expect(
      sendBatchToAxiom(events, { apiKey, dataset, orgId }),
    ).resolves.toBeUndefined()

    if (!canQuery) return
    const apl = `['${dataset}'] | where ['e2e_batch_id'] == "${batchId}" | limit 10`
    const found = await pollFor(apiKey, apl, orgId, { timeoutMs: 60_000 })
    expect(rowCount(found)).toBe(events.length)
  }, 90_000)

  it('rejects an obviously invalid token with a clear error', async () => {
    await expect(
      sendBatchToAxiom([makeEvent('axiom-invalid-auth')], {
        apiKey: 'xaat-invalid-token-for-e2e',
        dataset,
        orgId,
      }),
    ).rejects.toThrow()
  }, 30_000)
})

/**
 * Run a trivial APL query to detect whether the configured token has
 * `query:read`. Ingest-only tokens come back with HTTP 403; PATs with read
 * access come back with 200.
 */
async function tokenCanQuery(
  apiKey: string,
  dataset: string,
  orgId: string | undefined,
): Promise<boolean> {
  try {
    await queryApl(apiKey, `['${dataset}'] | limit 1`, orgId)
    return true
  } catch {
    return false
  }
}

async function pollFor(
  apiKey: string,
  apl: string,
  orgId: string | undefined,
  options: { timeoutMs: number },
): Promise<AplResponse> {
  const deadline = Date.now() + options.timeoutMs
  let lastResponse: AplResponse | null = null
  while (Date.now() < deadline) {
    lastResponse = await queryApl(apiKey, apl, orgId)
    if (rowCount(lastResponse) > 0) return lastResponse
    await new Promise(resolve => setTimeout(resolve, 3_000))
  }
  throw new Error(
    `Axiom APL query returned no rows within ${options.timeoutMs}ms — query: ${apl}`,
  )
}
