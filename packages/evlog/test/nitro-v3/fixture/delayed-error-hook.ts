import { definePlugin } from 'nitro'
import type { DrainContext, WideEvent } from '../../../src/types'

interface DelayedErrorResult {
  events: WideEvent[]
  finished: boolean
  release: () => void
}

export const results = new Map<string, DelayedErrorResult>()

export default definePlugin((nitroApp) => {
  // Registered before evlog to hold its error hook until the response emits.
  nitroApp.hooks.hook('error', (_error, { event }) => {
    const id = event?.req.headers.get('x-test-delayed-error')
    if (!id) return
    return new Promise<void>((release) => {
      results.set(id, { events: [], finished: false, release })
    })
  })

  nitroApp.hooks.hook('evlog:drain', (ctx: DrainContext) => {
    const result = results.get(ctx.headers?.['x-test-delayed-error'] ?? '')
    if (!result) return
    result.events.push(ctx.event)
    result.release()
  })
})
