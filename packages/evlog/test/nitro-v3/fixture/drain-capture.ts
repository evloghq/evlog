import { definePlugin } from 'nitro'
import { useLogger } from '../../../src/nitro-v3/useLogger'
import type { DrainContext, TailSamplingContext, WideEvent } from '../../../src/types'

interface Capture {
  emits: number
  events: WideEvent[]
  errorHooksDone: boolean
}

export const captures = new Map<string, Capture>()

/**
 * Call after evlog's plugin has registered its hooks, so this `error` hook runs after evlog's. Once it has
 * run and the response is returned, every emit is counted; a drain evlog deferred may still be in flight.
 */
export const captureDrains = definePlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const id = event.req.headers.get('x-test-capture')
    if (!id) return
    captures.set(id, { emits: 0, events: [], errorHooksDone: false })
    useLogger(event).set({ captureId: id })
  })

  nitroApp.hooks.hook('evlog:emit:keep', (ctx: TailSamplingContext) => {
    const capture = captures.get(String(ctx.context.captureId))
    if (capture) capture.emits++
  })

  nitroApp.hooks.hook('evlog:drain', (ctx: DrainContext) => {
    captures.get(String(ctx.event.captureId))?.events.push(ctx.event)
  })

  nitroApp.hooks.hook('error', (_error, { event }) => {
    const capture = captures.get(event?.req.headers.get('x-test-capture') ?? '')
    if (capture) capture.errorHooksDone = true
  })
})
