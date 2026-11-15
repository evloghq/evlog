---
"evlog": minor
---

The Better Stack adapter now sends a `message`, as Better Stack's own `@logtail/node` client does. Live tail headlines a line with it and Better Stack builds `_pattern` from it, so request events now group by route. An event without `message` gets the headline the pretty console prints, followed by the error message, for example `POST /api/checkout 402 in 104ms Payment failed`. An event with nothing to headline gets no `message`. A `message` already on the event, from a tagged log or `log.set({ message })`, is sent unchanged.
