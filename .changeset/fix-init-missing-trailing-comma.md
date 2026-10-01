---
"@evlog/cli": patch
---

Fix `evlog init` writing invalid config for Nuxt (and TanStack Start) when the last property of the config object has no trailing comma: two appended properties each added their own separator, producing `},,` that fails `nuxt prepare`. Properties appended at the same spot also landed in reverse order.