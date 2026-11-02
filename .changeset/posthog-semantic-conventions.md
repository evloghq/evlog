---
"evlog": minor
---

PostHog logs mode now accepts `semanticConventions`, like HyperDX and Sazabi. It defaults to `true`, the v3 OTLP default. To keep the 2.x output, set `recordShape: 'json'` and `semanticConventions: false`.
