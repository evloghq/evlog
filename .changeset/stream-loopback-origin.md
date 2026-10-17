---
"evlog": patch
---

Fix the local stream server (`startStreamServer`, `stream: true` in Nuxt and Next.js) accepting browser pages from other sites when no `token` is set. It matched the `Origin` host by prefix, so a page on `https://localhost.example.com` could read the live events, and it never checked `Host`, so a page on a domain that resolves to `127.0.0.1` could too. Without a token, it now accepts a request only when `Host` is `localhost`, `127.0.0.1` or `[::1]` and `Origin`, if sent, names one of them exactly. The Nuxt discovery route `/api/_evlog/stream-info` no longer answers with `Access-Control-Allow-Origin: *`: it allows loopback origins only.
