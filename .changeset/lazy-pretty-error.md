---
"evlog": patch
---

The pretty-error formatter (the `Why:` / `Fix:` / code-frame block in pretty output) now loads on demand with a dynamic `import()`, so production bundles no longer contain it: about 3.7 kB minified and 600 B gzipped less for an app that calls `initLogger()` and `log`. Pretty output is unchanged once the formatter has loaded. An error logged in the same tick as `initLogger()` prints as soon as it has, and if the process exits before that, it prints with the error message only.
