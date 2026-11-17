---
'evlog': minor
---

`createRequestLogger()` now accepts `operation` in its options and puts it on the wide event, so a task, queue worker or cron job can name itself at creation time: `createRequestLogger({ operation: 'billing:sync', requestId })`. It is the same field `log.fork()` sets on a child. Before, the option was not part of `RequestLoggerOptions` and a cast that passed it was silently dropped.
