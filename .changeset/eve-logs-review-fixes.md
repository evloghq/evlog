---
"@evlog/eve": patch
---

- Every `logs` result stays under 24,000 characters of JSON, or 200,000 with `full: true`, list rows and session summaries included. A row that does not fit drops its `fields`, then all but its identifying keys, and names them in `omittedFields`. A `trace` event that does not fit is left out whole, and its trace and span ids stay in `traces`. The notes say whether `full: true` would help.
- On files, the read stops at the `window.until` it reports.
- `sessions` reports the newest failure and trace ids by timestamp, and sums only the token counts the turns reported.
- `diagnostics: true` records a call that failed before reading, such as one without an OIDC token.
