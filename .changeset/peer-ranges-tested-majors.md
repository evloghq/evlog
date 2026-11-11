---
"evlog": major
---

Three optional peer ranges stop at the majors evlog is tested on:

- `@nestjs/common` and `@nestjs/core` go from `>=11.2.8` to `^11.2.8 || ^12.0.0`.
- `react-router` goes from `>=7.18.5` to `^7.18.5 || ^8.0.0`.
- `hono` goes from `>=4.13.12` to `^4.13.12`. Hono 5 changes the `app.onError` handler to `(c, next)` with the error on `c.error`, so the range opens once Hono 5 is released and evlog's tests run on it.

NestJS 13, React Router 9 and Hono 5 now produce a peer warning until a release of evlog adds them.
