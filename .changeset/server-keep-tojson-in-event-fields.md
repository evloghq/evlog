---
"evlog": patch
---

On the server, an object that defines `toJSON` inside a `log.*({ ... })` event is now serialized by that method even when it holds an `Error`. It used to be copied into a plain object to serialize the Error, which dropped `toJSON` and sent the fields it leaves out.
