import { definePlugin } from 'nitro'
import { auditOnly, type WideEvent } from 'evlog'

export const drained: WideEvent[] = []

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', ({ event }) => {
    if (!event.audit) drained.push(event)
  })
  // Audit records reach the store as an app's audit table receives them, identities kept.
  nitroApp.hooks.hook('evlog:drain', auditOnly(({ event }) => {
    drained.push(event)
  }))
})
