<script setup lang="ts">
const route = useRoute()
const isHome = computed(() => route.path === '/')

const landingItems = [
  {
    label: 'Docs',
    to: '/start/introduction',
    children: [
      {
        label: 'Introduction',
        icon: 'i-lucide-book-open',
        description: 'What is evlog and why use it',
        to: '/start/introduction'
      },
      {
        label: 'Why start with evlog',
        icon: 'i-lucide-rocket',
        description: 'The case for adopting evlog on day zero',
        to: '/start/why-evlog'
      },
      {
        label: 'Installation',
        icon: 'i-lucide-download',
        description: 'Install evlog in your project',
        to: '/start/installation'
      },
      {
        label: 'Quick Start',
        icon: 'i-lucide-zap',
        description: 'Get up and running in minutes',
        to: '/start/quick-start'
      },
      {
        label: 'vs Other Loggers',
        icon: 'i-lucide-git-compare-arrows',
        description: 'How evlog compares to pino, consola, winston',
        to: '/reference/vs-other-loggers'
      },
      {
        label: 'Agent Skills',
        icon: 'i-lucide-bot',
        description: 'Use evlog with AI coding agents',
        to: '/reference/agent-skills'
      },
      {
        label: 'Configuration',
        icon: 'i-lucide-settings',
        description: 'Every option, env var, and default',
        to: '/reference/configuration'
      },
      {
        label: 'Best Practices',
        icon: 'i-lucide-shield-check',
        description: 'What to log, what never to log',
        to: '/reference/best-practices'
      }
    ]
  },
  {
    label: 'Concepts',
    to: '/learn/overview',
    children: [
      {
        label: 'Simple Logging',
        icon: 'i-lucide-terminal',
        description: 'Fire-and-forget structured logs',
        to: '/learn/simple-logging'
      },
      {
        label: 'Wide Events',
        icon: 'i-lucide-rows-3',
        description: 'Accumulate context, emit once',
        to: '/learn/wide-events'
      },
      {
        label: 'Structured Errors',
        icon: 'i-lucide-shield-alert',
        description: 'Errors that explain why and how to fix',
        to: '/learn/structured-errors'
      },
      {
        label: 'Catalogs',
        icon: 'i-lucide-book-marked',
        description: 'Refactor-safe typed error and audit catalogs',
        to: '/learn/catalogs'
      },
      {
        label: 'Lifecycle',
        icon: 'i-lucide-arrow-right-left',
        description: 'From emit() to drain in detail',
        to: '/learn/lifecycle'
      },
      {
        label: 'Sampling',
        icon: 'i-lucide-filter',
        description: 'Keep all errors, drop healthy noise',
        to: '/learn/sampling'
      },
      {
        label: 'Auto-Redaction',
        icon: 'i-lucide-eye-off',
        description: 'Strip secrets before they leave the process',
        to: '/learn/redaction'
      },
      {
        label: 'Typed Fields',
        icon: 'i-simple-icons-typescript',
        description: 'Autocomplete your own log.set fields',
        to: '/learn/typed-fields'
      }
    ]
  },
  {
    label: 'CLI',
    to: '/cli/overview',
    children: [
      {
        label: 'Overview',
        icon: 'i-lucide-terminal',
        description: 'Commands, flags, exit codes',
        to: '/cli/overview'
      },
      {
        label: 'evlog map',
        icon: 'i-lucide-radar',
        description: 'Score every entry point in your app',
        to: '/cli/map'
      },
      {
        label: 'Rules',
        icon: 'i-lucide-list-checks',
        description: 'Every check and how to satisfy it',
        to: '/cli/rules'
      },
      {
        label: 'Scoring',
        icon: 'i-lucide-gauge',
        description: 'Weights, grades, and sensitivity',
        to: '/cli/scoring'
      },
      {
        label: 'CI',
        icon: 'i-lucide-git-pull-request',
        description: 'Gate a pull request on the score',
        to: '/cli/ci'
      },
      {
        label: 'evlog doctor',
        icon: 'i-lucide-stethoscope',
        description: 'Diagnose your evlog install',
        to: '/cli/doctor'
      }
    ]
  },
  {
    label: 'Frameworks',
    to: '/integrate/frameworks/overview',
    children: [
      {
        label: 'Nuxt',
        icon: 'i-simple-icons-nuxtdotjs',
        description: 'Nuxt module with auto-imports',
        to: '/integrate/frameworks/nuxt'
      },
      {
        label: 'Next.js',
        icon: 'i-simple-icons-nextdotjs',
        description: 'App Router and Pages Router',
        to: '/integrate/frameworks/nextjs'
      },
      {
        label: 'SvelteKit',
        icon: 'i-simple-icons-svelte',
        description: 'handle hook integration',
        to: '/integrate/frameworks/sveltekit'
      },
      {
        label: 'Nitro',
        icon: 'i-custom-nitro',
        description: 'Nitro v2 and v3 plugin',
        to: '/integrate/frameworks/nitro'
      },
      {
        label: 'TanStack Start',
        icon: 'i-custom-tanstack',
        description: 'Nitro v3 module with async context',
        to: '/integrate/frameworks/tanstack-start'
      },
      {
        label: 'Hono',
        icon: 'i-simple-icons-hono',
        description: 'Web standards middleware',
        to: '/integrate/frameworks/hono'
      },
      {
        label: 'Express',
        icon: 'i-simple-icons-express',
        description: 'Express middleware',
        to: '/integrate/frameworks/express'
      },
      {
        label: 'NestJS',
        icon: 'i-simple-icons-nestjs',
        description: 'Module with global middleware',
        to: '/integrate/frameworks/nestjs'
      },
      {
        label: 'Cloudflare Workers',
        icon: 'i-simple-icons-cloudflare',
        description: 'Edge runtime support',
        to: '/integrate/frameworks/cloudflare-workers'
      },
      {
        label: 'Standalone',
        icon: 'i-lucide-code',
        description: 'Scripts, jobs, libraries, anything',
        to: '/integrate/frameworks/standalone'
      },
      {
        label: 'Custom framework',
        icon: 'i-lucide-puzzle',
        description: 'Wire up a framework evlog has no module for',
        to: '/extend/custom-framework'
      },
      {
        label: 'All frameworks',
        icon: 'i-lucide-layers',
        description: 'See all 16 framework integrations',
        to: '/integrate/frameworks/overview'
      }
    ]
  },
  {
    label: 'Adapters',
    to: '/integrate/adapters/overview',
    children: [
      {
        label: 'Axiom',
        icon: 'i-custom-axiom',
        description: 'Send logs to Axiom',
        to: '/integrate/adapters/cloud/axiom'
      },
      {
        label: 'OpenTelemetry',
        icon: 'i-simple-icons-opentelemetry',
        description: 'Export via OTLP protocol',
        to: '/integrate/adapters/hybrid/otlp'
      },
      {
        label: 'HyperDX',
        icon: 'i-custom-hyperdx',
        description: 'Send logs to HyperDX via OTLP',
        to: '/integrate/adapters/hybrid/hyperdx'
      },
      {
        label: 'Sazabi',
        icon: 'i-custom-sazabi',
        description: 'Send logs to Sazabi via OTLP',
        to: '/integrate/adapters/cloud/sazabi'
      },
      {
        label: 'PostHog',
        icon: 'i-simple-icons-posthog',
        description: 'Send logs to PostHog',
        to: '/integrate/adapters/cloud/posthog'
      },
      {
        label: 'Sentry',
        icon: 'i-simple-icons-sentry',
        description: 'Report errors to Sentry',
        to: '/integrate/adapters/cloud/sentry'
      },
      {
        label: 'Better Stack',
        icon: 'i-simple-icons-betterstack',
        description: 'Stream logs to Better Stack',
        to: '/integrate/adapters/cloud/better-stack'
      },
      {
        label: 'Datadog',
        icon: 'i-simple-icons-datadog',
        description: 'Send logs to Datadog',
        to: '/integrate/adapters/cloud/datadog'
      },
      {
        label: 'Grafana Loki',
        icon: 'i-simple-icons-grafana',
        description: 'Push logs to Grafana Loki',
        to: '/integrate/adapters/hybrid/loki'
      },
      {
        label: 'ClickHouse',
        icon: 'i-simple-icons-clickhouse',
        description: 'Insert events into ClickHouse',
        to: '/integrate/adapters/hybrid/clickhouse'
      },
      {
        label: 'File System',
        icon: 'i-lucide-hard-drive',
        description: 'Write NDJSON logs locally',
        to: '/integrate/adapters/self-hosted/fs'
      },
      {
        label: 'NuxtHub',
        icon: 'i-simple-icons-nuxtdotjs',
        description: 'Persist logs in NuxtHub D1',
        to: '/integrate/adapters/self-hosted/nuxthub'
      },
      {
        label: 'Drain pipeline',
        icon: 'i-lucide-workflow',
        description: 'Batching, retries, fan-out to many sinks',
        to: '/extend/drain-pipeline'
      },
      {
        label: 'Custom drains',
        icon: 'i-lucide-share-2',
        description: 'Send events anywhere with the toolkit',
        to: '/extend/custom-drains'
      },
      {
        label: 'All adapters',
        icon: 'i-custom-plug',
        description: 'See every built-in adapter',
        to: '/integrate/adapters/overview'
      }
    ]
  },
  {
    label: 'Use Cases',
    to: '/use-cases/overview',
    children: [
      {
        label: 'AI SDK',
        icon: 'i-simple-icons-vercel',
        description: 'AI observability with token tracking',
        to: '/use-cases/ai-sdk/overview'
      },
      {
        label: 'Better Auth',
        icon: 'i-simple-icons-betterauth',
        description: 'Auto-identify users on every request',
        to: '/use-cases/better-auth/overview'
      },
      {
        label: 'Audit Logs',
        icon: 'i-lucide-shield-check',
        description: 'Tamper-evident who-did-what trails',
        to: '/use-cases/audit/overview'
      },
      {
        label: 'Client Logging',
        icon: 'i-lucide-monitor',
        description: 'Browser-side logging and transport',
        to: '/use-cases/client-logging'
      },
      {
        label: 'Enrichers',
        icon: 'i-lucide-sparkles',
        description: 'Auto-add User-Agent, geo, trace context',
        to: '/use-cases/enrichers'
      },
      {
        label: 'Telemetry',
        icon: 'i-lucide-gauge',
        description: 'One event per run for your own CLI',
        to: '/use-cases/telemetry/overview'
      },
      {
        label: 'eve',
        icon: 'i-custom-eve',
        description: 'Observability for eve agents',
        to: '/use-cases/eve'
      },
      {
        label: 'All use cases',
        icon: 'i-lucide-layers',
        description: 'See everything evlog is used for',
        to: '/use-cases/overview'
      }
    ]
  }
]

</script>

<template>
  <UNavigationMenu
    v-if="isHome"
    variant="link"
    color="neutral"
    :items="landingItems"
    :ui="{
      linkTrailingIcon: 'hidden',
      childLink: 'hover:bg-elevated/50',
      viewport: 'bg-default backdrop-blur-xl ring ring-offset-6 ring-offset-bg ring-default border border-default',
      viewportWrapper: 'w-[600px] transition-all duration-500 left-1/2 -translate-x-1/2',
    }"
  />
  <UContentSearchButton
    v-else
    :collapsed="false"
    class="w-full"
    variant="soft"
    :ui="{ leadingIcon: 'size-4 mr-1' }"
  />
</template>
