---
"evlog": major
---

The AI block on wide events moves from `ai` to `gen_ai`, for `evlog/ai` and `evlog/eve`. Fields take the OpenTelemetry GenAI semantic convention names where the conventions define one (`gen_ai.request.model`, `gen_ai.provider.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.response.finish_reasons`), and evlog's own fields sit under the same key in snake_case (`gen_ai.calls`, `gen_ai.usage.cost`, `gen_ai.usage.estimated_cost`, `gen_ai.tools[].duration_ms`). `AILogger.getMetadata()` and `onUpdate` return the same shape. eve turn events also carry `gen_ai.conversation.id`, `gen_ai.agent.name` and `gen_ai.operation.name`.

Migrate queries, dashboards and alerts: `ai.model` becomes `gen_ai.request.model`, `ai.inputTokens` becomes `gen_ai.usage.input_tokens`, `ai.costUsd` becomes `gen_ai.usage.cost`, `ai.estimatedCost` becomes `gen_ai.usage.estimated_cost`, and `ai.finishReason` becomes the array `gen_ai.response.finish_reasons`. The full table is on the AI SDK metadata page. The OTLP drain now sends `gen_ai.usage.cache_write.input_tokens` instead of `gen_ai.usage.cache_creation.input_tokens`.
