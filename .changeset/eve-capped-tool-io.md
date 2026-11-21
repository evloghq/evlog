---
"@evlog/eve": minor
---

Tool inputs and outputs in `gen_ai.tools` are now previews. Under `record: 'debug'` or a tool rule, each recorded value is redacted, then kept whole when its JSON fits in 2,000 characters and cut to the start of its JSON past that, with `output_truncated: true`. Every recorded value carries `input_size` or `output_size`, its length before the cut. A tool rule sets the limit per field: `{ output: { maxLength: 8000 } }` for a longer preview, `{ output: 'full' }` for the whole value. Before, a subagent's reply or a large tool result was copied into the event whole.
