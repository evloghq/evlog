---
"evlog": minor
---

The Better Stack adapter now sends a `message` on every event, as Better Stack's own `@logtail/node` client does. Live tail headlines a line with it and Better Stack builds `_pattern` from it, so request events now group by pattern. An event without `message` gets the request summary and the error message, for example `POST /api/checkout (402) Payment failed`, or the service name when it has neither. A `message` already on the event, from a tagged log or `log.set({ message })`, is sent unchanged.
