---
"evlog": patch
---

`readFsLogs()` and `tailFsLogs()` from `evlog/fs` now read files the drain wrote with `pretty: true`, assembling each indented event, where they used to skip every line of them as malformed.
