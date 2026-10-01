import { telemetry } from '@evlog/telemetry'
import { INIT_FRAMEWORK_IDS } from '../frameworks'
import { DESTINATIONS, ENRICHERS, EXTRAS, SAMPLING_PRESETS } from './catalog'
import type { InitResult } from './run'

/**
 * Which choices `init` records, to learn which options people actually pick.
 *
 * Only ids from this CLI's own catalog, counts and booleans. The service name,
 * package names, paths and anything read out of the user's source never leave.
 */
const PREFIX = 'init'

/** String fields, with the exact set of values each may take. */
export const INIT_TELEMETRY_FIELDS = {
  initFramework: INIT_FRAMEWORK_IDS,
  initDevDrain: DESTINATIONS.map(destination => destination.id),
  initSampling: SAMPLING_PRESETS.map(preset => preset.id),
} as const satisfies Record<string, readonly string[]>

function pascal(id: string): string {
  return id.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')
}

/** Field name for a multi-select member: `axiom` → `initProdAxiom`. */
export function memberField(group: 'Prod' | 'Extra' | 'Enricher', id: string): string {
  return `${PREFIX}${group}${pascal(id)}`
}

/**
 * Record the answers on the active telemetry run.
 *
 * Multi-selects become one boolean per chosen option, so "how many runs picked
 * Axiom" is a count rather than a substring match.
 */
export function recordInitAnswers(result: InitResult): void {
  const { answers } = result

  const fields: Record<string, boolean | number | string> = {
    initFramework: answers.framework,
    initDevDrain: answers.devDrain,
    initInteractive: result.interactive,
    initCancelled: result.cancelled,
    initProdDrainCount: answers.prodDrains.length,
  }

  if (answers.extras.includes('sampling')) fields.initSampling = answers.sampling
  for (const id of answers.prodDrains) fields[memberField('Prod', id)] = true
  for (const id of answers.extras) fields[memberField('Extra', id)] = true
  for (const id of answers.enrichers) fields[memberField('Enricher', id)] = true

  if (!result.cancelled) {
    fields.initFilesWritten = result.written.length
    fields.initManualSteps = result.manual.length
    fields.initDryRun = result.dryRun
    if (result.verified) fields.initDoctorFail = result.verified.fail
  }

  fields.initAgentGuide = answers.agentGuide
  if (result.agentGuide) {
    fields.initAgentSkillsFound = result.agentGuide.found.length
    fields.initAgentSkillsFailed = result.agentGuide.status === 'failed'
  }

  /* The gap between "offered" and "taken" is what says whether an offer earns
     its place. Whether the scan found something, never what it found. */
  if (result.insight) {
    fields.initHadRepeatedErrors = result.insight.repeatedErrors > 0
    fields.initHadAuditGaps = result.insight.auditGaps > 0
  }

  /* Typed for numbers and booleans because strings need an allowlisted key —
     ours are, on the wrapper. The cast cannot get an unlisted value past
     `sanitizeCustom`. */
  telemetry.set(fields as Record<string, boolean | number>)
}

/** Every field name this module can emit — used to document the disclosure. */
export function initTelemetryFieldNames(): string[] {
  return [
    ...Object.keys(INIT_TELEMETRY_FIELDS),
    'initInteractive',
    'initCancelled',
    'initProdDrainCount',
    'initFilesWritten',
    'initManualSteps',
    'initDryRun',
    'initDoctorFail',
    'initHadRepeatedErrors',
    'initHadAuditGaps',
    'initAgentGuide',
    'initAgentSkillsFound',
    'initAgentSkillsFailed',
    ...DESTINATIONS.map(destination => memberField('Prod', destination.id)),
    ...EXTRAS.map(extra => memberField('Extra', extra.id)),
    ...ENRICHERS.map(enricher => memberField('Enricher', enricher.id)),
  ]
}
