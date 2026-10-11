import type { CliContext } from '../core/context'
import { createStyle } from '../core/output'
import { defineEvlogCommand, failWith } from '../lib/command'
import { formatPath, isAppendedList, loadCliConfig, RuntimeValue } from '../lib/config'
import { isPlainObject } from '../lib/config/read'
import type { CliDebug } from '../lib/debug'
import { createNoopCliDebug } from '../lib/debug'
import { prettyPath, resolveProject } from '../lib/project'

type ConfigPath = readonly (string | number)[]
type Paint = ReturnType<typeof createStyle>['paint']

/** One setting of the resolved config. */
export interface ConfigEntry {
  /** Keys down to the setting, `['sampling', 'rates', 'info']`. Each item of a list `extends` appends to is its own entry. */
  path: ConfigPath
  value: unknown
  /** Where the setting is written, as `file:line`, or `null` when it comes from a file that only contributes values. */
  source: string | null
}

/** Typed result of `evlog config`, rendered by {@link formatConfigReport}. */
export interface ConfigResult {
  /** Where the lookup started and stopped, so a missing config says where it was looked for. */
  searched: { from: string, to: string }
  /** Relative to the working directory, or `null` when no config applies. */
  file: string | null
  extends: { specifier: string | null, file: string } | null
  /** Settings the CLI applies itself (`map`, `logs`). */
  cli: ConfigEntry[]
  /** Settings the app reads where it imports the config. */
  app: ConfigEntry[]
  /** Where each key is written, by {@link formatPath}, for rows that stand for a whole object such as `redact`. */
  sources: ReadonlyMap<string, string>
}

/** Sections the CLI reads; everything else in the file is for the app. */
const CLI_SECTIONS: ReadonlySet<unknown> = new Set(['map', 'logs'])

function sourceOf(path: ConfigPath, sources: ReadonlyMap<string, string>): string | null {
  for (let end = path.length; end > 0; end--) {
    const source = sources.get(formatPath(path.slice(0, end)))
    if (source) return source
  }
  return null
}

function entriesOf(value: unknown, path: ConfigPath, sources: ReadonlyMap<string, string>): ConfigEntry[] {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, child]) => entriesOf(child, [...path, key], sources))
  }
  if (Array.isArray(value) && value.length > 0 && isAppendedList(path)) {
    return value.map((item, index) => ({ path: [...path, index], value: item, source: sourceOf([...path, index], sources) }))
  }
  return [{ path, value, source: sourceOf(path, sources) }]
}

/**
 * Read the `evlog.config` that applies to `ctx.cwd`, merged across `extends`,
 * with where each setting is written. Pure with respect to the context.
 *
 * @throws a `cli.CONFIG_*` error when the file cannot be read statically.
 */
export async function runConfig(ctx: CliContext, log: CliDebug = createNoopCliDebug()): Promise<ConfigResult> {
  const project = await log.step('resolveProject', () => resolveProject(ctx.cwd), p => ({ project: { root: p.root, packageDir: p.packageDir } }))
  const searched = { from: prettyPath(ctx.cwd, project.packageDir), to: prettyPath(ctx.cwd, project.root) }
  const config = await log.step('loadConfig', () => loadCliConfig(project), c => ({ config: c && { file: c.file, extends: c.extends?.file ?? null } }))
  if (!config) return { searched, file: null, extends: null, cli: [], app: [], sources: new Map() }

  const entries = Object.entries(config.resolved).flatMap(([key, value]) => entriesOf(value, [key], config.sources))
  return {
    searched,
    file: prettyPath(ctx.cwd, config.file),
    extends: config.extends && { specifier: config.extends.specifier, file: prettyPath(ctx.cwd, config.extends.file) },
    cli: entries.filter(entry => CLI_SECTIONS.has(entry.path[0])),
    app: entries.filter(entry => !CLI_SECTIONS.has(entry.path[0])),
    sources: config.sources,
  }
}

/** A value as it reads in source: strings quoted, regexps as literals, runtime values by what they call. */
export function formatValue(value: unknown): string {
  if (value instanceof RuntimeValue) return value.label
  if (typeof value === 'string') return `'${value}'`
  if (value instanceof RegExp) return String(value)
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  if (isPlainObject(value)) {
    const fields = Object.entries(value).map(([key, field]) => `${key}: ${formatValue(field)}`)
    return fields.length > 0 ? `{ ${fields.join(', ')} }` : '{}'
  }
  return String(value)
}

