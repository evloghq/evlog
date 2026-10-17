---
"evlog": patch
---

A wide event no longer gets lost when the same plain object is logged as a field and then thrown as an error's `data`, for example `log.warn('failed', { error: payload })` followed by `throw createError({ data: payload })`. evlog used to keep the caller's object in the event and merge the error into it, which made the object contain itself. Redaction then overflowed the stack, and without redaction `JSON.stringify` threw. evlog now copies plain objects into the event, so it never writes into an object you passed in. The copy keeps `null` fields and a non-enumerable `toJSON`.

A `__proto__` key in logged fields, such as one from `JSON.parse` of a request body, is now stored as a field. It used to be merged into `Object.prototype`.
