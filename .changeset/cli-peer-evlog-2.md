---
"@evlog/cli": patch
---

`@evlog/cli` now installs next to evlog 2.31 and later as well as 3.0 betas. Before, `npm i -D @evlog/cli@beta` in a project still on evlog 2.x failed with `ERESOLVE`, because the peer range only allowed 3.0 betas. The minimum is 2.31.0, the first 2.x release the CLI has been built against.
