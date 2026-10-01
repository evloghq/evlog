/**
 * How the CLI recognizes a framework from its `package.json` and config files.
 *
 * The most specific match wins, so a framework built on another (Nuxt on
 * Nitro) outranks it when both match.
 */
export interface FrameworkDetection {
  /** Any of these in `dependencies` or `devDependencies` is a match. */
  deps: readonly string[]
  /** Globs relative to the package root; any hit is a match. */
  configs?: readonly string[]
  /** Any of these dependencies rules the framework out. */
  unlessDeps?: readonly string[]
  specificity: number
}

/**
 * Everything the CLI knows about a framework that is not code analysis or code
 * generation. Route extraction lives in `map/adapters/`, wiring in `init/frameworks.ts`;
 * both are keyed by the ids declared here, so the compiler lists what a new
 * framework still needs.
 */
export interface FrameworkDefinition<TId extends string = string> {
  id: TId
  /** Display name, e.g. `Next.js`. */
  label: string
  /** Integration guide, as a path under `https://evlog.dev`. */
  docs: string
  /** Whether `evlog init` has a wiring plan for it, not only `evlog map`. */
  init: boolean
  detect: FrameworkDetection
  /** How a handler obtains its request logger, as written in the `AGENTS.md` block. */
  accessor: string
}

const DEFINITIONS = [
  {
    id: 'nuxt',
    label: 'Nuxt',
    docs: '/integrate/frameworks/nuxt',
    init: true,
    detect: { deps: ['nuxt'], configs: ['nuxt.config.{ts,js,mjs}'], specificity: 10 },
    accessor: '`useLogger(event)` (auto-imported) inside a `server/api` handler',
  },
  {
    id: 'nitro',
    label: 'Nitro',
    docs: '/integrate/frameworks/nitro',
    init: true,
    detect: { deps: ['nitropack', 'nitro'], configs: ['nitro.config.{ts,js,mjs}'], unlessDeps: ['nuxt'], specificity: 8 },
    accessor: '`useLogger(event)` from `evlog/nitro` inside a route handler',
  },
  {
    id: 'next',
    label: 'Next.js',
    docs: '/integrate/frameworks/nextjs',
    init: true,
    detect: { deps: ['next'], configs: ['next.config.{ts,js,mjs}'], specificity: 10 },
    accessor: '`useLogger()` from your `lib/evlog.ts` inside a route handler',
  },
  {
    id: 'tanstack-start',
    label: 'TanStack Start',
    docs: '/integrate/frameworks/tanstack-start',
    init: true,
    detect: { deps: ['@tanstack/react-start', '@tanstack/start'], specificity: 10 },
    accessor: '`req.context.log` inside a server route',
  },
  {
    id: 'hono',
    label: 'Hono',
    docs: '/integrate/frameworks/hono',
    init: true,
    detect: { deps: ['hono'], specificity: 10 },
    accessor: '`c.get(\'log\')` or `useLogger()` from `evlog/hono` inside a route handler',
  },
] as const satisfies readonly FrameworkDefinition[]

/** Frameworks the CLI supports. */
export type Framework = typeof DEFINITIONS[number]['id']

/** Frameworks `evlog init` can wire. */
export type InitFramework = Extract<typeof DEFINITIONS[number], { init: true }>['id']

/** Every supported framework, in detection-tie order. */
export const FRAMEWORKS: readonly FrameworkDefinition<Framework>[] = DEFINITIONS

/** Every supported framework id. */
export const FRAMEWORK_IDS: readonly Framework[] = DEFINITIONS.map(definition => definition.id)

/** Framework ids `evlog init` can wire. */
export const INIT_FRAMEWORK_IDS: readonly InitFramework[] = DEFINITIONS
  .filter((definition): definition is Extract<typeof definition, { init: true }> => definition.init)
  .map(definition => definition.id)

/** Look up a framework definition by id. */
export function getFramework(id: Framework): FrameworkDefinition<Framework> {
  return FRAMEWORKS.find(definition => definition.id === id)!
}

/** Narrow a user-supplied string, e.g. `--framework`, to a supported framework. */
export function isFramework(value: string): value is Framework {
  return (FRAMEWORK_IDS as readonly string[]).includes(value)
}

/** Whether `evlog init` can wire this framework. */
export function isInitFramework(id: string): id is InitFramework {
  return (INIT_FRAMEWORK_IDS as readonly string[]).includes(id)
}
