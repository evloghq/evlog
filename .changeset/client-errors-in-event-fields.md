---
"evlog": patch
---

In the browser, an `Error` inside an event field is now serialized the same way as `log.error(err)`, with `name`, `message`, `stack`, `cause` and fields such as `status` and `statusCode`, instead of being sent as `{}`. This covers the object form of the client `log.info/warn/error/...({ ... })` at any depth, as the server logger already does, so `log.error({ action: 'checkout', error })` keeps both the action and the error. An Error inside an error's own `cause` or `data` is serialized too, an object that defines `toJSON` is left to it, and an event whose level is not logged is not read.
