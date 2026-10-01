---
'@evlog/cli': minor
---

`evlog init` now puts the drain credentials where they cannot be missed: when a chosen production destination reads environment variables that are set nowhere (neither the process nor the project's `.env`), the variable list becomes the first manual step, with what each variable is, where to put the value, and a link to the adapter docs. Variables that already exist are left out, and the separate `Set these before anything is received` note (interactive) and `SET BEFORE ANYTHING IS RECEIVED` block (non-interactive) are gone.