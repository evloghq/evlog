---
"evlog": major
---

Default redaction now detects credentials by value, not only by key name. Provider tokens are masked wherever they appear, including inside a longer string: GitHub (`ghp_`, `gho_`, `github_pat_` and the other GitHub prefixes), npm, Anthropic, OpenAI, Stripe, Slack and AWS key IDs. Before, a token logged under `apiKey` or inside a sentence passed through unchanged. Now `ghp_` followed by 36 characters is logged as `ghp_***`. A PEM private key block is masked whole and keeps only its header, and the password in a URL is masked: `postgres://user:hunter2@db` becomes `postgres://user:***@db`. The `secrets` key list also covers `apiKey`, `api_key`, `privateKey`, `credentials`, `authorization`, `dsn` and `connectionString`, while `cacheKey` and `idempotencyKey` are left alone. To drop the value detection, list the built-ins you want in `builtins` without `apiKeys`, `privateKey` and `urlPassword`. See the migration guide for the upgrade steps.
