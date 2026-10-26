---
"@evlog/cli": minor
---

`evlog upgrade` rewrites `createPostHogEventsDrain(options)` to `createPostHogDrain({ mode: 'events', ...options })` and `PostHogEventsConfig` to `PostHogConfig`. It reports the function passed as a value, re-exported, or called with spread arguments, and leaves that binding as it was.
