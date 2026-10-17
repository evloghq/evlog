---
"evlog": patch
---

`evlog/eve` reports `ai.model` and `ai.provider` again on eve 0.76, which moved the model id from `session.started` to `step.started`. The turn event carries the model of its last step, so a gateway fallback shows the model that served the turn. The `model` option and the `session.started` model are still used when no step reports one.

Subagent calls are recorded again in `eve.subagents` on eve 0.76, which no longer emits `subagent.*` events. evlog now reads the `subagent-call` and `remote-agent-call` actions and their results: each entry has the subagent name, the tool name, `status` (`called`, `completed` or `failed`), the duration and the error message. The subagent's output is not recorded, and a remote agent is marked `remote: true`. The `ai.tools` entry for a subagent call now measures its duration from the call instead of from the start of the step. Background tasks reported through `task.started` and `task.settled` are not tracked yet.
