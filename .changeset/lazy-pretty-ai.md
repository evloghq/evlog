---
"evlog": patch
---

The AI section of pretty output (`gen_ai.usage`, `gen_ai.tools`, `gen_ai.response`, ...) now loads on demand with the pretty-error formatter, so production bundles no longer contain it: about 3.6 kB minified and 1 kB gzipped less for an app that calls `initLogger()` and `log`. Pretty output is unchanged once it has loaded. An event with `gen_ai` logged in the same tick as `initLogger()` prints as soon as it has, and if the process exits before that, `gen_ai` prints as a plain field.
