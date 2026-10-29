import { definePlugin } from 'nitro'
import type { DrainContext } from '../../../../src/types'
import { results } from '../delayed-error-hook'

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (_error, { event }) => {
    const result = results.get(event?.req.headers.get('x-test-delayed-error') ?? '')
    if (result) result.finished = true
  })

  nitroApp.hooks.hook('evlog:drain', (ctx: DrainContext) => {
    if (process.env.EVLOG_TEST_LOG !== '1') return
    console.log('[TEST:DRAIN]', JSON.stringify({
      eventLevel: ctx.event.level,
      hasHeaders: !!ctx.headers,
      headerKeys: ctx.headers ? Object.keys(ctx.headers).sort() : [],
      hasAuthHeader: ctx.headers ? 'authorization' in ctx.headers : false,
      hasCookieHeader: ctx.headers ? 'cookie' in ctx.headers : false,
      hasUserAgent: ctx.headers ? 'user-agent' in ctx.headers : false,
      requestPath: ctx.request?.path,
      requestMethod: ctx.request?.method,
      hasEnrichment: 'customEnrichment' in ctx.event,
      enrichmentValue: (ctx.event as { customEnrichment?: unknown }).customEnrichment,
    }))
  })
})
