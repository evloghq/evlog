---
"@evlog/cli": minor
---

`evlog init --dry-run` prints a diff of every file the run would create or change, against the file as it is on disk: the framework config, the middleware module, `evlog.config.ts`, `.env.example`, the `AGENTS.md` block. When the run would install packages, it also prints the `package.json` change the install command makes, with each package at the tag it installs from. An interactive dry run shows one box per file. With `--json`, the diffs are in `preview`, one `{ file, kind, by?, diff }` entry per file.
