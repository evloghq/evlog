---
'evlog': patch
---

Stop Nitro and Nuxt from printing an error a second time when evlog already records it. In production, an unhandled error or a `fatal` one produced both the wide event and Nitro's `[request error] [unhandled]` block with its stack. evlog's error handler now skips Nitro's default logging whenever the request has a wide event. Nitro still logs the error when evlog is disabled, the route is excluded, or the plugin is not registered.
