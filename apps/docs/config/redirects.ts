/**
 * 301 redirects for the documentation site.
 *
 * One entry per old URL. We deliberately do NOT redirect:
 * - `/build-on-top/*` (PR #332, merged 2026-05-09 — not yet indexed)
 * - `/logging/catalogs` (PR #325, merged 2026-05-08 — not yet indexed)
 *
 * Spread into `routeRules` from `nuxt.config.ts` to keep the config file
 * focused on actual configuration.
 */

type RouteRedirect = { redirect: { to: string, statusCode: 301 } }

const r = (to: string): RouteRedirect => ({ redirect: { to, statusCode: 301 } })

export const redirects: Record<string, RouteRedirect> = {
  // `/landing` is the content collection path behind the homepage (rendered at `/` via
  // `app/pages/index.vue`). No Vue page matches `/landing` itself, so it falls through to
  // the raw-markdown mirror and serves `text/markdown` — a near-duplicate of `/` that
  // Google crawls but (correctly) won't index. Send it to the real homepage instead.
  '/landing': r('/'),

  // Section landings (no slug → first child of new section)
  '/getting-started': r('/start/introduction'),
  '/logging': r('/learn/overview'),
  '/core-concepts': r('/learn/lifecycle'),
  '/frameworks': r('/integrate/frameworks/overview'),
  '/adapters': r('/integrate/adapters/overview'),
  '/enrichers': r('/use-cases/enrichers'),
  '/use-cases': r('/use-cases/overview'),
  '/use-cases/eve/overview': r('/use-cases/eve'),
  '/use-cases/telemetry': r('/use-cases/telemetry/overview'),

  // New section roots (no content index page — 404 without an explicit redirect)
  '/start': r('/start/introduction'),
  '/learn': r('/learn/overview'),
  '/cli': r('/cli/overview'),
  '/integrate': r('/integrate/overview'),
  '/reference': r('/reference/configuration'),
  '/examples': r('/integrate/frameworks/overview'),
  '/adapters/cloud': r('/integrate/adapters/overview'),
  '/adapters/self-hosted': r('/integrate/adapters/overview'),
  '/use-cases/audit': r('/use-cases/audit/overview'),

  // `evlog upgrade` findings and the runtime deprecation warnings link here with a
  // `#<codemod-slug>` fragment, so this URL outlives any move of the guide itself.
  '/migrate/v3': r('/reference/migrate-v3'),

  // Getting Started → Start + Reference
  '/getting-started/introduction': r('/start/introduction'),
  '/getting-started/installation': r('/start/installation'),
  '/getting-started/quick-start': r('/start/quick-start'),
  '/getting-started/agent-skills': r('/reference/agent-skills'),
  '/getting-started/vs-other-loggers': r('/reference/vs-other-loggers'),

  // Logging → Learn (the four logger concepts) + Use Cases (domain integrations)
  '/logging/overview': r('/learn/overview'),
  '/logging/simple-logging': r('/learn/simple-logging'),
  '/logging/wide-events': r('/learn/wide-events'),
  '/logging/structured-errors': r('/learn/structured-errors'),
  '/logging/client-logging': r('/use-cases/client-logging'),

  // Logging / AI SDK → Use Cases / AI SDK
  '/logging/ai-sdk': r('/use-cases/ai-sdk/overview'),
  '/logging/ai-sdk/overview': r('/use-cases/ai-sdk/overview'),
  '/logging/ai-sdk/usage': r('/use-cases/ai-sdk/usage'),
  '/logging/ai-sdk/options': r('/use-cases/ai-sdk/options'),
  '/logging/ai-sdk/metadata': r('/use-cases/ai-sdk/metadata'),
  '/logging/ai-sdk/telemetry': r('/use-cases/ai-sdk/telemetry'),

  // Logging / Better Auth → Use Cases / Better Auth
  '/logging/better-auth': r('/use-cases/better-auth/overview'),
  '/logging/better-auth/overview': r('/use-cases/better-auth/overview'),
  '/logging/better-auth/identify-user': r('/use-cases/better-auth/identify-user'),
  '/logging/better-auth/middleware': r('/use-cases/better-auth/middleware'),
  '/logging/better-auth/client-sync': r('/use-cases/better-auth/client-sync'),
  '/logging/better-auth/performance': r('/use-cases/better-auth/performance'),

  // Logging / Audit → Use Cases / Audit
  '/logging/audit': r('/use-cases/audit/overview'),
  '/logging/audit/overview': r('/use-cases/audit/overview'),
  '/logging/audit/schema': r('/use-cases/audit/schema'),
  '/logging/audit/recording': r('/use-cases/audit/recording'),
  '/logging/audit/pipeline': r('/use-cases/audit/pipeline'),
  '/logging/audit/compliance': r('/use-cases/audit/compliance'),
  '/logging/audit/recipes': r('/use-cases/audit/recipes'),

  // Core Concepts → Learn (the conceptual ones) + Reference (the operational ones)
  '/core-concepts/lifecycle': r('/learn/lifecycle'),
  '/core-concepts/sampling': r('/learn/sampling'),
  '/core-concepts/typed-fields': r('/learn/typed-fields'),
  '/core-concepts/redaction': r('/learn/redaction'),
  '/core-concepts/configuration': r('/reference/configuration'),
  '/core-concepts/performance': r('/reference/performance'),
  '/core-concepts/vite-plugin': r('/reference/vite-plugin'),
  '/core-concepts/best-practices': r('/reference/best-practices'),
  // Stale aliases that already redirected via nuxt.config.ts
  '/core-concepts/wide-events': r('/learn/wide-events'),
  '/core-concepts/structured-errors': r('/learn/structured-errors'),
  '/core-concepts/client-logging': r('/use-cases/client-logging'),
  '/core-concepts/ai-sdk': r('/use-cases/ai-sdk/overview'),

  // Frameworks → Integrate / Frameworks
  '/frameworks/overview': r('/integrate/frameworks/overview'),
  '/frameworks/nuxt': r('/integrate/frameworks/nuxt'),
  '/frameworks/nextjs': r('/integrate/frameworks/nextjs'),
  '/frameworks/sveltekit': r('/integrate/frameworks/sveltekit'),
  '/frameworks/nitro': r('/integrate/frameworks/nitro'),
  '/frameworks/tanstack-start': r('/integrate/frameworks/tanstack-start'),
  '/frameworks/nestjs': r('/integrate/frameworks/nestjs'),
  '/frameworks/express': r('/integrate/frameworks/express'),
  '/frameworks/hono': r('/integrate/frameworks/hono'),
  '/frameworks/fastify': r('/integrate/frameworks/fastify'),
  '/frameworks/elysia': r('/integrate/frameworks/elysia'),
  '/frameworks/react-router': r('/integrate/frameworks/react-router'),
  '/frameworks/cloudflare-workers': r('/integrate/frameworks/cloudflare-workers'),
  '/frameworks/standalone': r('/integrate/frameworks/standalone'),
  '/frameworks/astro': r('/integrate/frameworks/astro'),
  '/frameworks/aws-lambda': r('/integrate/frameworks/aws-lambda'),
  '/frameworks/custom-integration': r('/extend/custom-framework'),

  // /examples/* (legacy aliases that already redirected to /frameworks/*)
  '/examples/nextjs': r('/integrate/frameworks/nextjs'),
  '/examples/sveltekit': r('/integrate/frameworks/sveltekit'),
  '/examples/tanstack-start': r('/integrate/frameworks/tanstack-start'),
  '/examples/nestjs': r('/integrate/frameworks/nestjs'),
  '/examples/express': r('/integrate/frameworks/express'),
  '/examples/hono': r('/integrate/frameworks/hono'),
  '/examples/fastify': r('/integrate/frameworks/fastify'),
  '/examples/elysia': r('/integrate/frameworks/elysia'),
  '/examples/react-router': r('/integrate/frameworks/react-router'),

  // Adapters / Cloud → Integrate / Adapters / Cloud
  // OTLP and HyperDX moved out of `cloud/` — both self-host as readily as they
  // run managed, so they now sit under `hybrid/` alongside Loki and ClickHouse.
  // These two URLs were live and indexed, so they redirect rather than 404.
  '/integrate/adapters/cloud/otlp': r('/integrate/adapters/hybrid/otlp'),
  '/integrate/adapters/cloud/hyperdx': r('/integrate/adapters/hybrid/hyperdx'),

  '/adapters/overview': r('/integrate/adapters/overview'),
  '/adapters/cloud/axiom': r('/integrate/adapters/cloud/axiom'),
  '/adapters/cloud/otlp': r('/integrate/adapters/hybrid/otlp'),
  '/adapters/cloud/posthog': r('/integrate/adapters/cloud/posthog'),
  '/adapters/cloud/sentry': r('/integrate/adapters/cloud/sentry'),
  '/adapters/cloud/better-stack': r('/integrate/adapters/cloud/better-stack'),
  '/adapters/cloud/datadog': r('/integrate/adapters/cloud/datadog'),
  '/adapters/cloud/hyperdx': r('/integrate/adapters/hybrid/hyperdx'),
  '/adapters/self-hosted/fs': r('/integrate/adapters/self-hosted/fs'),
  '/adapters/self-hosted/nuxthub': r('/integrate/adapters/self-hosted/nuxthub'),

  // Adapters / Building Blocks → Extend
  '/adapters/building-blocks/pipeline': r('/extend/drain-pipeline'),
  '/adapters/building-blocks/http': r('/extend/drain-pipeline'),
  '/adapters/building-blocks/custom': r('/extend/custom-drains'),
  '/adapters/building-blocks/toolkit': r('/extend/custom-drains'),

  // Stale aliases that already redirected via nuxt.config.ts
  '/adapters/axiom': r('/integrate/adapters/cloud/axiom'),
  '/adapters/otlp': r('/integrate/adapters/hybrid/otlp'),
  '/adapters/posthog': r('/integrate/adapters/cloud/posthog'),
  '/adapters/sentry': r('/integrate/adapters/cloud/sentry'),
  '/adapters/better-stack': r('/integrate/adapters/cloud/better-stack'),
  '/adapters/datadog': r('/integrate/adapters/cloud/datadog'),
  '/adapters/hyperdx': r('/integrate/adapters/hybrid/hyperdx'),
  '/adapters/fs': r('/integrate/adapters/self-hosted/fs'),
  '/adapters/nuxthub': r('/integrate/adapters/self-hosted/nuxthub'),
  '/adapters/nuxthub/overview': r('/integrate/adapters/self-hosted/nuxthub'),
  '/adapters/nuxthub/retention': r('/integrate/adapters/self-hosted/nuxthub#retention'),
  '/adapters/self-hosted/nuxthub/overview': r('/integrate/adapters/self-hosted/nuxthub'),
  '/adapters/self-hosted/nuxthub/retention': r('/integrate/adapters/self-hosted/nuxthub#retention'),
  '/adapters/pipeline': r('/extend/drain-pipeline'),
  '/adapters/custom': r('/extend/custom-drains'),
  '/adapters/http': r('/extend/drain-pipeline'),
  '/adapters/browser': r('/extend/drain-pipeline'),
  '/nuxthub': r('/integrate/adapters/self-hosted/nuxthub'),
  '/nuxthub/overview': r('/integrate/adapters/self-hosted/nuxthub'),
  '/nuxthub/retention': r('/integrate/adapters/self-hosted/nuxthub#retention'),

  // Enrichers → Use Cases (built-in) + Extend (custom)
  '/enrichers/overview': r('/use-cases/enrichers'),
  '/enrichers/built-in': r('/use-cases/enrichers'),
  '/enrichers/custom': r('/extend/custom-enrichers'),
}

/**
 * Docus mirrors every content page as raw markdown at `/raw/<path>.md` (used by
 * `/llms.txt`). That catch-all route resolves by content path and is not covered by
 * the page-level redirects above, so old paths 404 there even though the HTML page
 * redirects fine. Derive one mirror redirect per entry instead of hand-duplicating
 * the whole table — anchored targets (`#retention`) have no raw equivalent and are
 * skipped, as is `/` (the homepage isn't a regular content page and has no
 * `/raw/....md` mirror).
 */
export const rawRedirects: Record<string, RouteRedirect> = Object.fromEntries(
  Object.entries(redirects)
    .filter(([, entry]) => !entry.redirect.to.includes('#') && entry.redirect.to !== '/')
    .map(([from, entry]) => [`/raw${from}.md`, r(`/raw${entry.redirect.to}.md`)]),
)
