---
"evlog": patch
"@evlog/cli": patch
"@evlog/signals": patch
"@evlog/telemetry": patch
---

The published packages no longer ship `.map` files. They pointed to `src/`, which is not part of the package, so they only added to the install size. `evlog` drops from 330 files (about 2.0 MB unpacked) to 178 files (about 865 KB). No runtime or API change.
