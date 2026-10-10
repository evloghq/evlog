import type { CliContext } from '../core/context'
import { createStyle } from '../core/output'
import { defineEvlogCommand, failWith } from '../lib/command'
import { loadCliConfig, RuntimeValue } from '../lib/config'
import { isPlainObject } from '../lib/config/read'
import type { CliDebug } from '../lib/debug'
import { createNoopCliDebug } from '../lib/debug'
import { prettyPath, resolveProject } from '../lib/project'

/** One setting of the resolved config. */
export interface ConfigEntry {
  /** Dotted path, `sampling.rates.info`. */
  path: string
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
}

/** Sections the CLI reads; everything else in the file is for the app. */
const CLI_SECTIONS = new Set(['map', 'logs'])

function sourceOf(path: string, sources: ReadonlyMap<string, string>): string | null {
  for (let at = path; at; at = at.slice(0, Math.max(0, at.lastIndexOf('.')))) {
    const source = sources.get(at)
    if (source) return source
  }
  return null
}

function entriesOf(value: Record<string, unknown>, sources: ReadonlyMap<string, string>, prefix = ''): ConfigEntry[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(child) && Object.keys(child).length > 0) return entriesOf(child, sources, path)
    return [{ path, value: child, source: sourceOf(path, sources) }]
  })
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
  if (!config) return { searched, file: null, extends: null, cli: [], app: [] }

  const entries = entriesOf(config.resolved, config.sources)
  const section = (entry: ConfigEntry): string => entry.path.split('.')[0]!
  return {
    searched,
    file: prettyPath(ctx.cwd, config.file),
    extends: config.extends && { specifier: config.extends.specifier, file: prettyPath(ctx.cwd, config.extends.file) },
    cli: entries.filter(entry => CLI_SECTIONS.has(section(entry))),
    app: entries.filter(entry => !CLI_SECTIONS.has(section(entry))),
  }
}

/** A value as it reads in source: strings quoted, regexps as literals, runtime values as their code. */
export function formatValue(value: unknown): string {
  if (value instanceof RuntimeValue) return value.code
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
  const settings = (entries: ConfigEntry[]) => entries.map(entry => ({ ...entry, value: jsonValue(entry.value) }))
  return { file: result.file, extends: result.extends, cli: settings(result.cli), app: settings(result.app) }
}

const VALUE_WIDTH = 48

/** Settings in aligned columns, grouped by who reads them, each with where it is written. */
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
  const lines = [result.file + (parent ? paint('dim', ` · extends ${parent}`) : ''), '']
  const all = [...result.cli, ...result.app]
  const pathWidth = Math.max(...all.map(entry => entry.path.length))
  const valueWidth = Math.min(VALUE_WIDTH, Math.max(...all.map(entry => formatValue(entry.value).length)))

  const group = (title: string, note: string, entries: ConfigEntry[]): void => {
    if (entries.length === 0) return
    lines.push(`${paint('dim', title)} ${paint('dim', `· ${note}`)}`)
    for (const entry of entries) {
      const raw = formatValue(entry.value)
      const value = raw.length > VALUE_WIDTH ? `${raw.slice(0, VALUE_WIDTH - 1)}…` : raw
      const shown = entry.value instanceof RuntimeValue ? paint('magenta', value) : value
      const pad = ' '.repeat(Math.max(0, valueWidth - value.length))
      lines.push(`  ${paint('cyan', entry.path.padEnd(pathWidth))}  ${shown}${pad}  ${paint('dim', entry.source ?? '')}`.trimEnd())
    }
    lines.push('')
  }

  group('CLI', 'applied by evlog map and evlog logs', result.cli)
  group('APP', 'applied where the app imports the config', result.app)
  if (all.length === 0) lines.push(paint('dim', 'The config sets nothing.'), '')
  return lines.join('\n')
}

/**
 * `evlog config` — the `evlog.config` that applies here, merged across
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
