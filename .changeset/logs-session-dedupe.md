---
"@evlog/cli": minor
---

`evlog logs --session <id>` shows one AI conversation: the events whose `gen_ai.conversation.id` matches, such as an eve session's turns. `evlog logs` also shows an event delivered twice under the same `idempotencyKey` once, so a retried drain write no longer appears as two events.
