---
"@evlog/cli": patch
---

`evlog logs` exits 1 on an `evlog.config` it cannot read, like `evlog map` and `evlog config`. It exited 2, the code for a misused command. `evlog upgrade` and `--debug` are marked experimental in `--help` and the docs: the `upgrade` output and the debug case file may change in a 1.x release.
