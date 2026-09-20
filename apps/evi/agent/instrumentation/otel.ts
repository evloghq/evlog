import { otel } from 'eve/instrumentation/otel'

/**
 * Process-wide OpenTelemetry policy, shared by every destination. Prompts,
 * responses and tool payloads carry third-party GitHub and Linear content and
 * never leave the agent, so destinations receive metadata only. Widen it per
 * destination, deliberately, once its retention and access are known.
 */
export default otel({
  tracePolicy: () => ({
    emit: true,
    recordInputs: false,
    recordOutputs: false,
  }),
})
