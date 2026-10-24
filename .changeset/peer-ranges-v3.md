---
"evlog": major
---

Two optional peer ranges change:

- `eve` goes from `>=0.30.0` to `>=0.72.0`. `evlog/eve` no longer supports eve releases older than 0.72.
- `nitro` goes from `^3.0.260311-beta` to `>=3.0.0-0 <4.0.0-0`. The old range did not cover the later dated Nitro 3 betas such as `3.0.260903-beta`, and the new one covers every Nitro 3 beta and release without letting in Nitro 4.

The open-ended ranges stay open: `@nestjs/common` and `@nestjs/core` (`>=11.2.7`), `react-router` (`>=7.18.4`) and `hono` (`>=4.13.12`) accept new majors. evlog's own tests now run on NestJS 12, React Router 8, eve 0.83 and the latest Nitro 3 beta. `nitropack ^2.13.4` and `h3 ^1.15.11` are unchanged.
