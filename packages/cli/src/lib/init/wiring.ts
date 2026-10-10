import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { DOCS_URL } from '../../core/output'
import { readConfig as readEvlogConfig } from '../config/read'
import { getFramework } from '../frameworks'
import type { InitFramework } from '../frameworks'
import { findDestination, findEnricher, findSamplingPreset } from './catalog'
import type { DrainId, EnricherId, ExtraId, SamplingProfile } from './catalog'
import { auditActionName } from './insight'
import type { AuditGap, RepeatedErrorSeed } from './insight'

/** A file `init` will write — always the full new contents, never a patch. */
export interface FileAction {
  path: string
  relative: string
  kind: 'create' | 'patch'
  contents: string
}

/** A step `init` will not do for you, with the code to paste and why. */
export interface ManualStep {
  title: string
  file: string
  snippet: string
  reason: string
}

export interface WiringPlan {
  actions: FileAction[]
  manual: ManualStep[]
  /** Wiring that is already in place — printed so the run is never silent. */
  already: string[]
}

export interface WiringInput {
  /** Package root — where configs live and files are written. */
  root: string
  /** Workspace root: the highest directory a parent `evlog.config` is looked for in. Defaults to `root`. */
  workspaceRoot?: string
  framework: InitFramework
  service: string
  /** Local sink: `fs` or `none`. */
  devDrain: DrainId
  /** Where production events go. Empty means nothing leaves the process. */
  prodDrains: DrainId[]
  /** Opt-in additions layered onto the drain and the config. */
  extras: ExtraId[]
  /** Which enrichers to wire, when the `enrichers` extra was selected. */
  enrichers: EnricherId[]
  /** Sampling preset, when the `sampling` extra was selected. */
  sampling: SamplingProfile
  /** Nitro major, when the framework is Nitro (`tanstack-start` is always v3). */
  nitroMajor: 2 | 3
  /** Seeds from the scan, when the catalog extras were selected. */
  repeatedErrors: readonly RepeatedErrorSeed[]
  auditGaps: readonly AuditGap[]
}

/** Every destination this run wires, dev and prod alike. */
function allDrains(input: WiringInput): DrainId[] {
  return [...new Set([input.devDrain, ...input.prodDrains])].filter(id => id !== 'none')
}

/** Whether a file already calls every drain factory this run would wire. */
function wiresEveryDrain(path: string, input: WiringInput): boolean {
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    return false
  }

  return allDrains(input).every((id) => {
    const factory = findDestination(id)?.factory
    return factory ? source.includes(factory.replace('()', '')) : true
  })
}

/** The same destination chosen for dev and production is one import, not two. */
function dedupeDestinations<T extends { id: DrainId }>(destinations: T[]): T[] {
  const seen = new Set<DrainId>()
  return destinations.filter((destination) => {
    if (seen.has(destination.id)) return false
    seen.add(destination.id)
    return true
  })
}

function describeDrains(input: WiringInput): string {
  const labels = allDrains(input).map(id => findDestination(id)?.label ?? id)
  return labels.length > 0 ? labels.join(' and ') : 'the console'
}

export function firstExisting(root: string, names: string[]): string | null {
  for (const name of names) {
    if (existsSync(join(root, name))) return join(root, name)
  }
  return null
}

const CONFIG_EXTENSIONS = ['ts', 'mts', 'js', 'mjs']

export function configCandidates(base: string): string[] {
  return CONFIG_EXTENSIONS.map(ext => `${base}.${ext}`)
}

/** Frameworks Nitro builds the server for, where `import.meta.dev` is replaced at build time. */
function isNitroFamily(framework: InitFramework): boolean {
  return framework === 'nuxt' || framework === 'nitro' || framework === 'tanstack-start'
}

/** A setting this run puts in `evlog.config.ts`. */
export type ConfigSetting = 'drain' | 'enrich' | 'sampling'

/** The settings the run's answers add to `evlog.config.ts`. */
export function chosenSettings(input: WiringInput): ConfigSetting[] {
  const settings: ConfigSetting[] = []
  if (allDrains(input).length > 0) settings.push('drain')
  if (input.extras.includes('enrichers') && input.enrichers.length > 0) settings.push('enrich')
  if (input.extras.includes('sampling') && findSamplingPreset(input.sampling)?.rates) settings.push('sampling')
  return settings
}

