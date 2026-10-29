import { definePlugin } from 'nitro'
import type { DrainContext } from '../../../../src/types'

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', (ctx: DrainContext) => {
    if (process.env.EVLOG_TEST_LOG !== '1') return
    console.log('[TEST:DRAIN]', JSON.stringify({
      requestPath: ctx.request?.path,
      eventLevel: ctx.event.level,
      eventStatus: ctx.event.status,
      hasError: 'error' in ctx.event,
    }))
  })
})
