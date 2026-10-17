---
"evlog": patch
---

A logged error no longer carries the `data` or `internal` fields that its own `toJSON` leaves out, on the server and in the browser, whether passed as `log.error(err)` or inside an event. Its name, message, stack, cause and status fields are still logged. `EvlogError` keeps `internal`, since its `toJSON` shapes the HTTP response, not the log.

On the server, an object that defines `toJSON` inside a `log.*({ ... })` event is now serialized by that method even when it holds an `Error`. It used to be copied into a plain object to serialize the Error, which dropped `toJSON` and sent the fields it leaves out.
