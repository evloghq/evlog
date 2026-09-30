---
"evlog": patch
---

Measure `durationMs` before tail-sampling `keep` hooks run, so a hook that awaits I/O no longer inflates the request duration on the emitted event.
