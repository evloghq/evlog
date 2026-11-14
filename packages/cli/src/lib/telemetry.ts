import { INIT_TELEMETRY_FIELDS } from './init/telemetry'
import { LOGS_TELEMETRY_FIELDS } from './logs/query'
import { MAP_TELEMETRY_FIELDS } from './map/telemetry-fields'

/**
 * The string values a run may send, by field.
 *
 * Which setup options people actually pick and how projects actually score, so
 * the flow can lead with the options that get used and the grade bands can be
 * calibrated against reality. Values are ids from this CLI's own catalog: the
 * allowlist is what keeps a free-text answer from ever being sent.
 *
 * One constant for the runs and for `evlog telemetry status`, whose disclosure
 * is built from it.
 */
export const TELEMETRY_COLLECT = {
  fields: { ...INIT_TELEMETRY_FIELDS, ...LOGS_TELEMETRY_FIELDS, ...MAP_TELEMETRY_FIELDS },
} as const
