---
"evlog": minor
---

HyperDX and Sazabi now accept `semanticConventions`, and HyperDX also accepts `recordShape`, so a 2.x user can keep the 2.x output with `recordShape: 'json'` and `semanticConventions: false`. The defaults themselves changed in evloghq/evlog#933: both adapters now send the compact record shape with OpenTelemetry semantic conventions on.
