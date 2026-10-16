---
"@evlog/cli": minor
---

Add `evlog upgrade`, the v2 to v3 codemod, as a scaffold. It lists the deprecated names it will rewrite (`evlog/browser` to `evlog/http`, `token` and `sourceToken` to `apiKey`, `redactMessage` to `message`, `EvlogConfig` to `NitroPluginEvlogConfig`) and which ones need a manual change, such as the PostHog events drain and the token environment variables. The command changes no files yet; rewriting lands in a follow-up. Pass `--json` for the plan as machine-readable output.
