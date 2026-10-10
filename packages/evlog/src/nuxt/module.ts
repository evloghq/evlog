import { relative } from 'node:path'
import {
  addImports,
  addPlugin,
  addServerHandler,
  addServerImports,
  addServerPlugin,
  addTypeTemplate,
  addVitePlugin,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import type { Nitro, NitroConfig } from 'nitropack'
import type { EnvironmentContext, LogLevel, RedactConfig, RouteConfig, SamplingConfig, TransportConfig } from '../types'
import type { DevTerminalInput } from '../shared/dev-terminal'
import { prependNitroErrorHandler } from '../nitro'
import { prepareRedactForBridge } from '../redact'
import { findEvlogConfigFile, registerEvlogConfigPlugin } from '../shared/configPlugin'
import { createStripPlugin } from '../vite/strip'
import { createSourceLocationPlugin } from '../vite/source-location'
import { name, version } from '../../package.json'

interface ModuleAxiomBaseConfig {
  /** Axiom dataset name */
  dataset: string
  /** Axiom API token (evlog field `apiKey`) */
  apiKey?: string
  /**
   * @deprecated Renamed to `apiKey`. Will be removed in the next major version.
   */
  token?: string
  /** Organization ID (required for Personal Access Tokens) */
  orgId?: string
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
}

interface ModuleAxiomEdgeConfig {
  /**
   * Edge URL for Axiom ingest/query endpoints.
   * If no path is provided, uses /v1/ingest/{dataset}.
   * If a custom path is provided, it is used as-is (trailing slash trimmed).
   */
  edgeUrl: string
  /** Mutually exclusive with edgeUrl. */
  baseUrl?: never
}

interface ModuleAxiomEndpointConfig {
  /** Base URL for Axiom API. Uses /v1/datasets/{dataset}/ingest. */
  baseUrl?: string
  /** Mutually exclusive with baseUrl. */
  edgeUrl?: never
}

type ModuleAxiomConfig = ModuleAxiomBaseConfig & (ModuleAxiomEdgeConfig | ModuleAxiomEndpointConfig)

export interface ModuleOptions {
  /**
   * Enable or disable all logging globally.
   * When false, all emits, tagged logs, and request logger operations become no-ops.
   * @default true
   */
  enabled?: boolean

  /**
   * Environment context overrides.
   */
  env?: Partial<EnvironmentContext>

  /**
   * Enable or disable browser console output.
   * When false, client-side logs are suppressed in the browser DevTools console
   * but still sent to the server via transport (if enabled).
   * @default true
   */
  console?: boolean

  /**
   * Enable pretty printing.
   * @default true in development, false in production
   */
  pretty?: boolean

  /**
   * Dev terminal output: preset or explicit overlay + pretty-error settings.
   * @default 'evlog' when pretty in development
   */
  dev?: DevTerminalInput

  /**
   * Suppress built-in console output.
   * When true, events are still built, sampled, and passed to drains,
   * but nothing is written to console. Use when drains own the output
   * channel (e.g., stdout-based platforms like GCP Cloud Run, AWS Lambda).
   * @default false
   */
  silent?: boolean

  /**
   * Route patterns to include in logging.
   * Supports glob patterns like '/api/**'.
   * If not set, all routes are logged.
   * @example ['/api/**', '/auth/**']
   */
  include?: string[]

  /**
   * Route patterns to exclude from logging.
   * Supports glob patterns like '/api/_nuxt_icon/**'.
   * Exclusions take precedence over inclusions.
   * @example ['/api/_nuxt_icon/**', '/health']
   */
  exclude?: string[]

  /**
   * Route-specific service configuration.
   * Allows setting different service names for different routes.
   * Patterns are matched using glob syntax.
   *
   * @example
   * ```ts
   * routes: {
   *   '/api/foo/**': { service: 'service1' },
   *   '/api/bar/**': { service: 'service2' }
   * }
   * ```
   */
  routes?: Record<string, RouteConfig>

  /**
   * Sampling configuration for filtering logs.
   * Allows configuring what percentage of logs to keep per level.
   *
   * @example
   * ```ts
   * sampling: {
   *   rates: {
   *     info: 10,    // Keep 10% of info logs
   *     warn: 50,    // Keep 50% of warning logs
   *     debug: 5,    // Keep 5% of debug logs
   *     error: 100,  // Always keep errors (default)
   *   }
   * }
   * ```
   */
  sampling?: SamplingConfig

  /**
   * Minimum severity for the global `log` API on server and client (not request wide events).
   * Order: debug < info < warn < error.
   * @default 'debug'
   */
  minLevel?: LogLevel

  /**
   * Transport configuration for sending client logs to the server.
   *
   * @example
   * ```ts
   * transport: {
   *   enabled: true, // send client logs to server via API endpoint
   *   endpoint: '/api/_evlog/ingest', // default endpoint (or custom endpoint)
   *   credentials: 'include', // optional: cross-origin ingest
   * }
   * ```
   */
  transport?: TransportConfig

  /**
   * Live stream of wide events, exposed by a small local HTTP server on
   * an ephemeral port. Any consumer (browser tab, CLI, devtool) can
   * subscribe via Server-Sent Events. The URL is printed at startup and
   * written to `.evlog/stream.url`.
   *
   * Strict opt-in — nothing starts unless this is set.
   *
   * - `true` — enable with defaults
   * - `false` — off (same as omitting)
   * - `StreamServerOptions` — full config (port, host, token, ...)
   * - `undefined` (default) — off
   *
   * Local-only: binds to `127.0.0.1` and does not work on serverless
   * platforms (each invocation is isolated).
   *
   * @example
   * ```ts
   * // Enable with defaults
   * evlog: { stream: true }
   *
   * // Custom port + auth token
   * evlog: { stream: { port: 4317, token: process.env.EVLOG_STREAM_TOKEN } }
   * ```
   */
  stream?: boolean | import('../stream').StreamServerOptions

  /**
   * Axiom adapter configuration.
   * When configured, use `createAxiomDrain()` from `evlog/axiom` to send logs.
   *
   * @example
   * ```ts
   * axiom: {
   *   dataset: 'my-app-logs',
   *   apiKey: process.env.AXIOM_API_KEY,
   * }
   * ```
   */
  axiom?: ModuleAxiomConfig

  /**
   * OTLP adapter configuration.
   * When configured, use `createOTLPDrain()` from `evlog/otlp` to send logs.
   *
   * @example
   * ```ts
   * otlp: {
   *   endpoint: 'http://localhost:4318',
   *   headers: {
   *     'Authorization': `Basic ${process.env.GRAFANA_TOKEN}`,
   *   },
   * }
   * ```
   */
  otlp?: {
    /** OTLP HTTP endpoint (e.g., http://localhost:4318) */
    endpoint: string
    /** Override service name (defaults to event.service) */
    serviceName?: string
    /** Additional resource attributes */
    resourceAttributes?: Record<string, string | number | boolean>
    /** Custom headers (e.g., for authentication) */
    headers?: Record<string, string>
    /** Request timeout in milliseconds. Default: 5000 */
    timeout?: number
  }

  /**
   * PostHog adapter configuration.
   * When configured, use `createPostHogDrain()` from `evlog/posthog` to send logs
   * via PostHog Logs (OTLP).
   *
   * @example
   * ```ts
   * posthog: {
   *   apiKey: process.env.POSTHOG_API_KEY,
   * }
   * ```
   */
  posthog?: {
    /** PostHog project API key */
    apiKey: string
    /** PostHog host URL. Default: https://us.i.posthog.com */
    host?: string
    /** Request timeout in milliseconds. Default: 5000 */
    timeout?: number
  }

  /**
   * Sentry adapter configuration.
   * When configured, use `createSentryDrain()` from `evlog/sentry` to send logs.
   *
   * @example
   * ```ts
   * sentry: {
   *   dsn: process.env.SENTRY_DSN,
   * }
   * ```
   */
  sentry?: {
    /** Sentry DSN */
    dsn: string
    /** Environment override (defaults to event.environment) */
    environment?: string
    /** Release version override (defaults to event.version) */
    release?: string
    /** Additional tags to attach as attributes */
    tags?: Record<string, string>
    /** Request timeout in milliseconds. Default: 5000 */
    timeout?: number
  }

  /**
   * Auto-redaction configuration for PII protection.
   * `true` enables all built-in PII patterns (email, credit card, IPv4, phone, SSN).
   * Pass an object for fine-grained control.
   *
   * @example
   * ```ts
   * // Enable all built-in PII patterns
   * evlog: { redact: true }
   *
   * // Add custom paths on top of built-ins
   * evlog: {
   *   redact: {
   *     paths: ['user.password', 'headers.authorization'],
   *   }
   * }
   * ```
   */
  redact?: boolean | RedactConfig

  /**
   * Log levels to strip from production builds. Set to [] to disable.
   * @default ['debug']
   */
  strip?: LogLevel[]

  /**
   * Inject source file:line into log calls.
   * When true, active in both dev and prod.
   * When 'dev', active only in development.
   * @default 'dev'
   */
  sourceLocation?: boolean | 'dev'

  /**
   * How long to retain events before cleanup (used by @evlog/nuxthub).
   * Supports "30d" (days), "24h" (hours), "60m" (minutes).
   * @default '7d'
   */
  retention?: string
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name,
    version,
    configKey: name,
    docs: 'https://evlog.dev',
  },
  defaults: {},
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    const transportEnabled = options.transport?.enabled ?? false
    const transportEndpoint = options.transport?.endpoint ?? '/api/_evlog/ingest'
    const transportCredentials = options.transport?.credentials ?? 'same-origin'

    // Normalize `evlog.stream` into a single canonical shape so the Nitro
    // plugin (which reads runtimeConfig.evlog at server boot) sees a
    // consistent value.
    //
    // The stream is exposed by a separate mini HTTP server on its own
    // ephemeral port (see `evlog/stream` → `startStreamServer`). It does
    // NOT register a route in the user's app.
    //
    // Strict opt-in: nothing starts unless the user explicitly asks for it.
    //   - `stream === true`        → enabled with defaults
    //   - `stream === false`       → off (alias for undefined)
    //   - `stream: { ... }`        → enabled with user options
    //   - `stream === undefined`   → off
    const streamRaw = options.stream
    const normalizedStream
      = streamRaw === true
        ? true
        : streamRaw && typeof streamRaw === 'object'
          ? streamRaw
          : false
    const streamEnabled = normalizedStream !== false
    options.stream = normalizedStream

    // runtimeConfig and the JSON bridges in the nitro:config hook below
    // serialize the config: RegExps in redact.patterns would collapse to {}
    // and be dropped server-side, and function-valued redact policy would
    // vanish silently.
    prepareRedactForBridge(options.redact)

    nuxt.options.runtimeConfig.evlog = options

    // Register custom error handler for proper EvlogError serialization
    // Only set if not already configured to avoid overwriting user's custom handler
    // Mirror standalone Nitro modules: serialize evlog options into __EVLOG_CONFIG so
    // resolveEvlogConfigForNitroPlugin() picks them up in dev (Nitro worker threads
    // often cannot resolve useRuntimeConfig().evlog via dynamic import reliably).
    // @ts-expect-error nitro:config hook exists but is not in NuxtHooks type
    nuxt.hook('nitro:config', (nitroConfig: NitroConfig) => {
      const evlogHandler = resolver.resolve('../nitro/errorHandler').replace(/\\/g, '/')
      nitroConfig.errorHandler = prependNitroErrorHandler(nitroConfig.errorHandler, evlogHandler)

      const evlogForNitro = nuxt.options.runtimeConfig.evlog ?? options
      if (evlogForNitro !== undefined && typeof evlogForNitro === 'object') {
        const serialized = JSON.stringify(evlogForNitro)
        nitroConfig.replace = nitroConfig.replace || {}
        nitroConfig.replace.__EVLOG_CONFIG__ = serialized
        process.env.__EVLOG_CONFIG = serialized
      }
    })
    nuxt.options.runtimeConfig.public.evlog = {
      enabled: options.enabled ?? true,
      console: options.console,
      pretty: options.pretty,
      minLevel: options.minLevel,
      transport: {
        enabled: transportEnabled,
        endpoint: transportEndpoint,
        credentials: transportCredentials,
      },
    }

    if (transportEnabled) {
      addServerHandler({
        route: transportEndpoint,
        method: 'post',
        handler: resolver.resolve('../runtime/server/routes/_evlog/ingest.post'),
      })
    }

    if (streamEnabled) {
      // The stream itself is served by an out-of-band HTTP mini-server
      // started in the Nitro plugin — see startStreamServer() in
      // packages/evlog/src/stream.ts. Here we only register a discovery
      // route so a browser tab on the user's app can find the mini-server
      // URL without having to read `.evlog/stream.url` directly.
      addServerHandler({
        route: '/api/_evlog/stream-info',
        method: 'get',
        handler: resolver.resolve('../runtime/server/routes/_evlog/stream-info.get'),
      })
    }

    addServerPlugin(resolver.resolve('../nitro/plugin'))
    // @ts-expect-error nitro:init hook exists but is not in NuxtHooks type
    nuxt.hook('nitro:init', (nitro: Nitro) => {
      registerEvlogConfigPlugin(nitro)
    })
    // Root files are in no generated tsconfig, so `import.meta.dev` would be untyped in the editor.
    nuxt.hook('prepare:types', ({ nodeTsConfig }) => {
      const configFile = findEvlogConfigFile(nuxt.options.rootDir)
      if (!configFile) return
      nodeTsConfig.include ||= []
      nodeTsConfig.include.push(relative(nuxt.options.buildDir, configFile).replace(/\\/g, '/'))
    })

    addPlugin({
      src: resolver.resolve('../runtime/client/plugin'),
      mode: 'client',
    })

    addImports([
      {
        name: 'log',
        from: resolver.resolve('../runtime/client/log'),
        dtsDisabled: true,
      },
      {
        name: 'setIdentity',
        from: resolver.resolve('../runtime/client/log'),
        dtsDisabled: true,
      },
      {
        name: 'clearIdentity',
        from: resolver.resolve('../runtime/client/log'),
        dtsDisabled: true,
      },
      {
        name: 'setMinLevel',
        from: resolver.resolve('../runtime/client/log'),
        dtsDisabled: true,
      },
      {
        name: 'createEvlogError',
        from: resolver.resolve('../error'),
        dtsDisabled: true,
      },
      {
        name: 'parseError',
        from: resolver.resolve('../runtime/utils/parseError'),
        dtsDisabled: true,
      },
    ])

    addTypeTemplate({
      filename: 'types/evlog-client.d.ts',
      getContents: () => `declare global {
  const log: typeof import('evlog/client').log
  const setIdentity: typeof import('evlog/client').setIdentity
  const clearIdentity: typeof import('evlog/client').clearIdentity
  const setMinLevel: typeof import('evlog/client').setMinLevel
  const createEvlogError: typeof import('evlog').createEvlogError
  const parseError: typeof import('evlog').parseError
}
export {}
`,
    })

    addServerImports([
      {
        name: 'useLogger',
        from: resolver.resolve('../runtime/server/useLogger'),
        dtsDisabled: true,
      },
      {
        name: 'log',
        from: resolver.resolve('../logger'),
        dtsDisabled: true,
      },
      {
        name: 'createEvlogError',
        from: resolver.resolve('../error'),
        dtsDisabled: true,
      },
    ])

    addTypeTemplate({
      filename: 'types/evlog-server.d.ts',
      getContents: () => `declare global {
  const useLogger: typeof import('evlog').useLogger
  const createEvlogError: typeof import('evlog').createEvlogError
}
export {}
`,
      // `nitro: true` puts the reference on the server tsconfig project.
      // `nuxt: true` also puts it on the app tsconfig project — required
      // because `$fetch` typings resolve server route return types by
      // importing the route modules directly, which pulls server routes
      // (and therefore these globals) into the app project's typecheck too.
      // `createEvlogError` is safe to expose in both contexts: it resolves
      // to the same `evlog` export as the one declared in evlog-client.d.ts.
      // `log` is intentionally NOT declared here — the server `log` (a
      // module-level logger for background/non-request code) and the
      // client `log` (declared in evlog-client.d.ts) are different values
      // with different types but share the same global name, so it can
      // only be safely typed within the project that actually needs it.
    }, { nitro: true, nuxt: true })

    addTypeTemplate({
      filename: 'types/evlog-server-log.d.ts',
      getContents: () => `declare global {
  const log: typeof import('evlog').log
}
export {}
`,
      // Nitro-only: the app tsconfig project already declares a (different)
      // global `log` via evlog-client.d.ts. Referencing this template there
      // too would make the two ambient declarations fight over the same
      // name — since \`skipLibCheck\` is on by default in Nuxt's generated
      // tsconfigs, TypeScript silently keeps whichever declaration it sees
      // first instead of erroring, so the losing side's shape goes unused
      // without warning.
    }, { nitro: true })

    const stripLevels = options.strip ?? ['debug']
    if (stripLevels.length > 0) {
      addVitePlugin(createStripPlugin(stripLevels))
    }

    const srcLoc = options.sourceLocation ?? 'dev'
    if (srcLoc === true || (srcLoc === 'dev' && nuxt.options.dev)) {
      addVitePlugin(createSourceLocationPlugin(true))
    }
  },
})
