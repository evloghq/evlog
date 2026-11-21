import { cliErrors } from '../errors'
import type { Framework } from '../map/types'
import {
  availableExtras,
  DEFAULT_ENRICHERS,
  DESTINATIONS,
  ENRICHERS,
  EXTRAS,
  findDestination,
  findEnricher,
  findExtra,
  findSamplingPreset,
  PROD_DESTINATIONS,
  SAMPLING_PRESETS,
} from './catalog'
import type { DrainId, EnricherId, ExtraId, OfferContext, SamplingProfile } from './catalog'
import type { InitAnswers } from './prompts'

const DRAIN_IDS = DESTINATIONS.map(destination => destination.id).join(', ')
const PROD_IDS = PROD_DESTINATIONS.map(destination => destination.id).join(', ')
const EXTRA_IDS = EXTRAS.map(extra => extra.id).join(', ')
const ENRICHER_IDS = ENRICHERS.map(enricher => enricher.id).join(', ')
const SAMPLING_IDS = SAMPLING_PRESETS.map(preset => preset.id).join(', ')

/**
 * Read a destination id, rejecting one the catalog does not know.
 *
 * Falling back to the default would wire local files into an app whose author
 * asked for Axiom, and they would find out when production told them nothing.
 */
export function parseDrainArg(value: unknown): DrainId | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const destination = findDestination(value)
  if (!destination) throw cliErrors.INIT_INVALID_DRAIN({ value, known: DRAIN_IDS })
  return destination.id
}

/** Read `--prod-drain a,b`, which may name several destinations. */
export function parseProdDrainsArg(value: unknown): DrainId[] | undefined {
  if (value === false) return []
  if (typeof value !== 'string' || value.length === 0) return undefined

  const parsed: DrainId[] = []
  for (const id of splitList(value)) {
    // Membership in PROD_DESTINATIONS is the rule, not a re-derivation of it.
    const destination = PROD_DESTINATIONS.find(candidate => candidate.id === id)
    if (!destination) throw cliErrors.INIT_INVALID_DRAIN({ value: id, known: PROD_IDS })
    if (!parsed.includes(destination.id)) parsed.push(destination.id)
  }
  return parsed
}

/** Read `--extras a,b`, rejecting unknown ids the same way. */
export function parseExtrasArg(value: unknown): ExtraId[] | undefined {
  if (value === false) return []
  if (typeof value !== 'string' || value.length === 0) return undefined

  const parsed: ExtraId[] = []
  for (const id of splitList(value)) {
    const extra = findExtra(id)
    if (!extra) throw cliErrors.INIT_INVALID_EXTRA({ value: id, known: EXTRA_IDS })
    if (!parsed.includes(extra.id)) parsed.push(extra.id)
  }
  return parsed
}

/** Read `--enrichers a,b`; absent means every enricher when the extra is on. */
export function parseEnrichersArg(value: unknown): EnricherId[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined

  const parsed: EnricherId[] = []
  for (const id of splitList(value)) {
    const enricher = findEnricher(id)
    if (!enricher) throw cliErrors.INIT_INVALID_ENRICHER({ value: id, known: ENRICHER_IDS })
    if (!parsed.includes(enricher.id)) parsed.push(enricher.id)
  }
  return parsed
}

export function parseSamplingArg(value: unknown): SamplingProfile | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const preset = findSamplingPreset(value)
  if (!preset) throw cliErrors.INIT_INVALID_SAMPLING({ value, known: SAMPLING_IDS })
  return preset.id
}

function splitList(value: string): string[] {
  return value.split(',').map(entry => entry.trim()).filter(Boolean)
}

export interface ResolveInput {
  framework: Framework
  defaultService: string
  evlogInstalled: boolean
  /** `--install` (default true); irrelevant when evlog is already there. */
  install: boolean
  /** `--agents` (default true) — write the AGENTS.md block and install the skills. */
  agentGuide: boolean
  /** `--agent-logs` (default true): the eve agent's `evlog__logs` tool. */
  agentLogs?: boolean
  devDrain?: DrainId
  prodDrains?: DrainId[]
  extras?: ExtraId[]
  enrichers?: EnricherId[]
  sampling?: SamplingProfile
  service?: string
  /** What the scan found, for gating the same offers the prompts gate on. */
  offers: (prodDrains: DrainId[], framework: Framework) => OfferContext
}

/**
 * The answers a non-interactive run uses: flags first, then defaults.
 *
 * Same shape the prompts produce, so `--drain fs` and picking "Local files" in
 * the picker are the same run downstream.
 */
export function resolveAnswers(input: ResolveInput): InitAnswers {
  const devDrain = input.devDrain ?? 'fs'
  const prodDrains = input.prodDrains ?? []
  const extras = (input.extras ?? []).filter(id => applicableExtras(input).has(id))

  return {
    framework: input.framework,
    service: input.service ?? input.defaultService,
    devDrain,
    prodDrains,
    extras,
    enrichers: extras.includes('enrichers') ? input.enrichers ?? [...DEFAULT_ENRICHERS] : [],
    sampling: extras.includes('sampling') ? input.sampling ?? 'medium' : 'all',
    install: input.evlogInstalled ? false : input.install,
    agentGuide: input.agentGuide,
    agentLogs: input.agentLogs ?? true,
  }
}

/** Shared by {@link resolveAnswers} and {@link droppedExtras} — two views of one decision. */
function applicableExtras(input: ResolveInput): Set<ExtraId> {
  return new Set(
    availableExtras(input.offers(input.prodDrains ?? [], input.framework)).map(extra => extra.id),
  )
}

/** Extras asked for that this project cannot use — reported, not applied. */
export function droppedExtras(input: ResolveInput): ExtraId[] {
  const applicable = applicableExtras(input)
  return (input.extras ?? []).filter(id => !applicable.has(id))
}