/** JSON can't hold a RegExp; written as `{ regexp }`, the way runtime values are written as `{ runtime }`. */
function jsonValue(value: unknown): unknown {
  if (value instanceof RegExp) return { regexp: String(value) }
  if (Array.isArray(value)) return value.map(jsonValue)
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, jsonValue(field)]))
  return value
}

/** The `--json` payload: entries keyed by path, values JSON-safe. */
export function configJson(result: ConfigResult): Record<string, unknown> {
  const settings = (entries: ConfigEntry[]) => entries.map(entry => ({ path: formatPath(entry.path), value: jsonValue(entry.value), source: entry.source }))
  return { file: result.file, extends: result.extends, cli: settings(result.cli), app: settings(result.app) }
}

interface Row {
  label: string
  value: string
  source: string | null
  /** Computed when the app starts, painted apart from literals. */
  runtime?: boolean
  /** Not a setting, a note about one (`none in this file`). */
  muted?: boolean
  /** What the setting covers, under the row. */
  note?: string
  warning?: string
}

interface Section {
  title: string
  note?: string
  rows: Row[]
}

const DEFAULT = 'default'
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
/** evlog's builtin redaction patterns, by name. */
const BUILTIN_PATTERNS = ['creditCard', 'email', 'ipv4', 'phone', 'jwt', 'bearer', 'iban']
const PIPELINE = ['drain', 'enrich', 'keep', 'plugins', 'waitUntil']
const KEEP_FIELDS: ReadonlySet<string> = new Set(['status', 'duration', 'path'])
/** Keys the app sections above lay out; anything else lands in Other. */
const APP_SECTIONS: ReadonlySet<unknown> = new Set(['service', 'environment', 'env', 'routes', 'sampling', 'minLevel', 'redact', ...PIPELINE])

function startsWith(path: ConfigPath, prefix: ConfigPath): boolean {
  return prefix.length <= path.length && prefix.every((key, index) => path[index] === key)
}

function under(entries: ConfigEntry[], prefix: ConfigPath): ConfigEntry[] {
  return entries.filter(entry => startsWith(entry.path, prefix))
}

function exact(entries: ConfigEntry[], path: ConfigPath): ConfigEntry | undefined {
  return entries.find(entry => entry.path.length === path.length && startsWith(entry.path, path))
}

function settingRow(entry: ConfigEntry, label = formatPath(entry.path)): Row {
  return { label, value: formatValue(entry.value), source: entry.source, runtime: entry.value instanceof RuntimeValue }
}

/** A setting that reads as text, a service name or a path, so a string goes unquoted. */
function textRow(entry: ConfigEntry, label: string): Row {
  return typeof entry.value === 'string' ? { label, value: entry.value, source: entry.source } : settingRow(entry, label)
}

/** Rows for a list, the label on the first item only. */
function listRows(entries: ConfigEntry[], label: string, describe: (value: unknown) => string, then = ''): Row[] {
  return entries.map((entry, index) => ({
    label: index === 0 ? label : then,
    value: describe(entry.value),
    source: entry.source,
    runtime: entry.value instanceof RuntimeValue,
  }))
}

/** The rows for every entry of `scope` a section did not lay out itself. */
function restRows(scope: ConfigEntry[], used: ReadonlySet<ConfigEntry | undefined>): Row[] {
  return scope.filter(entry => !used.has(entry)).map(entry => settingRow(entry))
}

function serviceSection(app: ConfigEntry[]): Section {
  const routes = under(app, ['routes'])
  const rows = routes.map(entry => entry.path.length === 3 && entry.path[2] === 'service' ? textRow(entry, String(entry.path[1])) : settingRow(entry))
  const service = exact(app, ['service']) ?? exact(app, ['env', 'service'])
  const environment = exact(app, ['environment']) ?? exact(app, ['env', 'environment'])
  const fallback = routes.length > 0 ? 'any other route' : 'service'
  rows.push(
    service ? textRow(service, fallback) : { label: fallback, value: 'from SERVICE_NAME, else app', source: DEFAULT },
    environment ? textRow(environment, 'environment') : { label: 'environment', value: 'from NODE_ENV', source: DEFAULT },
    ...restRows([...under(app, ['service']), ...under(app, ['environment']), ...under(app, ['env'])], new Set([service, environment])),
  )
  return routes.length > 0 ? { title: 'Services', note: 'first matching route wins', rows } : { title: 'Service', rows }
}

