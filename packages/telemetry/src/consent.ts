import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getTelemetryDir } from './paths'
import { TelemetryOutbox } from './outbox'

/**
 * Persisted telemetry consent state for a tool.
 * - `unset` — no explicit choice; default consent applies.
 * - `enabled` — user opted in via `telemetry enable`.
 * - `disabled` — user opted out via `telemetry disable`.
 */
export type TelemetryPreference = 'enabled' | 'disabled' | 'unset'

interface PreferenceFile {
  preference: TelemetryPreference
}

const ON = new Set(['1', 'true', 'yes', 'on'])
const OFF = new Set(['0', 'false', 'no', 'off'])

function readSwitch(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === undefined) return undefined
  return ON.has(normalized) ? true : OFF.has(normalized) ? false : undefined
}

/**
 * Resolve consent: `DO_NOT_TRACK` → `EVLOG_TELEMETRY` → persisted preference.
 *
 * Both variables read `1`, `true`, `yes` and `on` as set, and `0`, `false`,
 * `no` and `off` as unset, in any case.
 */
export function resolveConsent(toolName: string): boolean {
  if (readSwitch(process.env.DO_NOT_TRACK) === true) return false
  const explicit = readSwitch(process.env.EVLOG_TELEMETRY)
  if (explicit !== undefined) return explicit

  const pref = readPreferenceSync(toolName)
  if (pref === 'disabled') return false
  if (pref === 'enabled') return true

  // Default: enabled (first-run notice handles disclosure)
  return true
}

/** Read persisted preference without throwing. */
export function readPreferenceSync(toolName: string): TelemetryPreference {
  try {
    const raw = readFileSync(join(getTelemetryDir(toolName), 'preference.json'), 'utf-8')
    const parsed = JSON.parse(raw) as PreferenceFile
    return parsed.preference ?? 'unset'
  } catch {
    return 'unset'
  }
}

/** Persist user telemetry preference. */
export async function writePreference(toolName: string, preference: TelemetryPreference): Promise<void> {
  const dir = getTelemetryDir(toolName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'preference.json'), JSON.stringify({ preference }), 'utf-8')
}

/** Remove the outbox on opt-out (retroactive on undelivered data). */
export async function purgeOutbox(toolName: string): Promise<void> {
  await new TelemetryOutbox({ toolName }).purge()
}
