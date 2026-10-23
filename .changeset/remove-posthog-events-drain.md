---
"evlog": major
---

Remove `createPostHogEventsDrain()` and the `PostHogEventsConfig` type from `evlog/posthog`. Both were deprecated in 2.x. Use the main drain in events mode, which takes the same options:

```diff
- import { createPostHogEventsDrain } from 'evlog/posthog'
- initLogger({ drain: createPostHogEventsDrain({ eventName: 'server_request' }) })
+ import { createPostHogDrain } from 'evlog/posthog'
+ initLogger({ drain: createPostHogDrain({ mode: 'events', eventName: 'server_request' }) })
```

`PostHogEventsConfig` was an alias of `PostHogConfig`. `sendToPostHogEvents()` and `sendBatchToPostHogEvents()` are unchanged.
