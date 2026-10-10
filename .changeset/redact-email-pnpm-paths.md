---
'evlog': patch
---

Fix the built-in `email` redaction masking pnpm store paths in stack traces. Segments such as `node_modules/.pnpm/h3@1.15.11/...` were rewritten to `h***@***.11`, so drained `error.stack` values lost the package name and version. The email pattern now requires a letters-only top-level domain, so real addresses are still masked as `a***@***.com`.
