import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DOCS_URL } from '../../core/output'
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

/**
 * The Nitro drain plugin for the chosen destinations.
 *
 * Only the filesystem drain is gated on `import.meta.dev` — it writes files on
 * whatever box serves the request.
 */
/**
 * The server-plugin factory the generated files use.
 *
 * Nitro v2 auto-imports `defineNitroPlugin` (Nuxt does); Nitro v3 does not and
 * exports `definePlugin` from `nitro` instead.
 */
function nitroPluginApi(input: WiringInput): { importLine: string | null, factory: string } {
  if (input.nitroMajor === 3) return { importLine: `import { definePlugin } from 'nitro'`, factory: 'definePlugin' }
  return { importLine: null, factory: 'defineNitroPlugin' }
}

function nitroDrainTemplate(input: WiringInput): string | null {
  const dev = input.devDrain === 'none' ? null : findDestination(input.devDrain) ?? null
  const prod = input.prodDrains.map(id => findDestination(id)).filter(Boolean) as NonNullable<ReturnType<typeof findDestination>>[]
  if (!dev && prod.length === 0) return null

  const plugin = nitroPluginApi(input)
  const batched = input.extras.includes('pipeline') && prod.length > 0
  const imports: string[] = []
  if (plugin.importLine) imports.push(plugin.importLine)
  if (batched) imports.push(`import type { DrainContext } from 'evlog'`)
  /* Deduped by id: nothing stops the same destination being the local sink and
     a production one, and importing its factory twice is a file that does not
     compile. */
  for (const destination of dedupeDestinations([...(dev ? [dev] : []), ...prod])) {
    imports.push(`import { ${destination.factory!.replace('()', '')} } from '${destination.specifier}'`)
  }
  if (batched) imports.push(`import { createDrainPipeline } from 'evlog/pipeline'`)

  const body: string[] = []
  if (batched) {
    body.push(`const pipeline = createDrainPipeline<DrainContext>({
  batch: { size: 50, intervalMs: 5000 },
  retry: { maxAttempts: 3 },
})
`)
  }

  // Batching wraps the network sends only, never the local write.
  const wrap = (factory: string) => batched ? `pipeline(${factory})` : factory
  const prodList = prod.map(destination => wrap(destination.factory!)).join(', ')

  // One plugin branched on the environment, so the whole delivery story is in one place.
  if (dev && prod.length > 0) {
    body.push(`/**
 * Development writes to ${dev.label}; production sends to ${prod.map(d => d.label).join(' and ')}.
${envComment(prod)} */
const drains = import.meta.dev
  ? [${dev.factory}]
  : [${prodList}]

export default ${plugin.factory}((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', async (ctx) => {
    await Promise.all(drains.map(drain => drain(ctx)))
  })
})
`)
  } else if (prod.length > 0) {
    body.push(`/**
 * Wide events land in ${prod.map(d => d.label).join(' and ')}.
${envComment(prod)} */
const drains = [${prodList}]

export default ${plugin.factory}((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', async (ctx) => {
    await Promise.all(drains.map(drain => drain(ctx)))
  })
})
`)
  } else {
    body.push(`/**
 * Local wide-event sink — NDJSON under .evlog/logs.
 */
const drain = ${dev!.factory}

export default ${plugin.factory}((nitroApp) => {
  // Local files are a development convenience — never a production sink.
  if (!import.meta.dev) return
  nitroApp.hooks.hook('evlog:drain', drain)
})
`)
  }

  return `${imports.join('\n')}\n\n${body.join('\n')}`
}

function envComment(destinations: { env: { name: string }[] }[]): string {
  const names = [...new Set(destinations.flatMap(d => d.env.map(v => v.name)))]
  return names.length > 0 ? ` * Reads ${names.join(', ')} from the environment.\n` : ''
}

function nitroEnricherTemplate(input: WiringInput): string {
  const plugin = nitroPluginApi(input)
  const chosen = input.enrichers.map(id => findEnricher(id)).filter(Boolean)
  const factories = chosen.map(enricher => enricher!.factory)
  const names = [...factories].map(factory => factory.replace('()', '')).sort()

  return `${plugin.importLine ? `${plugin.importLine}\n` : ''}import {
${names.map(name => `  ${name},`).join('\n')}
} from 'evlog/enrichers'

const enrichers = [
${factories.map(factory => `  ${factory},`).join('\n')}
]

export default ${plugin.factory}((nitroApp) => {
  nitroApp.hooks.hook('evlog:enrich', async (ctx) => {
    for (const enrich of enrichers) await enrich(ctx)
  })
})
`
}

/**
 * Add the Nitro-side plugins.
 *
 * An existing drain file is never rewritten; a destination it does not already
 * wire goes beside it under a name of its own.
 */
