---
"@evlog/eve": patch
---

The `evlog` peer range is now `^3.0.0-beta.4`. The extension redacts tool inputs and outputs with `redactEvent` from `evlog/toolkit`, which evlog exports from that release, instead of a copy of evlog's redaction bundled into the extension. Upgrade evlog with `pnpm add evlog@beta`.
