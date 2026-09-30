<!---
☝️ PR title should follow conventional commits (https://conventionalcommits.org)
Here are the available types and scopes:


### Types
- breaking (fix or feature that would cause existing functionality to change) 💥
- feat (a non-breaking change that adds functionality) ✨
- fix (a non-breaking change that fixes an issue) 🐞
- build (changes that affect the build system or external dependencies) 🏗
- ci (changes to our CI configuration files and scripts) 🚀
- docs (updates to the documentation or readme) 📖
- enhancement (improving an existing functionality) 🌈
- chore (updates to the build process or auxiliary tools and libraries) 📦
- perf (a code change that improves performance) ⚡️
- style (changes that do not affect the meaning of the code) 💅
- test (adding or updating tests) 🧪
- refactor (a code change that neither fixes a bug nor adds a feature) 🛠
- revert (reverts a previous commit) 🔄

### Scopes
Omit the scope when the change is cross-cutting or repo-wide. Use a scope only
to point at one subsystem; the whole monorepo is `evlog`, so `evlog` is not a
scope.

- ai (AI SDK integration)
- axiom (Axiom drain adapter)
- bench (benchmarks)
- better-auth (Better Auth integration)
- better-stack (Better Stack drain adapter)
- clickhouse (ClickHouse drain adapter)
- cli (`@evlog/cli` package)
- core (logger, pipeline, error, redact, catalog internals)
- datadog (Datadog drain adapter)
- deps (the dependencies)
- docs (the documentation site)
- dx (developer experience improvements)
- elysia (Elysia plugin)
- evals (Evi eval suite)
- eve (eve agent integration)
- evi (Evi agent)
- express (Express middleware)
- fastify (Fastify plugin)
- fs (File System drain adapter)
- hono (Hono middleware)
- hyperdx (HyperDX drain adapter)
- loki (Grafana Loki drain adapter)
- nestjs (NestJS middleware)
- next (Next.js integration)
- nitro (Nitro plugin)
- nuxt (Nuxt module)
- orpc (oRPC integration)
- otlp (OTLP drain adapter)
- playground (the playground app)
- posthog (PostHog drain adapter)
- react-router (React Router integration)
- release (release workflow / publishing)
- repo (the repository: tooling, CI, scripts, root config)
- sentry (Sentry drain adapter)
- signals (`@evlog/signals` package)
- stream (in-process stream + stream server)
- sveltekit (SvelteKit integration)
- tanstack-start (TanStack Start integration)
- telemetry (`@evlog/telemetry` package)
- vite (Vite plugin)
- workers (Cloudflare Workers adapter)
-->

### 🔗 Linked issue

<!-- If it resolves an open issue, please link the issue here. For example "Resolves #123" -->

### 📚 Description

<!-- Describe your changes in detail -->
<!-- Why is this change required? What problem does it solve? -->

### 📝 Checklist

<!-- Put an `x` in all the boxes that apply. -->
<!-- If your change requires a documentation PR, please link it appropriately -->
<!-- If you're unsure about any of these, don't hesitate to ask. We're here to help! -->

- [ ] I have linked an issue or discussion.
- [ ] I have updated the documentation accordingly.
