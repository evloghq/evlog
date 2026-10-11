---
'@evlog/cli': patch
---

`evlog agents` and `evlog init` now pass explicit `--agent` targets to `npx skills add`: `claude-code` and `codex`. Codex keeps the canonical copy (`.agents/skills`, or `~/.agents/skills` with `--global`) and Claude Code gets a symlink to it, so the skills are no longer copied into every detected agent directory. `cursor` is no longer targeted explicitly. Skills already installed are still detected in every agent directory and either scope.
