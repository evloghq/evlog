---
"evlog": patch
---

`log.audit()` and `log.audit.deny()` on a route left out by `include` or `exclude` now reach your drains. The filters only skip the request event: with the framework middleware each audit call drains as its own event with the request's method, path and `requestId`, and on Nuxt and Nitro the request event is emitted because it carries an audit. Before, these audits were dropped, and on most frameworks `useLogger()` threw on a filtered route.