/** The pieces of the generated `evlog.config.ts`, also used for the snippets of a config init does not write. */
interface FactoryParts {
  imports: string[]
  /** Statements that go above `defineEvlog`. */
  preamble: string
  /** Option keys, each already indented and comma-terminated. */
  options: string[]
}

export function factoryParts(input: WiringInput, settings: readonly ConfigSetting[] = chosenSettings(input)): FactoryParts {
  const wired = settings.includes('drain')
  const dev = wired && input.devDrain !== 'none' ? findDestination(input.devDrain) ?? null : null
  const prod = wired
    ? input.prodDrains.map(id => findDestination(id)).filter(Boolean) as NonNullable<ReturnType<typeof findDestination>>[]
    : []
  const batched = input.extras.includes('pipeline') && prod.length > 0

  const imports: string[] = []
  if (batched) imports.push(`import type { DrainContext } from 'evlog'`)
  /* Deduped by id: nothing stops the same destination being the local sink and
     a production one, and importing its factory twice is a file that does not
     compile. */
  for (const destination of dedupeDestinations([...(dev ? [dev] : []), ...prod])) {
    imports.push(`import { ${destination.factory!.replace('()', '')} } from '${destination.specifier}'`)
  }
  if (batched) imports.push(`import { createDrainPipeline } from 'evlog/pipeline'`)

  const enrichers = settings.includes('enrich')
    ? input.enrichers.map(id => findEnricher(id)).filter(Boolean)
    : []
  if (enrichers.length > 0) {
    const names = enrichers.map(enricher => enricher!.factory.replace('()', '')).sort()
    imports.push(`import {\n${names.map(name => `  ${name},`).join('\n')}\n} from 'evlog/enrichers'`)
  }

  const blocks: string[] = []
  if (batched) {
    blocks.push(`const pipeline = createDrainPipeline<DrainContext>({\n  batch: { size: 50, intervalMs: 5000 },\n  retry: { maxAttempts: 3 },\n})`)
  }

  // Batching wraps the network sends only, never the local write.
  const wrap = (factory: string) => batched ? `pipeline(${factory})` : factory
  const prodList = prod.map(d => wrap(d.factory!)).join(', ')
  const options: string[] = []
  /* Nitro replaces `import.meta.dev` at build time and leaves `NODE_ENV` to the
     host, which a bare `node .output/server/index.mjs` never sets. Next and Hono
     have no `import.meta.dev`. */
  const nitro = isNitroFamily(input.framework)

  if (dev && prod.length > 0) {
    blocks.push(nitro
      ? `const drains = import.meta.dev\n  ? [${dev.factory}]\n  : [${prodList}]`
      : `const drains = process.env.NODE_ENV === 'production'\n  ? [${prodList}]\n  : [${dev.factory}]`)
    options.push('  drain: async ctx => void await Promise.all(drains.map(drain => drain(ctx))),')
  } else if (prod.length > 0) {
    blocks.push(`const drains = [${prodList}]`)
    options.push('  drain: async ctx => void await Promise.all(drains.map(drain => drain(ctx))),')
  } else if (dev) {
    options.push('  // Local NDJSON under .evlog/logs, in development only.')
    options.push(nitro
      ? `  drain: import.meta.dev ? ${dev.factory} : undefined,`
      : `  drain: process.env.NODE_ENV === 'production' ? undefined : ${dev.factory},`)
  }

  if (enrichers.length > 0) {
    blocks.push(`const enrichers = [\n${enrichers.map(enricher => `  ${enricher!.factory},`).join('\n')}\n]`)
    options.push('  enrich: async (ctx) => {\n    for (const enrich of enrichers) await enrich(ctx)\n  },')
  }

  const preset = settings.includes('sampling') ? findSamplingPreset(input.sampling) : undefined
  if (preset?.rates) {
    const { info, warn } = preset.rates
    /* `error: 100` is stated rather than chosen, and `debug` is left out: an
       unspecified level is kept in full. */
    options.push(`  sampling: {\n    rates: { info: ${info}, warn: ${warn}, error: 100 },\n  },`)
  }

  return { imports, preamble: blocks.length > 0 ? `\n${blocks.join('\n\n')}\n` : '', options }
}

/** The specifier that imports `file` from a module in `fromDir`. */
function importSpecifier(fromDir: string, file: string): string {
  const path = relative(fromDir, file).split(sep).join('/')
    .replace(/\.(?:ts|js)$/, '')
    .replace(/\.mts$/, '.mjs')
  return path.startsWith('.') ? path : `./${path}`
}