function errorWarning(percent: number): string | undefined {
  if (percent <= 0) return 'every error is dropped'
  if (percent < 100) return `${100 - percent}% of errors are dropped`
  return undefined
}

function describeKeep(value: unknown): string {
  if (!isPlainObject(value) || Object.keys(value).length === 0 || !Object.keys(value).every(key => KEEP_FIELDS.has(key))) return formatValue(value)
  const parts: string[] = []
  if (value.status !== undefined) parts.push(`status ≥ ${formatValue(value.status)}`)
  if (value.duration !== undefined) parts.push(`duration ≥ ${formatValue(value.duration)}ms`)
  if (value.path !== undefined) parts.push(`path ${typeof value.path === 'string' ? value.path : formatValue(value.path)}`)
  return parts.join(' or ')
}

function samplingSection(app: ConfigEntry[]): Section {
  const used = new Set<ConfigEntry | undefined>()
  const minLevel = exact(app, ['minLevel'])
  const rows: Row[] = []

  for (const level of LEVELS) {
    const rate = exact(app, ['sampling', 'rates', level])
    used.add(rate)
    if (level === 'fatal') {
      rows.push({ label: level, value: 'always', source: DEFAULT, warning: rate && `rates.fatal at ${rate.source ?? 'the config'} is ignored, fatal events are always kept` })
    } else if (!rate) {
      rows.push({ label: level, value: level === 'trace' ? '0%' : '100%', source: DEFAULT })
    } else if (typeof rate.value === 'number') {
      rows.push({ label: level, value: `${rate.value}%`, source: rate.source, warning: level === 'error' ? errorWarning(rate.value) : undefined })
    } else {
      rows.push(settingRow(rate, level))
    }
  }

  if (minLevel) rows.push({ ...textRow(minLevel, 'minLevel'), note: 'applies to the global log API only, not request wide events' })
  used.add(minLevel)
  const keep = under(app, ['sampling', 'keep'])
  for (const entry of keep) used.add(entry)
  rows.push(...listRows(keep, 'keep if', describeKeep, 'or'), ...restRows(under(app, ['sampling']), used))
  return { title: 'Sampling', rows }
}

function redactionSection(app: ConfigEntry[], sources: ReadonlyMap<string, string>): Section {
  const scope = under(app, ['redact'])
  const root = exact(app, ['redact'])
  const all = BUILTIN_PATTERNS.join(', ')
  if (scope.length === 0) {
    return { title: 'Redaction', rows: [
      { label: 'redact', value: 'on in production, off in dev', source: DEFAULT },
      { label: 'builtins', value: all, source: DEFAULT },
    ] }
  }
  if (root && !isPlainObject(root.value)) {
    if (root.value === false) return { title: 'Redaction', rows: [{ label: 'redact', value: 'off', source: root.source }] }
    if (root.value === true) return { title: 'Redaction', rows: [{ label: 'redact', value: 'on', source: root.source }, { label: 'builtins', value: all, source: root.source }] }
    return { title: 'Redaction', rows: [settingRow(root, 'redact')] }
  }

  const source = sourceOf(['redact'], sources)
  const builtins = exact(app, ['redact', 'builtins'])
  const paths = under(app, ['redact', 'paths'])
  const patterns = under(app, ['redact', 'patterns'])
  const builtinsRow: Row = !builtins || builtins.value === true
    ? { label: 'builtins', value: all, source: builtins?.source ?? DEFAULT }
    : builtins.value === false
      ? { label: 'builtins', value: 'none', source: builtins.source }
      : Array.isArray(builtins.value) && builtins.value.every(name => typeof name === 'string')
        ? { label: 'builtins', value: builtins.value.join(', '), source: builtins.source }
        : settingRow(builtins, 'builtins')
  return { title: 'Redaction', rows: [
    { label: 'redact', value: 'on', source },
    builtinsRow,
    ...listRows(paths, 'paths', value => typeof value === 'string' ? value : formatValue(value)),
    ...listRows(patterns, 'patterns', formatValue),
    ...restRows(scope, new Set([root, builtins, ...paths, ...patterns])),
  ] }
}

