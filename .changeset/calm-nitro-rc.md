---
'evlog': patch
---

Widen the optional `nitro` peer range so that `nitro@3.0.261029-rc` installs without a peer conflict. Before, npm failed with ERESOLVE and pnpm printed a peer warning when a project used the Nitro release candidate with evlog 2.x.