/**
 * The `evlog.config` this package reads, and whether init writes it.
 *
 * - `own`: one is already in the package. It is never rewritten.
 * - `create`: init writes one, extending `parent` when a directory above has one.
 * - `parent`: a directory above has one that cannot be extended, so it applies as it is.
 */
type ConfigTarget =
  | { kind: 'own', file: string }
  | { kind: 'create', file: string, parent: string | null }
  | { kind: 'parent', file: string, reason: string }

function configTarget(input: WiringInput): ConfigTarget {
  const own = firstExisting(input.root, configCandidates('evlog.config'))
  if (own) return { kind: 'own', file: own }

  const file = join(input.root, 'evlog.config.ts')
  const parent = parentConfig(input)
  if (!parent) return { kind: 'create', file, parent: null }

  const reason = unextendable(parent)
  return reason ? { kind: 'parent', file: parent, reason } : { kind: 'create', file, parent }
}

/** The nearest `evlog.config` above the package, up to the workspace root. */
function parentConfig(input: WiringInput): string | null {
  const top = input.workspaceRoot ?? input.root
  if (relative(top, input.root).startsWith('..')) return null

  let dir = input.root
  while (dir !== top) {
    dir = dirname(dir)
    const found = firstExisting(dir, configCandidates('evlog.config'))
    if (found) return found
  }
  return null
}

/** Why a new config cannot extend `file`, or `null` when it can. */
function unextendable(file: string): string | null {
  try {
    const { parent } = readEvlogConfig(file, path => path)
    return parent ? `it already extends ${parent.specifier ?? 'another config'}, and a config extends one level` : null
  } catch {
    return 'init could not read it without running it'
  }
}

/** The settings a config sets, its parent's included, or `null` when it cannot be read without running it. */
function configKeys(file: string): Set<string> | null {
  try {
    const { config, parent } = readEvlogConfig(file, path => path)
    return new Set([...Object.keys(parent?.document.value ?? {}), ...Object.keys(config.value)])
  } catch {
    return null
  }
}

/** How a module at `relativePath` (from the package root) imports the config that applies to it. */
export function evlogConfigImport(input: WiringInput, relativePath: string): string {
  return importSpecifier(dirname(join(input.root, relativePath)), configTarget(input).file)
}

function evlogConfigTemplate(input: WiringInput, parent: string | null, settings: readonly ConfigSetting[]): string {
  const { imports, preamble, options } = factoryParts(input, settings)
  const head = [`import { defineEvlog } from 'evlog'`, ...imports]
  if (parent) head.push(`import base from '${importSpecifier(input.root, parent)}'`)

  const prod = settings.includes('drain') ? input.prodDrains.map(id => findDestination(id)).filter(Boolean) : []
  const variables = [...new Set(prod.flatMap(destination => destination!.env.map(variable => variable.name)))]
  const doc = [
    `Settings for ${input.service}, read by the app and by the evlog CLI.`,
    ...(variables.length > 0 ? [`Reads ${variables.join(', ')} from the environment.`] : []),
    `${DOCS_URL}/cli/config`,
  ]
  const body = [...(parent ? ['  extends: base,'] : []), `  service: ${quote(input.service)},`, ...options]

  return `${head.join('\n')}
${preamble}
/**
${doc.map(line => ` * ${line}`).join('\n')}
 */
export default defineEvlog({
${body.join('\n')}
})
`
}

/** A config to paste, for the cases init does not write the file itself. */
function configSnippet(input: WiringInput, settings: readonly ConfigSetting[], service: boolean): string {
  const { imports, preamble, options } = factoryParts(input, settings)
  const body = [...(service ? [`  service: ${quote(input.service)},`] : []), ...options]
  return [imports.join('\n'), preamble.trim(), `defineEvlog({\n${body.join('\n')}\n})`].filter(Boolean).join('\n\n')
}

/** Drain and enricher plugins an earlier `evlog init` wrote under `server/plugins`. */
function nitroPluginFiles(input: WiringInput): Partial<Record<'drain' | 'enrich', string>> {
  const dir = join(input.root, 'server', 'plugins')
  if (!isNitroFamily(input.framework) || !existsSync(dir)) return {}

  const names = readdirSync(dir)
  const drain = names.find(name => /^evlog-drain\.[cm]?[jt]s$/.test(name))
  const enrich = names.find(name => /^evlog-enrich\.[cm]?[jt]s$/.test(name))
  return {
    ...(drain ? { drain: join('server', 'plugins', drain) } : {}),
    ...(enrich ? { enrich: join('server', 'plugins', enrich) } : {}),
  }
}

