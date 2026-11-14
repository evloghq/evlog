---
"evlog": major
---

Three optional peer ranges stop at the majors evlog is tested on:

- `@nestjs/common` and `@nestjs/core` go from `>=11.2.8` to `^11.2.8 || ^12.0.0`.
- `react-router` goes from `>=7.18.5` to `^7.18.5 || ^8.0.0`.
- `hono` goes from `>=4.13.12` to `^4.13.12 || ^5.0.0-rc.1`. `evlog/hono` runs on Hono 4 and on the Hono 5 release candidates. Hono 5 calls `app.onError` as middleware, `(c, next)` with the error on `c.error`, so update your own error handler when you move to it.

NestJS 13, React Router 9 and Hono 6 now produce a peer warning until a release of evlog adds them.
