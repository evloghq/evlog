---
'evlog': patch
---

Widen the optional `nitro` peer range so that `nitro@3.0.261103-rc` and stable Nitro 3 releases such as `nitro@3.0.0` install without a peer conflict. Before, npm failed with ERESOLVE and pnpm printed a peer warning when a project used either with evlog 2.x.