/**
 * Put the run's settings in `evlog.config.ts`.
 *
 * A drain or enricher plugin already under `server/plugins` keeps its job: the
 * same setting in the config would run beside it.
 */
function withEvlogConfig(plan: WiringPlan, input: WiringInput): WiringPlan {
  const chosen = chosenSettings(input)
  const plugins = nitroPluginFiles(input)

  if (plugins.drain && chosen.includes('drain')) {
    plan.already.push(`${plugins.drain} already drains events, so evlog.config.ts leaves drain out`)
    if (!wiresEveryDrain(join(input.root, plugins.drain), input)) {
      plan.manual.push({
        title: `Send events to ${describeDrains(input)}`,
        file: plugins.drain,
        snippet: configSnippet(input, ['drain'], false),
        reason: `${plugins.drain} does not send to every destination you picked. Move its drains into evlog.config.ts with these, and delete the plugin`,
      })
    }
  }
  if (plugins.enrich && chosen.includes('enrich')) {
    plan.already.push(`${plugins.enrich} already enriches events, so evlog.config.ts leaves enrich out`)
  }

  let settings = chosen.filter(setting => setting === 'sampling' || !plugins[setting])
  const target = configTarget(input)
  const label = relative(input.root, target.file)

  if (target.kind === 'create') {
    if (target.parent) {
      // A function or rate set here replaces the one it extends rather than adding to it.
      const inherited = configKeys(target.parent) ?? new Set()
      const parentLabel = relative(input.root, target.parent)
      for (const setting of settings.filter(setting => inherited.has(setting))) {
        plan.already.push(`${parentLabel} sets ${setting}, so evlog.config.ts inherits it`)
      }
      settings = settings.filter(setting => !inherited.has(setting))
    }
    plan.actions.unshift({ path: target.file, relative: label, kind: 'create', contents: evlogConfigTemplate(input, target.parent, settings) })
    return plan
  }

  if (target.kind === 'parent') {
    plan.manual.push({
      title: `Add the settings for ${input.service}`,
      file: label,
      snippet: configSnippet(input, settings, true),
      reason: `${label} applies to this package and ${target.reason}, so init did not write a config here that would replace it`,
    })
    return plan
  }

  plan.already.push(`${label} already exists`)
  const keys = configKeys(target.file)
  const missing = keys ? settings.filter(setting => !keys.has(setting)) : settings
  if (missing.length > 0) {
    plan.manual.push({
      title: `Add ${missing.join(', ')} to ${label}`,
      file: label,
      snippet: configSnippet(input, missing, false),
      reason: keys
        ? `init does not rewrite a config you wrote`
        : `${label} is not a plain defineEvlog({ … }) init can read, so it cannot tell what it sets`,
    })
  }
  return plan
}

/** An error catalog built from the project's own repeated errors. */
function errorCatalogTemplate(input: WiringInput): string {
  /* Keep the dashes in the wire prefix — `shop-api.CARD_DECLINED` reads, where
     stripping them gives `shopapi`. The variable gets the camelCase spelling
     because that is what an identifier has to be. */
  const prefix = input.service.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'app'
  const identifier = `${prefix.replace(/-(.)/g, (_, char) => char.toUpperCase())}Errors`
  const entries = input.repeatedErrors.map((seed) => {
    const files = seed.files.slice(0, 3).join(', ')
    const status = seed.status ? `\n    status: ${seed.status},` : ''
    const why = seed.why ? quote(seed.why) : `'TODO: what went wrong, in the reader\\'s terms'`
    return `  /** Currently written inline in ${files}${seed.files.length > 3 ? ', …' : ''} */
  ${objectKey(seed.key)}: {${status}
    message: ${quote(seed.message)},
    why: ${why},
    fix: 'TODO: what they should do about it',
  },`
  })

  return `import { defineErrorCatalog } from 'evlog'

/**
 * Typed errors for ${input.service}.
 *
 * Seeded by \`evlog init\` from errors this project already repeats across
 * files. Fill in \`why\` and \`fix\` — they are what turn a stack trace into
 * something a reader, or an agent, can act on — then replace the inline
 * \`createError\` calls with \`${identifier}.<KEY>()\`.
 */
export const ${identifier} = defineErrorCatalog('${prefix}', {
${entries.join('\n')}
})

declare module 'evlog' {
  interface RegisteredErrorCatalogs {
    '${prefix}': typeof ${identifier}
  }
}
`
}

