---
"evlog": patch
---

On Vercel, Nuxt and Nitro 2 apps now keep the function alive with Vercel's `waitUntil` while request events drain after the response. The Nitro 2 Vercel preset passes no `waitUntil` of its own, so a drain could be cut off when the function froze.
