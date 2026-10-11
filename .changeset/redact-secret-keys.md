---
'evlog': minor
'@evlog/cli': patch
---

Redact secrets by key name. A new `secrets` built-in, on by default with the other built-ins, replaces the value of any key ending in `password`, `passwd`, `secret` or `token` (case-insensitive, at any depth) with `replacement`. So `password`, `newPassword`, `client_secret` and `accessToken` no longer reach production logs, while counters such as `totalTokens` and `tokensPerSecond` are kept. Values are replaced in full, booleans and `null` are left alone, and listing `builtins` without `'secrets'` turns it off. `evlog config` lists `secrets` among the built-ins.