/** Audit actions named after the sensitive routes the scan found without a trail. */
function auditCatalogTemplate(input: WiringInput): string {
  const seen = new Set<string>()
  const entries = input.auditGaps.map((gap) => {
    let name = auditActionName(gap)
    while (seen.has(name)) name = `${name}2`
    seen.add(name)

    const constant = name.replace(/[^a-z0-9]+/gi, '_').toUpperCase()
    const target = gap.path.split('/').filter(Boolean).at(-1)?.replace(/[^a-z0-9]/gi, '') || 'resource'
    const why = gap.reasons.length > 0 ? ` — flagged for ${gap.reasons.join(', ')}` : ''

    return `/** ${gap.method ?? 'ANY'} ${gap.path}${why} */
export const ${constant} = defineAuditAction('${name}', {
  target: '${target}',
  description: 'TODO: what this records, in one line',
})`
  })

  return `import { defineAuditAction } from 'evlog'

/**
 * Audit actions for ${input.service}.
 *
 * Seeded by \`evlog init\` from the entry points \`evlog map\` flagged as
 * sensitive with no audit trail. Call them from the handlers listed above each
 * one:
 *
 *   log.audit(${entries.length > 0 ? [...seen][0]!.replace(/[^a-z0-9]+/gi, '_').toUpperCase() : 'ACTION'}({ actor: { type: 'user', id: user.id }, outcome: 'success' }))
 */
${entries.join('\n\n')}
`
}

/** Single-quoted, since generated files go through the reader's linter. */
function quote(value: string): string {
  /* Newlines are escaped rather than dropped: a message spanning two lines is
     unusual but legal, and emitting it raw ends the string literal mid-file. */
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`
}

/** Quotes a key that is not a valid identifier, so the generated file parses. */
function objectKey(key: string): string {
  return /^[A-Z_$][\w$]*$/i.test(key) ? key : quote(key)
}

/** Where a catalog file goes, per framework convention. */
function catalogDir(input: WiringInput): string {
  if (input.framework === 'next') {
    const useSrc = existsSync(join(input.root, 'src', 'app')) || existsSync(join(input.root, 'src', 'pages'))
    return useSrc ? join('src', 'lib') : 'lib'
  }
  if (input.framework === 'tanstack-start') return join('src', 'lib')
  if (input.framework === 'hono') {
    return existsSync(join(input.root, 'src')) ? join('src', 'lib') : 'lib'
  }
  return join('server', 'utils')
}

function withCatalogs(plan: WiringPlan, input: WiringInput): WiringPlan {
  const dir = catalogDir(input)

  if (input.extras.includes('error-catalog') && input.repeatedErrors.length > 0) {
    addFile(plan, input, join(dir, 'errors.ts'), errorCatalogTemplate(input))
  }
  if (input.extras.includes('audit-catalog') && input.auditGaps.length > 0) {
    addFile(plan, input, join(dir, 'audit.ts'), auditCatalogTemplate(input))
  }

  return plan
}

/** Queue a file, or report it as already present. Never overwrites. */
export function addFile(plan: WiringPlan, input: WiringInput, relativePath: string, contents: string): void {
  const path = join(input.root, relativePath)
  if (existsSync(path)) {
    plan.already.push(`${relativePath} already exists`)
    return
  }
  plan.actions.push({ path, relative: relativePath, kind: 'create', contents })
}

/** Whether the variable exists where the app runs: the process, or the project's `.env`. */
function envHas(root: string, name: string): boolean {
  if (process.env[name]) return true
  try {
    return new RegExp(`^\\s*${name}\\s*=`, 'm').test(readFileSync(join(root, '.env'), 'utf8'))
  } catch {
    return false
  }
}

/**
 * Append the adapters' variables to `.env.example` (never `.env`, which holds
 * secrets), and put the ones that exist nowhere yet in front of the manual
 * steps: a wired drain without its credentials sends nothing, and that is the
 * first thing the reader has to fix.
 */
function withEnvGuidance(plan: WiringPlan, input: WiringInput): WiringPlan {
  const destinations = input.prodDrains
    .map(id => findDestination(id))
    .filter(destination => destination && destination.env.length > 0)
  const variables = destinations.flatMap(destination => destination!.env)
  if (variables.length === 0) return plan

  const path = join(input.root, '.env.example')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const missing = variables.filter(variable => !new RegExp(`^\\s*${variable.name}\\s*=`, 'm').test(existing))

  if (missing.length > 0) {
    const width = Math.max(...missing.map(variable => variable.name.length))
    const block = [
      '# evlog — wide event delivery',
      ...missing.map(variable => `${`${variable.name}=`.padEnd(width + 2)}# ${variable.hint}`),
      '',
    ].join('\n')
    const contents = existing.length > 0
      ? `${existing.replace(/\n*$/, '\n')}\n${block}`
      : block

    plan.actions.push({
      path,
      relative: '.env.example',
      kind: existing.length > 0 ? 'patch' : 'create',
      contents,
    })
  } else {
    plan.already.push('.env.example already lists the adapter keys')
  }

  const unset = variables.filter(variable => !envHas(input.root, variable.name))
  if (unset.length === 0) return plan

  const labels = destinations.map(destination => destination!.label)
  const subject = labels.length === 1 ? `${labels[0]} sends nothing` : `${labels.join(' and ')} send nothing`
  const links = destinations.map(destination => `${destination!.label}: ${DOCS_URL}${destination!.docs}`).join(' · ')
  const width = Math.max(...unset.map(variable => variable.name.length))
  plan.manual.unshift({
    title: labels.length === 1 ? `Set the ${labels[0]} environment variables` : 'Set the drain environment variables',
    file: '.env',
    snippet: unset.map(variable => `${`${variable.name}=`.padEnd(width + 2)}# ${variable.hint}`).join('\n'),
    reason: `${subject} until these exist. Put the values in .env, or your hosting provider's environment settings (${links})`,
  })
  return plan
}