export function withNitroPlugins(plan: WiringPlan, input: WiringInput): WiringPlan {
  const drain = nitroDrainTemplate(input)
  if (drain) {
    const preferred = join('server', 'plugins', 'evlog-drain.ts')
    const path = join(input.root, preferred)

    if (!existsSync(path)) {
      plan.actions.push({ path, relative: preferred, kind: 'create', contents: drain })
    } else if (wiresEveryDrain(path, input)) {
      // Including the file this command wrote last time — this is what keeps it idempotent.
      plan.already.push(`${preferred} already wires ${describeDrains(input)}`)
    } else {
      const suffix = allDrains(input).join('-') || 'extra'
      const alternate = join('server', 'plugins', `evlog-drain-${suffix}.ts`)
      const alternatePath = join(input.root, alternate)
      if (existsSync(alternatePath)) {
        plan.already.push(`${alternate} already exists`)
      } else {
        plan.actions.push({ path: alternatePath, relative: alternate, kind: 'create', contents: drain })
        plan.already.push(`${preferred} left as it is — the new drain went to ${alternate}`)
      }
    }
  }

  if (input.extras.includes('enrichers') && input.enrichers.length > 0) {
    const relativePath = join('server', 'plugins', 'evlog-enrich.ts')
    const path = join(input.root, relativePath)
    if (existsSync(path)) plan.already.push(`${relativePath} already exists`)
    else plan.actions.push({ path, relative: relativePath, kind: 'create', contents: nitroEnricherTemplate(input) })
  }

  return plan
}

/** The `sampling` block for a module config, when the extra was selected. */
export function samplingProperty(input: WiringInput): string | null {
  if (!input.extras.includes('sampling')) return null
  const preset = findSamplingPreset(input.sampling)
  if (!preset?.rates) return null
  const { info, warn } = preset.rates
  /* `error: 100` is stated rather than chosen, and `debug` is left out: an
     unspecified level is kept in full. */
  return `sampling: {
      rates: { info: ${info}, warn: ${warn}, error: 100 },
    }`
}

/**
 * The pieces of a generated evlog config file — shared by Next's `lib/evlog.ts`
 * (create and patch paths) and Hono's `src/evlog.ts`, which are both plain
 * TypeScript rather than a framework config.
 */
interface FactoryParts {
  imports: string[]
  /** Statements that go above `createEvlog`. */
  preamble: string
  /** Option keys, each already indented and comma-terminated. */
  options: string[]
}

export function factoryParts(input: WiringInput): FactoryParts {
  const dev = input.devDrain === 'none' ? null : findDestination(input.devDrain) ?? null
  const prod = input.prodDrains.map(id => findDestination(id)).filter(Boolean) as NonNullable<ReturnType<typeof findDestination>>[]
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

  const enrichers = input.extras.includes('enrichers')
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

  const wrap = (factory: string) => batched ? `pipeline(${factory})` : factory
  const options: string[] = []

  // Neither Next nor Hono has `import.meta.dev`, so the split is on NODE_ENV.
  if (dev && prod.length > 0) {
    blocks.push(`const drains = process.env.NODE_ENV === 'production'\n  ? [${prod.map(d => wrap(d.factory!)).join(', ')}]\n  : [${dev.factory}]`)
    options.push('  drain: async ctx => void await Promise.all(drains.map(drain => drain(ctx))),')
  } else if (prod.length > 0) {
    blocks.push(`const drains = [${prod.map(d => wrap(d.factory!)).join(', ')}]`)
    options.push('  drain: async ctx => void await Promise.all(drains.map(drain => drain(ctx))),')
  } else if (dev) {
    options.push('  // Local NDJSON under .evlog/logs — development only.')
    options.push(`  drain: process.env.NODE_ENV === 'production' ? undefined : ${dev.factory},`)
  }

  if (enrichers.length > 0) {
    blocks.push(`const enrichers = [\n${enrichers.map(enricher => `  ${enricher!.factory},`).join('\n')}\n]`)
    options.push('  enrich: async (ctx) => {\n    for (const enrich of enrichers) await enrich(ctx)\n  },')
  }

  const preset = input.extras.includes('sampling') ? findSamplingPreset(input.sampling) : undefined
  if (preset?.rates) {
    const { info, warn } = preset.rates
    options.push(`  sampling: {\n    rates: { info: ${info}, warn: ${warn}, error: 100 },\n  },`)
  }

  return { imports, preamble: blocks.length > 0 ? `\n${blocks.join('\n\n')}\n` : '', options }
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
 * The module `init` writes for a code-first framework: `initLogger` with the
 * sampling preset, then whatever the integration exports, built from the
 * middleware options. Sampling belongs to `initLogger`; drains and enrichers are
 * middleware options, so the two halves are split here once.
 */
export function middlewareModuleTemplate(
  input: WiringInput,
  integration: { source: string, imports?: readonly string[], declare: (options: string | null) => string },
): string {
  const { imports, preamble, options } = factoryParts(input)
  const sampling = options.filter(option => option.trimStart().startsWith('sampling:'))
  const middleware = options.filter(option => !sampling.includes(option))
  const head = [`import { initLogger } from 'evlog'`, `import { evlog } from '${integration.source}'`, ...(integration.imports ?? []), ...imports]

  return `${head.join('\n')}

initLogger({
  env: { service: '${input.service}' },
${sampling.join('\n')}${sampling.length > 0 ? '\n' : ''}})
${preamble}
${integration.declare(middleware.length > 0 ? `{\n${middleware.join('\n')}\n}` : null)}
`
}

/** Build the file plan for a framework. Pure: reads the project, writes nothing. */
export async function planWiring(input: WiringInput): Promise<WiringPlan> {
  const plan = await getFramework(input.framework).init!()
  // Applied once here rather than in each planner, where one would be forgotten.
  return withEnvGuidance(withCatalogs(plan(input), input), input)
}
