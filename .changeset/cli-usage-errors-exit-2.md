---
'@evlog/cli': patch
---

Every command now stops on a flag it does not declare, and on a value flag passed with no value, with exit code 2. `evlog map --min-scor 90` used to run with no gate and exit 0, and `evlog init --dryrun` wrote files. A script that carries a mistyped flag today starts failing: fix the spelling.

The other usage errors exit 2 as well, as the README documents: an unknown command, an invalid `--min-score`, `--framework`, `--format` or `--limit`, and `evlog map <entry>` for an entry point that does not exist. An empty `--min-score`, which is what an unset shell variable expands to, is one of them. `evlog map --baseline --min-score 80` now reads both flags, where the bare `--baseline` used to take `--min-score` as its value. A `map` error is printed as JSON under `--format json`, as it already was under `--json`.