/**
 * The module `init` writes for a code-first framework: `initLogger` and the
 * integration, both built from `evlog.config.ts`. Sampling is a logger setting
 * and drains are middleware options, so the config is split in two here.
 */
function middlewareModuleTemplate(
  input: WiringInput,
  relativePath: string,
  integration: MiddlewareIntegration,
): string {
  const head = [
    `import { initLogger, toLoggerConfig, toMiddlewareOptions } from 'evlog'`,
    `import { evlog } from '${integration.source}'`,
    ...(integration.imports ?? []),
    `import config from '${evlogConfigImport(input, relativePath)}'`,
  ]

  return `${head.join('\n')}

initLogger(toLoggerConfig(config))

${integration.declare('toMiddlewareOptions(config)')}
`
}

export interface MiddlewareIntegration {
  source: string
  imports?: readonly string[]
  /** The export, given the expression for the middleware options. */
  declare: (options: string) => string
}

/** Write the middleware module, or say how an existing one reads the config. Never overwrites. */
export function addMiddlewareModule(plan: WiringPlan, input: WiringInput, relativePath: string, integration: MiddlewareIntegration): void {
  const path = join(input.root, relativePath)
  if (!existsSync(path)) {
    plan.actions.push({ path, relative: relativePath, kind: 'create', contents: middlewareModuleTemplate(input, relativePath, integration) })
    return
  }

  plan.already.push(`${relativePath} already exists`)
  if (readFileSync(path, 'utf8').includes('evlog.config')) return
  plan.manual.push({
    title: `Read evlog.config.ts in ${relativePath}`,
    file: relativePath,
    snippet: `import { initLogger, toLoggerConfig, toMiddlewareOptions } from 'evlog'
import config from '${evlogConfigImport(input, relativePath)}'

initLogger(toLoggerConfig(config))
// and pass toMiddlewareOptions(config) to evlog()`,
    reason: `${relativePath} does not import the config, so the settings in it do not reach the app`,
  })
}

/** Build the file plan for a framework. Pure: reads the project, writes nothing. */
export async function planWiring(input: WiringInput): Promise<WiringPlan> {
  const plan = await getFramework(input.framework).init!()
  // Applied once here rather than in each planner, where one would be forgotten.
  return withEnvGuidance(withCatalogs(withEvlogConfig(plan(input), input), input), input)
}
