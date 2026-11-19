---
"@evlog/eve": patch
---

The `eve` peer range is now `>=1.0.0` (was `*`), the floor the README and the docs already state. A package manager flags an eve 0.x install as an unmet peer, and npm 7 and later stops the install. Upgrade eve to 1.0 or later. The install commands use the `beta` tags until evlog 3.0 is stable.
