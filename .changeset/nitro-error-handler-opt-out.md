---
'evlog': minor
---

Add `errorHandler: false` to the `evlog/nuxt`, `evlog/nitro` and `evlog/nitro/v3` modules. evlog's Nitro error handler is then not registered, so your own Nitro `errorHandler` (or the framework's default) answers errors, and `why`, `fix` and `link` stay out of the response unless you put them there. Errors still reach the wide event. The default is unchanged.
