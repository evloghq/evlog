import { strict as assert } from 'node:assert'
import { definePlugin } from 'nitro'
import type { HTTPEvent } from 'nitro/h3'
import evlogPlugin from '../../../src/nitro-v3/plugin'
import { useLogger } from '../../../src/nitro-v3/useLogger'
import { EVLOG_FILE_CONFIG_KEY } from '../../../src/shared/fileConfig'
import type { RequestLogger } from '../../../src/types'
import { results } from './delayed-error-hook'

type StartMarker = { markStarted: (path: string) => void }
type FinishRecord = { path: string; status?: number; emitted: boolean; error?: string; startedFor?: unknown }
export const finished: FinishRecord[] = []

export default definePlugin(async (nitroApp) => {
  // Stands in for the plugins of an `evlog.config.ts`, which the evlog module hands over this way.
  (globalThis as Record<symbol, unknown>)[Symbol.for(EVLOG_FILE_CONFIG_KEY)] = {
    plugins: [
      {
        name: 'request-hooks',
        extendLogger(logger: RequestLogger) {
          (logger as RequestLogger & StartMarker).markStarted = path => logger.set({ startedFor: path })
        },
        onRequestStart({ logger, request }: { logger: RequestLogger, request: { path: string } }) {
          (logger as RequestLogger & StartMarker).markStarted(request.path)
        },
        onRequestFinish({ logger, request, status, event, error }: { logger: RequestLogger, request: { path: string }, status?: number, event: unknown, error?: Error }) {
          finished.push({ path: request.path, status, emitted: event !== null, error: error?.message, startedFor: logger.getContext().startedFor })
        },
      }
    ],
  }
  await evlogPlugin(nitroApp)

  const requests = new Map<unknown, HTTPEvent>()
  nitroApp.hooks.hook('request', (event) => {
    if (event.url.searchParams.has('earlier-error')) {
      if (event.url.searchParams.has('resume-during-keep')) requests.set(useLogger(event).getContext().requestId, event)
      throw new Error('request hook failed')
    }
    const id = event.req.headers.get('x-test-error-during-keep')
    if (!id) return
    results.set(id, { events: [], warnings: [], finished: false, releases: [], pendingErrors: 0 })
    requests.set(useLogger(event).getContext().requestId, event)
  })

  nitroApp.hooks.hook('evlog:emit:keep', async (ctx) => {
    const event = requests.get(ctx.context.requestId)
    if (!event) return
    requests.delete(ctx.context.requestId)
    if (event.url.searchParams.has('resume-during-keep')) {
      const result = results.get(event.req.headers.get('x-test-delayed-error') ?? '')
      const release = result?.releases.shift()
      assert.ok(release)
      release()
      await new Promise(resolve => setImmediate(resolve))
      return
    }
    await Promise.resolve()
    nitroApp.captureError(new Error('captured during sampling'), { event })
  })

  nitroApp.hooks.hook('error', (_error, { event }) => {
    const id = event?.req.headers.get('x-test-delayed-error') ?? event?.req.headers.get('x-test-error-during-keep')
    const result = results.get(id ?? '')
    if (result) {
      if (result.pendingErrors) result.pendingErrors--
      result.finished = result.pendingErrors === 0
    }
  })
})
