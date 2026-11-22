import { auditOnly } from 'evlog'
import type { WideEvent } from '../../../../src/types'

export const drained: WideEvent[] = []

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', ({ event }) => {
    if (!event.audit) drained.push(event)
  })
  // Audit records reach the store as an app's audit table receives them, identities kept.
  nitroApp.hooks.hook('evlog:drain', auditOnly(({ event }) => {
    drained.push(event)
  }))
})
