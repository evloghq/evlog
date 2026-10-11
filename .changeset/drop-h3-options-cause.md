---
'evlog': patch
---

Stop wide events from repeating an error made with h3's `createError({ statusCode, message })` under `error.cause`. h3 keeps that options object as `cause`, so the event carried the message and status code twice. evlog now drops the `cause` when it only restates fields the error already has, and keeps it when it carries anything else.
