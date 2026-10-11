import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { BindingPattern } from 'oxc-parser'
import type { ManualStep, WiringInput, WiringPlan } from '../../init/wiring'
import { configCandidates, evlogConfigImport, firstExisting } from '../../init/wiring'
import { parseSource } from '../../map/parse'

const HOOKS = ['register', 'onRequestError']

/**
 * Loads `lib/evlog` in the Node.js runtime only: the config it imports can
 * pull Node-only drains, which must stay out of the Edge bundle.
 */
function instrumentationTemplate(libImport: string): string {
  return `import { defineNodeInstrumentation } from 'evlog/next/instrumentation'

export const { register, onRequestError } = defineNodeInstrumentation(() => import('${libImport}'))
`
}

function nextLibTemplate(configImport: string): string {
  return `import { toLoggerConfig } from 'evlog'
import { createEvlog } from 'evlog/next'
import { createInstrumentation } from 'evlog/next/instrumentation/create'
import config from '${configImport}'

/** Loaded by instrumentation.ts when the server starts. */
export const { register, onRequestError } = createInstrumentation({
  ...toLoggerConfig(config),
  captureOutput: true,
})

export const { withEvlog, useLogger, log, createError } = createEvlog(config)
`
}

function mentions(path: string, text: string): boolean {
  return readFileSync(path, 'utf8').includes(text)
}

function bindingNames(pattern: BindingPattern, names: Set<string>): void {
  if (pattern.type === 'Identifier') names.add(pattern.name)
  if (pattern.type === 'AssignmentPattern') bindingNames(pattern.left, names)
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      if (property.type === 'Property') bindingNames(property.value, names)
    }
  }
}

/**
 * The hooks `defineNodeInstrumentation` calls that `lib` does not export. A
 * file that does not parse, or that re-exports a whole module, reports none:
 * neither says what is missing.
 */
function missingHooks(lib: string): string[] {
  const parsed = parseSource(lib, readFileSync(lib, 'utf8'))
  if (!parsed || parsed.errors.length > 0) return []
  const exported = new Set<string>()
  for (const statement of parsed.program.body) {
    if (statement.type === 'ExportAllDeclaration' && !statement.exported) return []
    if (statement.type !== 'ExportNamedDeclaration') continue
    for (const { exported: name } of statement.specifiers) exported.add(name.type === 'Literal' ? name.value : name.name)
    const { declaration } = statement
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) exported.add(declaration.id.name)
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) bindingNames(declarator.id, exported)
    }
  }
  return HOOKS.filter(hook => !exported.has(hook))
}

/** One step for an existing lib, holding only the wiring it lacks. */
function libStep(input: { libRelative: string, instrumentationRelative: string, configImport: string, readsConfig: boolean, missing: string[] }): ManualStep {
  const { libRelative, instrumentationRelative, configImport, readsConfig, missing } = input
  const hooks = missing.join(' and ')
  const imports: string[] = []
  const body: string[] = []
  const reasons: string[] = []
  if (missing.length > 0) {
    imports.push(`import { toLoggerConfig } from 'evlog'`, `import { createInstrumentation } from 'evlog/next/instrumentation/create'`)
    body.push(`export const { ${missing.join(', ')} } = createInstrumentation({
  ...toLoggerConfig(config),
  captureOutput: true,
})`)
    reasons.push(`${instrumentationRelative} calls ${hooks} from ${libRelative}, which throws while ${missing.length > 1 ? 'they are' : 'it is'} not exported`)
  }
  if (!readsConfig) {
    imports.push(`import config from '${configImport}'`)
    body.push('export const { withEvlog, useLogger, log, createError } = createEvlog(config)')
    reasons.push(`${libRelative} does not import the config, so the settings in it do not reach the app. Move the options you pass to createEvlog into evlog.config.ts`)
  }
  return {
    title: readsConfig ? `Export ${hooks} from ${libRelative}` : `Read evlog.config.ts in ${libRelative}`,
    file: libRelative,
    snippet: `${imports.join('\n')}\n\n${body.join('\n\n')}`,
    reason: reasons.join('. '),
  }
}

export default function planNext(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  /* Next resolves both `instrumentation.ts` and `src/instrumentation.ts`, but
     only the one that matches the app directory: at the root of a `src/`
     project it is never loaded. */
  const useSrc = existsSync(join(input.root, 'src', 'app')) || existsSync(join(input.root, 'src', 'pages'))
  const base = useSrc ? join(input.root, 'src') : input.root

  const lib = firstExisting(base, ['lib/evlog.ts', 'lib/evlog.tsx', 'app/lib/evlog.ts'])
  const libPath = lib ?? join(base, 'lib', 'evlog.ts')
  const libRelative = relative(input.root, libPath)
  const configImport = evlogConfigImport(input, libRelative)
  const libImport = `./${relative(base, libPath).split(sep).join('/').replace(/\.tsx?$/, '')}`

  const instrumentation = firstExisting(base, configCandidates('instrumentation'))
  const instrumentationPath = instrumentation ?? join(base, 'instrumentation.ts')
  const instrumentationRelative = relative(input.root, instrumentationPath)
  const loadsLib = !instrumentation || mentions(instrumentation, libImport.slice(2))
  const readsConfigItself = !!instrumentation && !loadsLib && mentions(instrumentation, 'evlog.config')
  /* Only defineNodeInstrumentation, which init writes or asks for, calls both hooks on the lib. */
  const callsHooks = !instrumentation || (loadsLib ? mentions(instrumentation, 'defineNodeInstrumentation') : !readsConfigItself)

  if (!lib) {
    plan.actions.push({ path: libPath, relative: libRelative, kind: 'create', contents: nextLibTemplate(configImport) })
  } else {
    plan.already.push(`${libRelative} already exists`)
    const readsConfig = mentions(lib, 'evlog.config')
    const missing = callsHooks ? missingHooks(lib) : []
    if (!readsConfig || missing.length > 0) {
      plan.manual.push(libStep({ libRelative, instrumentationRelative, configImport, readsConfig, missing }))
    }
  }

  if (!instrumentation) {
    plan.actions.push({ path: instrumentationPath, relative: instrumentationRelative, kind: 'create', contents: instrumentationTemplate(libImport) })
  } else {
    plan.already.push(`${instrumentationRelative} already exists`)
    if (!loadsLib && !readsConfigItself) {
      plan.manual.push({
        title: 'Start the logger from evlog.config.ts',
        file: instrumentationRelative,
        snippet: instrumentationTemplate(libImport).trim(),
        reason: `the logger starts in ${instrumentationRelative} and ignores the settings it is given later, so evlog.config.ts only applies once this file loads it`,
      })
    }
  }

  plan.manual.push({
    title: 'Wrap a route handler',
    file: relative(input.root, join(base, 'app', 'api', '<route>', 'route.ts')),
    snippet: `import { withEvlog, useLogger } from '@/lib/evlog'

export const GET = withEvlog(async () => {
  const log = useLogger()
  log.set({ action: 'hello' })
  return Response.json({ ok: true })
})`,
    reason: 'Next has no ambient request logger, so each handler opts in with withEvlog()',
  })

  return plan
}
