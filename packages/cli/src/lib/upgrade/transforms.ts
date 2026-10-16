/**
 * The v2 to v3 transform table: every deprecated evlog name the upgrade
 * command knows about, and what it becomes.
 *
 * `mode` decides who acts on the entry:
 * - `auto`: a rewrite the command can make with an offset edit, once the
 *   transform lands (EVL-594).
 * - `report`: the command names the finding and the user makes the change,
 *   because the rewrite is not mechanical or lives outside code (EVL-595).
 *
 * Each `source` points at the line in the package that marks the name
 * deprecated, so the table can be re-checked when a removal lands.
 */
export type UpgradeTransformKind = 'import' | 'option' | 'type' | 'function' | 'env'

export type UpgradeTransformMode = 'auto' | 'report'

export interface UpgradeTransform {
  /** Stable id, used in output and in fixtures. */
  id: string
  kind: UpgradeTransformKind
  /** The deprecated name as it appears in user code or config. */
  from: string
  /** The replacement, or the guidance for a report-only entry. */
  to: string
  mode: UpgradeTransformMode
  /** Where the deprecation is declared in `packages/evlog/src`. */
  source: string
}

export const UPGRADE_TRANSFORMS: readonly UpgradeTransform[] = [
  {
    id: 'browser-import',
    kind: 'import',
    from: 'evlog/browser',
    to: 'evlog/http',
    mode: 'auto',
    source: 'browser.ts',
  },
  {
    id: 'axiom-token',
    kind: 'option',
    from: 'token',
    to: 'apiKey',
    mode: 'auto',
    source: 'adapters/axiom.ts',
  },
  {
    id: 'better-stack-source-token',
    kind: 'option',
    from: 'sourceToken',
    to: 'apiKey',
    mode: 'auto',
    source: 'adapters/better-stack.ts',
  },
  {
    id: 'eve-redact-message',
    kind: 'option',
    from: 'redactMessage: true | false',
    to: 'message: \'omit\' | \'preview\'',
    mode: 'auto',
    source: 'eve/index.ts',
  },
  {
    id: 'nitro-config-alias',
    kind: 'type',
    from: 'EvlogConfig',
    to: 'NitroPluginEvlogConfig',
    mode: 'auto',
    source: 'nitro.ts',
  },
  {
    id: 'posthog-events-drain',
    kind: 'function',
    from: 'createPostHogEventsDrain(options)',
    to: 'createPostHogDrain({ ...options, mode: \'events\' })',
    mode: 'report',
    source: 'adapters/posthog.ts',
  },
  {
    id: 'env-token-names',
    kind: 'env',
    from: 'AXIOM_TOKEN, NUXT_AXIOM_TOKEN, BETTER_STACK_SOURCE_TOKEN, NUXT_BETTER_STACK_SOURCE_TOKEN',
    to: 'AXIOM_API_KEY, NUXT_AXIOM_API_KEY, BETTER_STACK_API_KEY, NUXT_BETTER_STACK_API_KEY',
    mode: 'report',
    source: 'adapters/axiom.ts, adapters/better-stack.ts',
  },
]
