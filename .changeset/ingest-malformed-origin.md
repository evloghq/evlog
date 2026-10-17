---
"evlog": patch
---

Fix the Nuxt client ingest endpoint (`/api/_evlog/ingest`) answering 500 to a request whose `Origin` is `null`, as sandboxed iframes send, or whose `Referer` is not a URL. It now answers 403, like any other origin that does not match the host.
