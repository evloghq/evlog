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
import { formatPath, isPlainObject, readConfig, readModuleOptions, RuntimeValue } from './read'

export { formatPath, RuntimeValue } from './read'

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
  /**
   * Where each setting is written, as `file:line`, by {@link formatPath}. An
   * item of a list `extends` appends to has its own entry, `redact.paths[0]`.
   */
  sources: ReadonlyMap<string, string>
  map: MapSettings
  logs: LogsSettings
}

/** The options a framework config passes to the evlog module, which the module lays over `evlog.config`. */
export interface ModuleOptions {
  file: string
  /** A {@link RuntimeValue} when the options are computed at runtime. */
  value: Record<string, unknown> | RuntimeValue
  /** Where each option is written, as `file:line`, by {@link formatPath}. */
  sources: ReadonlyMap<string, string>
}

/** Framework configs that can pass options to the evlog module, looked up in the package directory. */
const MODULE_CONFIG_FILES = ['nuxt.config', 'nitro.config'].flatMap(base => ['ts', 'mts', 'js', 'mjs'].map(extension => `${base}.${extension}`))

const MAP_KEYS = ['rules', 'ignore', 'minScore', 'baseline']
/** The map sorts entry points into instrumented, partial and dark by these, so neither can be turned off. */
const CORE_RULES: ReadonlySet<string> = new Set<CheckId>(['wide-event', 'context'])
const LOGS_KEYS = ['dir', 'limit']

/** Lists `mergeEvlogConfig` appends the child's items to instead of replacing. */
const APPENDED_LISTS: readonly (readonly string[])[] = [['redact', 'paths'], ['redact', 'patterns'], ['sampling', 'keep']]

/** True for a list whose items can come from both files of an `extends`. */
export function isAppendedList(path: readonly (string | number)[]): boolean {
  return APPENDED_LISTS.some(list => list.length === path.length && list.every((key, index) => key === path[index]))
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let at = value
  for (const key of path) at = isPlainObject(at) ? at[key] : undefined
  return at
}

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

/**
 * Read the options `nuxt.config` or `nitro.config` passes to the evlog module
 * in `project`, or `null` when it passes none. The module lays them over
 * `evlog.config`, so they win key by key.
 *
 * @throws a `cli.CONFIG_PARSE_FAILED` error when the framework config does not parse.
 */
export function loadModuleOptions(project: ProjectInfo): ModuleOptions | null {
  const file = MODULE_CONFIG_FILES.map(name => join(project.packageDir, name)).find(path => existsSync(path))
  const options = file ? readModuleOptions(file, path => prettyPath(project.cwd, path)) : null
  if (!options) return null
  const label = prettyPath(project.cwd, options.file)
  return { file: options.file, value: options.value, sources: new Map([...options.lines].map(([path, line]) => [path, `${label}:${line}`])) }
}

type At = (path: string) => string

function staticValue(value: unknown, key: string, at: At): unknown {
  if (value instanceof RuntimeValue) throw cliErrors.CONFIG_NOT_STATIC({ key, at: at(key) })
  return value
}

function section(value: unknown, path: readonly string[], allowed: readonly string[], at: At): Record<string, unknown> {
  const key = formatPath(path)
  if (staticValue(value, key, at) === undefined) return {}
  if (!isPlainObject(value)) throw cliErrors.CONFIG_INVALID({ key, at: at(key), problem: 'must be an object' })
  for (const name of Object.keys(value)) {
    if (allowed.includes(name)) continue
    const child = formatPath([...path, name])
    throw cliErrors.CONFIG_INVALID({ key: child, at: at(child), problem: `is not a setting; expected ${allowed.join(', ')}` })
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
  const map = section(value, ['map'], MAP_KEYS, at)
  const ids = RULES.map(rule => rule.id)
  const off = new Set<CheckId>()
  for (const [id, state] of Object.entries(section(map.rules, ['map', 'rules'], ids, at))) {
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
  const logs = section(value, ['logs'], LOGS_KEYS, at)
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

  const documents = parent ? [parent.document, config] : [config]
  const sources = new Map<string, string>()
  for (const document of documents) {
    for (const [path, line] of document.lines) sources.set(path, `${label(document.file)}:${line}`)
  }
  const sourceIn = (document: ConfigDocument, path: readonly string[]): string | undefined => {
    for (let end = path.length; end > 0; end--) {
      const line = document.lines.get(formatPath(path.slice(0, end)))
      if (line !== undefined) return `${label(document.file)}:${line}`
    }
    return undefined
  }
  for (const list of APPENDED_LISTS) {
    let index = 0
    for (const document of documents) {
      const items = valueAt(document.value, list)
      if (!Array.isArray(items)) continue
      const source = sourceIn(document, list)
      for (let item = 0; item < items.length; item++, index++) {
        if (source) sources.set(formatPath([...list, index]), source)
      }
    }
  }

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
