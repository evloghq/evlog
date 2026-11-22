import { defineNitroPlugin } from 'nitropack/runtime'
import { auditOnly } from 'evlog'
import type { AuditFields, WideEvent } from '../../../../src/types'

/**
 * What the test reads: the audit store an app would write to, the request
 * events, and a gate the store waits on before it writes.
 */
export interface VercelFixtureState {
  audits: AuditFields[]
  requests: WideEvent[]
  gate: Promise<void>
}

export function fixtureState(): VercelFixtureState {
  const host = globalThis as { __evlogVercelFixture?: VercelFixtureState }
  host.__evlogVercelFixture ??= { audits: [], requests: [], gate: Promise.resolve() }
  return host.__evlogVercelFixture
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', ({ event }) => {
    if (!event.audit) fixtureState().requests.push(event)
  })
  nitroApp.hooks.hook('evlog:drain', auditOnly(async ({ event }) => {
    const state = fixtureState()
    await state.gate
    state.audits.push(event.audit as AuditFields)
  }))
})
