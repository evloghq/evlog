---
'evlog': minor
---

Add `errorHandler: false` to the `evlog/nuxt`, `evlog/nitro` and `evlog/nitro/v2` modules. evlog's Nitro error handler is then not registered, so your own Nitro `errorHandler` or the framework's default answers errors. The framework default can include the error's `data`, which carries `why`, `fix` and `link`, for example in development, so set your own `errorHandler` when they must stay private. Errors still reach the wide event. The default is unchanged.
