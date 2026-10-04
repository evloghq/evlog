import { FRAMEWORK_IDS } from '../frameworks'
import type { Grade } from './types'

const GRADES: readonly Grade[] = ['excellent', 'good', 'needs-work', 'at-risk']

/** Which gate the run asked for — `--min-score`, `--baseline`, both, neither. */
const GATES = ['none', 'min-score', 'baseline', 'both'] as const
export type MapGate = typeof GATES[number]

/** Which renderer the run asked for: the three human views, or a machine format. */
const VIEWS = ['summary', 'all', 'inspect', 'github'] as const
export type MapView = typeof VIEWS[number]

/**
 * String fields of the `evlog map` telemetry, with the exact set of values each may take.
 *
 * Kept apart from `./telemetry` so the root command can register the allowlist
 * without loading the scanner.
 */
export const MAP_TELEMETRY_FIELDS = {
  mapFramework: FRAMEWORK_IDS,
  mapGrade: GRADES,
  mapGate: GATES,
  mapView: VIEWS,
} as const satisfies Record<string, readonly string[]>
