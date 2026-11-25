import { createAxiomDrain } from 'evlog/axiom'
// import { createPostHogDrain } from 'evlog/posthog'
// import { createSentryDrain } from 'evlog/sentry'
// import { createBetterStackDrain } from 'evlog/better-stack'
// import { createDatadogDrain } from 'evlog/datadog'
import { auditOnly, signed } from 'evlog'
import { createFsDrain } from 'evlog/fs'

export default defineNitroPlugin((nitroApp) => {
  // Main drain: every wide event lands here. In a real app this would be Axiom,
  // Datadog, PostHog, etc. — observability storage with sampling and 30-90 day retention.
  const main = createFsDrain()
  const axiom = createAxiomDrain()

  // Audit sink: tamper-evident, append-only, only receives the records
  // `log.audit()` makes, with emails and IPs kept. `signed({ strategy: 'hash-chain' })`
  // adds prevHash + hash so the sequence is verifiable. A handler that awaits
  // `log.audit()` waits for this write before it responds.
  const auditSink = auditOnly(signed(createFsDrain({ dir: '.audit/' }), { strategy: 'hash-chain' }))

  nitroApp.hooks.hook('evlog:drain', async (ctx) => {
    await Promise.all([main(ctx), axiom(ctx), auditSink(ctx)])
  })
})
