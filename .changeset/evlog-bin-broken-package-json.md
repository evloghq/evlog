---
'evlog': patch
---

The `evlog` executable runs from a directory whose `package.json` does not parse. Before, it stopped with `ERR_INVALID_PACKAGE_CONFIG` before reaching the CLI.
