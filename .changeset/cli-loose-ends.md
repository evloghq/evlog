---
"@evlog/cli": minor
---

The CLI now requires Node 22 or later. `--cwd <dir>` is accepted by every command, not only `doctor`, `map`, `init` and `agents`. `evlog --help` no longer loads any command module, and `tinyglobby` is replaced by Node's own `fs.globSync`, so the install carries one fewer dependency tree.