function pipelineSection(app: ConfigEntry[]): Section {
  const rows = PIPELINE.flatMap(key => under(app, [key]).flatMap((entry): Row[] => Array.isArray(entry.value) && entry.value.length > 0
    ? entry.value.map((item, index) => ({ label: index === 0 ? formatPath(entry.path) : '', value: formatValue(item), source: entry.source, runtime: item instanceof RuntimeValue }))
    : [settingRow(entry)]))
  if (under(app, ['drain']).length === 0) rows.unshift({ label: 'drain', value: 'none in this file', source: null, muted: true })
  return { title: 'Pipeline', rows }
}

function renderSection(section: Section, paint: Paint): string[] {
  const labelWidth = Math.max(...section.rows.map(row => row.label.length))
  const valueWidth = Math.max(...section.rows.map(row => row.value.length))
  const lines = [paint('bold', section.title) + (section.note ? paint('dim', ` · ${section.note}`) : '')]
  for (const row of section.rows) {
    const value = row.runtime ? paint('magenta', row.value) : row.muted ? paint('dim', row.value) : row.value
    const source = row.source ? `${' '.repeat(valueWidth - row.value.length)}  ${paint('dim', row.source)}` : ''
    lines.push(`  ${paint('cyan', row.label.padEnd(labelWidth))}  ${value}${source}`)
    if (row.warning) lines.push(`  ${' '.repeat(labelWidth)}  ${paint('yellow', `⚠ ${row.warning}`)}`)
    if (row.note) lines.push(`  ${' '.repeat(labelWidth)}  ${paint('dim', row.note)}`)
  }
  return lines
}

/**
 * The config laid out by what it does: services, sampling per level,
 * redaction, the pipeline, then the CLI's own settings. Each row says where
 * it is written, or `default` for what evlog does when the file is silent.
 */
export function formatConfigReport(ctx: CliContext, result: ConfigResult): string {
  const { paint } = createStyle(ctx)
  if (!result.file) {
    const range = result.searched.from === result.searched.to ? result.searched.from : `${result.searched.from} up to ${result.searched.to}`
    return [
      `No evlog.config from ${range}.`,
      paint('dim', '→ add an evlog.config.ts exporting defineEvlog({ … }): https://evlog.dev/cli/config'),
      '',
    ].join('\n')
  }

  const parent = result.extends && (result.extends.specifier ? `${result.extends.specifier} → ${result.extends.file}` : result.extends.file)
  const lines = [result.file + (parent ? paint('dim', ` · extends ${parent}`) : '')]
  const sections: Section[] = []
  if (result.app.length > 0) {
    sections.push(serviceSection(result.app), samplingSection(result.app), redactionSection(result.app, result.sources), pipelineSection(result.app))
  }
  const other = result.app.filter(entry => !APP_SECTIONS.has(entry.path[0]))
  if (other.length > 0) sections.push({ title: 'Other', rows: other.map(entry => settingRow(entry)) })
  if (result.cli.length > 0) sections.push({ title: 'CLI', note: 'read by evlog map and evlog logs', rows: result.cli.map(entry => settingRow(entry)) })

  if (sections.length === 0) lines.push('', paint('dim', 'The config sets nothing.'))
  for (const section of sections) lines.push('', ...renderSection(section, paint))
  lines.push('')
  return lines.join('\n')
}

/**
 * `evlog config`: the `evlog.config` that applies here, merged across
 * `extends`, and where each setting comes from.
 * Logic lives in {@link runConfig}; this file owns the citty surface.
 */
export default defineEvlogCommand('config', {
  meta: { name: 'config' },
  async run({ args, cli, log, ui }) {
    let result: ConfigResult
    try {
      result = await runConfig(cli, log)
    } catch (error) {
      failWith(error, { args, log, ui })
      return
    }
    ui.done({ jsonMode: args.json, json: configJson(result), human: formatConfigReport(cli, result) })
  },
})
