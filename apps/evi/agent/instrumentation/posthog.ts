import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { disableInstrumentation } from 'eve/instrumentation'
import { otelIntegration } from 'eve/instrumentation/otel'
import { evlogRuntimeContext } from 'evlog/eve'
import { environment } from '../lib/environment'
import { createPostHogAttributeProcessor } from '../lib/posthog-spans'

const projectToken = process.env.POSTHOG_API_KEY

/**
 * PostHog as an OpenTelemetry destination. Content capture is governed by the
 * process-wide policy in `./otel.ts`; this file only adds the exporter and the
 * per-attempt attributes PostHog groups traces by. Without a project token the
 * slot turns itself off instead of registering an exporter-less pipeline.
 */
export default projectToken
  ? otelIntegration({
    spanProcessors: [
      createPostHogAttributeProcessor(),
      new SimpleSpanProcessor(new PostHogTraceExporter({
        projectToken,
        ...(process.env.POSTHOG_HOST ? { host: process.env.POSTHOG_HOST } : {}),
      })),
    ],
    runtimeContext: (input) => {
      const caller = input.session.auth.current
      // Attributed to whoever opened the session, not to this turn's caller.
      const distinctId = input.session.auth.initiator?.principalId ?? caller?.principalId
      const evlog = evlogRuntimeContext(input)
      return {
        ...evlog,
        // PostHog keeps only `posthog_`-prefixed attributes, and strips the prefix.
        ...(evlog ? { posthog_evlog_request_id: evlog['evlog.request_id'] } : {}),
        ...(evlog ? { posthog_evlog_session_id: evlog['evlog.session_id'] } : {}),
        posthog_environment: environment(),
        // Omitted rather than blank: an empty attribute reads as an empty id.
        ...(distinctId ? { posthog_distinct_id: distinctId } : {}),
        ...(caller ? { 'caller.principal_id': caller.principalId } : {}),
        ...(caller ? { 'caller.principal_type': caller.principalType } : {}),
      }
    },
  })
  : disableInstrumentation()
