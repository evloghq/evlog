/**
 * E2E smoke test for the Better Stack adapter.
 *
 * The source token is write-only — to read events back you'd need a separate
 * team API token (a Live Tail token). Smoke only: assert the ingestion
 * endpoint accepts our payload format. If Better Stack ever changes the
 * required field names (`dt` for timestamps, etc.), the daily cron catches
 * it within 24h.
 *
 * Required env vars:
 *   - BETTER_STACK_API_KEY
 */
import { expect } from 'vitest'
import {
  sendBatchToBetterStack,
  toBetterStackEvent,
} from '../../src/adapters/better-stack'
import { describeIfEnv, itWithCorrelationId, makeEvent, readEnv } from './_shared'

describeIfEnv(
  'better-stack e2e (smoke)',
  ['BETTER_STACK_API_KEY'],
  () => {
    const apiKey = readEnv('BETTER_STACK_API_KEY')!
    const endpoint = readEnv('BETTER_STACK_ENDPOINT')

    itWithCorrelationId('ingest endpoint accepts info / warn / error logs', async () => {
      const events = (['info', 'warn', 'error'] as const).map(level =>
        makeEvent('better-stack-smoke', {
          level,
          message: `e2e ${level} log from evlog tests`,
        }),
      )

      await expect(
        sendBatchToBetterStack(events, { apiKey, endpoint }),
      ).resolves.toBeUndefined()
    }, 30_000)

    itWithCorrelationId('toBetterStackEvent maps timestamp to `dt`', async () => {
      const event = makeEvent('better-stack-shape', { action: 'shape_check' })
      const transformed = toBetterStackEvent(event)
      expect(transformed.dt).toBe(event.timestamp)
      expect(transformed.timestamp).toBeUndefined()

      await expect(
        sendBatchToBetterStack([event], { apiKey, endpoint }),
      ).resolves.toBeUndefined()
    }, 30_000)

    itWithCorrelationId('rejects an invalid source token', async () => {
      await expect(
        sendBatchToBetterStack(
          [makeEvent('better-stack-invalid-auth')],
          { apiKey: 'invalid-token-for-e2e', endpoint },
        ),
      ).rejects.toThrow()
    }, 30_000)
  },
)
