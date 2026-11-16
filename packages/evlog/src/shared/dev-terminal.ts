import { isDev } from '../utils'

/** Dev terminal preset — shorthand for common overlay + pretty-error combinations. */
export type DevTerminalPreset = 'evlog' | 'nitro' | 'both'

/** How much stack detail evlog prints inside the wide-event error block. */
export type DevPrettyErrorDetail = 'full' | 'guidance'

/** Pretty-print options for the `error:` block in dev wide events. */
export interface DevPrettyErrorConfig {
  snippet?: boolean
  stackDepth?: number
  compact?: boolean
  detail?: DevPrettyErrorDetail
}

export type ResolvedPrettyError = Required<DevPrettyErrorConfig>

export interface DevTerminalConfigObject {
  /** Show Nitro `[request error]` + Youch in the terminal. @default false when pretty in dev. */
  frameworkOverlay?: boolean
  prettyError?: DevPrettyErrorConfig
}

export type DevTerminalInput = DevTerminalPreset | DevTerminalConfigObject

export interface ResolvedDevTerminal {
  frameworkOverlay: boolean
  prettyError: ResolvedPrettyError
}

export interface DevTerminalResolveInput {
  pretty?: boolean
  dev?: DevTerminalInput
}

const DEV_PRESETS: Record<DevTerminalPreset, { frameworkOverlay: boolean; detail: DevPrettyErrorDetail }> = {
  evlog: { frameworkOverlay: false, detail: 'full' },
  nitro: { frameworkOverlay: true, detail: 'guidance' },
  both: { frameworkOverlay: true, detail: 'full' },
}

function finalizePrettyError(
  partial: DevPrettyErrorConfig,
  frameworkOverlay: boolean,
  pretty: boolean,
  inDev: boolean,
): ResolvedPrettyError {
  const compact = partial.compact ?? (inDev && pretty)
  const detail = partial.detail ?? (frameworkOverlay ? 'guidance' : 'full')
  const stackDepth = detail === 'guidance'
    ? 0
    : (partial.stackDepth ?? (compact ? 2 : 3))
  const snippet = partial.snippet ?? (detail === 'full' && pretty && inDev)

  return { snippet, stackDepth, compact, detail }
}

export function resolveDevTerminal(input: DevTerminalResolveInput = {}): ResolvedDevTerminal {
  const pretty = input.pretty ?? isDev()
  const inDev = isDev()

  let frameworkOverlay: boolean | undefined
  let prettyError: DevPrettyErrorConfig = {}

  if (typeof input.dev === 'string' && input.dev in DEV_PRESETS) {
    const { frameworkOverlay: presetOverlay, detail } = DEV_PRESETS[input.dev]
    frameworkOverlay = presetOverlay
    prettyError = { detail }
  } else if (input.dev && typeof input.dev === 'object') {
    const { frameworkOverlay: devOverlay, prettyError: devPrettyError } = input.dev
    frameworkOverlay = devOverlay
    if (devPrettyError) {
      prettyError = devPrettyError
    }
  }

  if (frameworkOverlay === undefined) {
    frameworkOverlay = !(pretty && inDev)
  }

  return {
    frameworkOverlay,
    prettyError: finalizePrettyError(prettyError, frameworkOverlay, pretty, inDev),
  }
}

/**
 * Whether Nitro's dev Youch overlay should print to the terminal.
 * @internal
 */
export function shouldShowFrameworkOverlay(input: DevTerminalResolveInput = {}): boolean {
  return resolveDevTerminal(input).frameworkOverlay
}
