---
'@evlog/cli': minor
---

`evlog agents` and `evlog init` now install the agent skills globally by default, for `universal` (the shared `.agents/skills` directory that Codex and the other agents read) and `claude-code` (a symlink into it). Pass `--local` to install into the project instead, with `.agents/skills` and `.claude/skills` at the project root.

Breaking: `--global` is removed, since global is now the default. `evlog agents` no longer writes `CLAUDE.md`. Most agents read `AGENTS.md` directly, and Claude Code does too unless a `CLAUDE.md` sits above it. Add a one-line `@AGENTS.md` yourself if you want one; an existing `CLAUDE.md` is left alone.
