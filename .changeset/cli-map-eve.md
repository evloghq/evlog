---
"@evlog/cli": minor
---

`evlog map` scores eve agents. It lists the tools, schedules (TypeScript or Markdown) and channels of the agent in `agent/` or of each `agents/<name>/agent/` in a workspace, and the tools of each declared subagent, as the new `tool`, `schedule` and `channel` kinds. A mount of `@evlog/eve` in the agent's `extensions/` passes `wide-event` for every one of them, and `useLogger()` from `@evlog/eve/logger` in a tool counts for `context`, `audit` and the other logger checks. Schedules and channels are checked on `wide-event` only. A declared subagent and each workspace member need a mount of their own.
