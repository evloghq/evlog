---
"@evlog/eve": minor
---

Each `gen_ai.tools` entry carries `call_id`, the `gen_ai.tool.call.id` of eve's `execute_tool` span for that call, so a failed call in the event points at its span in the trace. A failed call also carries the `code`, `why` and `fix` of the evlog error its tool threw, next to `error`.
