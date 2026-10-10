import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { mergeEvlogConfig } from 'evlog'
import type { EvlogConfig } from 'evlog'
import { cliErrors } from '../errors'
import { RULES } from '../map/rules'
import type { CheckId } from '../map/types'
import { prettyPath } from '../project'
import type { ProjectInfo } from '../project'
import type { ConfigDocument } from './read'
import { isPlainObject, readConfig, RuntimeValue } from './read'

export { RuntimeValue } from './read'

/** Names `evlog.config` is looked up under, in order, in each directory. */
export const CONFIG_FILES = ['evlog.config.ts', 'evlog.config.mts', 'evlog.config.js', 'evlog.config.mjs'] as const

/** `map` settings once read and checked. */
export interface MapSettings {
  /** Checks turned off for every entry point. */
  off: ReadonlySet<CheckId>
  /** Entry points left out, as globs relative to the package directory. */
  ignore: readonly string[]
  minScore?: number
  baseline?: true | string
}

/** `logs` settings once read and checked. */
export interface LogsSettings {
  /** Absolute. */
  dir?: string
  limit?: number
}

/** The `evlog.config` that applies to a project, as the CLI reads it. */
export interface CliConfig {
  file: string
  /** The config `file` extends: the import specifier (`null` for one in the same file) and the file it resolved to. */
  extends: { specifier: string | null, file: string } | null
  /** Every setting, merged across `extends`. Values computed at runtime are kept as {@link RuntimeValue}. */
  resolved: Record<string, unknown>
  /** Where each setting is written, as `file:line`, by dotted path. */
  sources: ReadonlyMap<string, string>
  map: MapSettings
  logs: LogsSettings
}

const MAP_KEYS = ['rules', 'ignore', 'minScore', 'baseline']
/** The map sorts entry points into instrumented, partial and dark by these, so neither can be turned off. */
const CORE_RULES: ReadonlySet<string> = new Set<CheckId>(['wide-event', 'context'])
const LOGS_KEYS = ['dir', 'limit']

/**
 * The nearest `evlog.config` from the package directory up to the workspace
 * root. The first one found applies on its own: configs do not cascade.
 */
export function findConfigFile(project: ProjectInfo): string | null {
  let dir = project.packageDir
  for (;;) {
    for (const name of CONFIG_FILES) {
      const file = join(dir, name)
      if (existsSync(file)) return file
    }
    const parent = dirname(dir)
    if (dir === project.root || parent === dir) return null
    dir = parent
  }
}

type At = (path: string) => string

function staticValue(value: unknown, key: string, at: At): unknown {
  if (value instanceof RuntimeValue) throw cliErrors.CONFIG_NOT_STATIC({ key, at: at(key) })
  return value
}

function section(value: unknown, key: string, allowed: readonly string[], at: At): Record<string, unknown> {
  if (staticValue(value, key, at) === undefined) return {}
  if (!isPlainObject(value)) throw cliErrors.CONFIG_INVALID({ key, at: at(key), problem: 'must be an object' })
  for (const name of Object.keys(value)) {
    if (allowed.includes(name)) continue
    const path = `${key}.${name}`
    throw cliErrors.CONFIG_INVALID({ key: path, at: at(path), problem: `is not a setting; expected ${allowed.join(', ')}` })
  }
  return value
}

function wholeNumber(value: unknown, key: string, at: At, { min, max = Number.POSITIVE_INFINITY }: { min: number, max?: number }): number | undefined {
  if (staticValue(value, key, at) === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    const range = Number.isFinite(max) ? `from ${min} to ${max}` : `of ${min} or more`
    throw cliErrors.CONFIG_INVALID({ key, at: at(key), problem: `must be a whole number ${range}` })
  }
  return value
}

function readMap(value: unknown, at: At): MapSettings {
  const map = section(value, 'map', MAP_KEYS, at)
  const ids = RULES.map(rule => rule.id)
  const off = new Set<CheckId>()
  for (const [id, state] of Object.entries(section(map.rules, 'map.rules', ids, at))) {
    const key = `map.rules.${id}`
    if (staticValue(state, key, at) !== 'on' && state !== 'off') {
      throw cliErrors.CONFIG_INVALID({ key, at: at(key), problem: 'must be \'on\' or \'off\'' })
    }
    if (state === 'off' && CORE_RULES.has(id)) {
      throw cliErrors.CONFIG_INVALID({ key, at: at(key), problem: 'cannot be turned off: the map classifies entry points by it. Leave entry points out with map.ignore instead' })
    }
    if (state === 'off') off.add(id as CheckId)
  }

  const ignore = staticValue(map.ignore, 'map.ignore', at) ?? []
  if (!Array.isArray(ignore) || ignore.some(glob => typeof glob !== 'string' || glob.length === 0)) {
    throw cliErrors.CONFIG_INVALID({ key: 'map.ignore', at: at('map.ignore'), problem: 'must be a list of globs' })
  }

  const baseline = staticValue(map.baseline, 'map.baseline', at)
  if (baseline !== undefined && baseline !== true && (typeof baseline !== 'string' || baseline.length === 0)) {
    throw cliErrors.CONFIG_INVALID({ key: 'map.baseline', at: at('map.baseline'), problem: 'must be true, a path, or git:<ref>' })
  }

  return { off, ignore, minScore: wholeNumber(map.minScore, 'map.minScore', at, { min: 0, max: 100 }), baseline }
}

function readLogs(value: unknown, packageDir: string, at: At): LogsSettings {
  const logs = section(value, 'logs', LOGS_KEYS, at)
  const dir = staticValue(logs.dir, 'logs.dir', at)
  if (dir !== undefined && (typeof dir !== 'string' || dir.length === 0)) {
    throw cliErrors.CONFIG_INVALID({ key: 'logs.dir', at: at('logs.dir'), problem: 'must be a path' })
  }
  return {
    dir: dir === undefined ? undefined : resolve(packageDir, dir),
    limit: wholeNumber(logs.limit, 'logs.limit', at, { min: 1 }),
  }
}

/**
 * Read the `evlog.config` that applies to `project`, or `null` when there is
 * none. The file is parsed, never run, so `map` and `logs` have to be literals;
 * anything else in it is kept as a {@link RuntimeValue}.
 *
 * @throws a `cli.CONFIG_*` error when the file cannot be read that way or a
 * `map` / `logs` setting is invalid.
 */
export function loadCliConfig(project: ProjectInfo): CliConfig | null {
  const file = findConfigFile(project)
  if (!file) return null
  const label = (path: string): string => prettyPath(project.cwd, path)
  const { config, parent } = readConfig(file, label)

  const sources = new Map<string, string>()
  const record = (document: ConfigDocument): void => {
    for (const [path, line] of document.lines) sources.set(path, `${label(document.file)}:${line}`)
  }
  if (parent) record(parent.document)
  record(config)

  const resolved = parent
    ? mergeEvlogConfig(parent.document.value as EvlogConfig, config.value as EvlogConfig) as Record<string, unknown>
    : config.value
  const at: At = path => sources.get(path) ?? label(file)

  return {
    file,
    extends: parent ? { specifier: parent.specifier, file: parent.document.file } : null,
    resolved,
    sources,
    map: readMap(resolved.map, at),
    logs: readLogs(resolved.logs, project.packageDir, at),
  }
}
