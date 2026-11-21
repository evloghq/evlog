import type { SignalInput } from './define'
import { defineSignal } from './define'

function describeError(e: SignalInput): string | undefined {
  const error = e.error as { name?: unknown, message?: unknown } | undefined
  if (error && typeof error === 'object') return JSON.stringify(['error', String(error.name ?? 'Error'), String(error.message ?? '')])
  if (typeof e.message === 'string') return JSON.stringify(['log', typeof e.tag === 'string' ? e.tag : null, e.message])
  return undefined
}

/**
 * Triage for errors logged in the browser and sent through the ingest
 * endpoint: was it our code, the network, something injected into the page,
 * or the browser itself. Events sharing an error name and message share one
 * verdict, so a flood of the same `Failed to fetch` costs one call.
 *
 * Client events arrive unauthenticated: register it on its own
 * `createSignals` instance so its calls draw on their own budget. Server
 * signals still see ingested events, which can carry any `status`; give them
 * `e.source !== 'client'` in `when` to keep a flood off their budget too.
 *
 * @example
 * ```ts
 * createSignals({ name: 'client-signals', signals: [clientFault], budget: { perMinute: 60 } })
 * ```
 */
export const clientFault = defineSignal({
  name: 'client-fault',
  when: e => e.source === 'client' && (e.level === 'error' || e.level === 'fatal'),
  ask: 'What caused this error reported from a user\'s browser?',
  choice: {
    'app': 'A bug in our own front-end code, or our own API answering with something the page did not expect',
    'network': 'The device was offline, a request timed out, was aborted, or was blocked before reaching a server',
    'third-party': 'A browser extension, an ad blocker, an injected script, or an external widget or SDK on the page',
    'browser': 'An old or unusual browser, a missing API, a storage quota, private browsing restrictions',
  },
  cacheKey: describeError,
})
