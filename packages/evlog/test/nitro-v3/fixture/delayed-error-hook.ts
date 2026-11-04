import { definePlugin } from 'nitro'
import type { DrainContext, WideEvent } from '../../../src/types'

interface DelayedErrorResult {
  events: WideEvent[]
  warnings: string[]
  finished: boolean
  releases: Array<() => void>
  pendingErrors: number
}

export const results = new Map<string, DelayedErrorResult>()

export default definePlugin((nitroApp) => {
  const { warn } = console
  console.warn = (...args) => {
    for (const result of results.values()) {
      result.warnings.push(args.join(' '))
    }
    warn(...args)
  }
  nitroApp.hooks.hook('close', () => {
    console.warn = warn
  })

  // Registered before evlog to hold its error hook until the response emits.
  nitroApp.hooks.hook('error', (_error, { event }) => {
    const id = event?.req.headers.get('x-test-delayed-error')
    if (!id) return
    const result = results.get(id) ?? { events: [], warnings: [], finished: false, releases: [], pendingErrors: 0 }
    result.pendingErrors++
    results.set(id, result)
    return new Promise<void>((release) => {
      result.releases.push(release)
    })
  })

  nitroApp.hooks.hook('evlog:drain', (ctx: DrainContext) => {
    const id = ctx.headers?.['x-test-delayed-error'] ?? ctx.headers?.['x-test-error-during-keep']
    const result = results.get(id ?? '')
    if (!result) return
    result.events.push(ctx.event)
    for (const release of result.releases) release()
    result.releases.length = 0
  })
})
