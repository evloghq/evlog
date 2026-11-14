---
'evlog': patch
---

`defineEvlogHook()` from `evlog/eve` now reads the v27 session events of eve 0.84 and later, eve 1.0 included. Before, it listened for the v26 names, which those versions refuse, so `eve build` failed with `Hook "hooks/evlog.ts" handles "message.received" was removed in session stream version 27`. The hook now registers the v26 names only on eve 0.83 and earlier. A turn now ends on `turn.settled` and a session on `session.ended`. Token usage comes from `usage.recorded`, tool calls from `call.requested` and `call.settled`, approvals and sign-ins from `interaction.opened` and `interaction.settled`, and the user message from `delivery.consumed`. The v26 events of eve 0.30 to 0.83 keep working.

eve 0.84 moved AI SDK runtime context from the `step.started` instrumentation event to OTel integrations, so `defineEvlogInstrumentation()` only applies before 0.84. On 0.84 and later, add `agent/instrumentation/evlog.ts` exporting `otelIntegration({ runtimeContext: evlogRuntimeContext })`, with `otelIntegration` from `eve/instrumentation/otel`. `evlogRuntimeContext` accepts that input, and returns nothing for a model attempt outside a turn instead of throwing.
