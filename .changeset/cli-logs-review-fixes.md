---
"@evlog/cli": patch
---

- `evlog setup vercel` and `--check` read every page of `vercel connect list`, so a connector past the first 50 is found instead of reported missing.
- `evlog logs sessions` reports the newest failure and the newest trace ids whatever order the events were read in. Each token count sums only the turns that reported it, with `turnsReporting`, and a turn that reported only a cost no longer adds zero tokens.
- A read without `--until` stops at now, the end of the window it reports, so an event stamped ahead of the clock is left out. `--follow` is unchanged.
