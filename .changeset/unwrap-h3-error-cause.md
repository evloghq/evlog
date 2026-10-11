---
'evlog': patch
---

Stop wide events from repeating the whole error under `error.cause` when h3 wraps a thrown error. h3 keeps the original error as `cause` and copies its message and stack, so every error event carried the message, stack and payload twice. evlog now serializes the original error once and keeps the h3 status fields (`statusCode`, `statusMessage`, `data`). A `cause` that is a different error is still kept.
