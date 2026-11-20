import { defineExtension } from 'eve/extension'
import type { EvlogConfig, LoggerConfig } from 'evlog'
import { z } from 'zod'

/**
 * How much of a turn the event records.
 *
 * - `minimal`: outcome, duration, usage and errors.
 * - `standard`: adds every tool, skill and subagent call, approvals and lineage.
 * - `debug`: adds tool inputs and outputs and a reply preview, all redacted.
 */
export type EvlogEveRecord = 'minimal' | 'standard' | 'debug'

/** Per-tool override of the preset. `false` leaves the tool out of the event. */
export type EvlogEveToolRule = boolean | { input?: boolean, output?: boolean }

export interface EvlogEveConfig extends Omit<EvlogConfig, 'extends' | 'map' | 'logs'> {
  /** @default 'standard' */
  record?: EvlogEveRecord
  /**
   * Rules keyed by tool name as the model sees it, such as `issue_refund` or
   * `crm__search`. A key ending in `*` matches by prefix.
   */
  tools?: Record<string, EvlogEveToolRule>
  /**
   * Passed to `initLogger` as is, in place of the settings above, when nothing
   * initialised evlog before the first turn. Gives events emitted outside a
   * turn their own drain or service.
   */
  init?: LoggerConfig
}

const config = z.custom<EvlogEveConfig>(
  value => typeof value === 'object' && value !== null && !Array.isArray(value),
  'evlog for eve expects an options object',
).optional().default({})

export default defineExtension({ config })
