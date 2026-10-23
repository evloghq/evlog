---
"evlog": major
---

Remove the `evlog/browser` entry. It was deprecated in 2.x and re-exported `evlog/http` under other names. Import from `evlog/http` instead:

```diff
- import { createBrowserDrain, createBrowserLogDrain } from 'evlog/browser'
+ import { createHttpDrain, createHttpLogDrain } from 'evlog/http'
```

The types follow the same rename: `BrowserDrainConfig` is `HttpDrainConfig`, `BrowserLogDrainOptions` is `HttpLogDrainOptions`.
