import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { configCandidates, evlogConfigImport, firstExisting } from '../../init/wiring'

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

  if (!lib) {
    plan.actions.push({ path: libPath, relative: libRelative, kind: 'create', contents: nextLibTemplate(configImport) })
  } else {
    plan.already.push(`${libRelative} already exists`)
    if (!mentions(lib, 'evlog.config')) {
      plan.manual.push({
        title: `Read evlog.config.ts in ${libRelative}`,
        file: libRelative,
        snippet: `import config from '${configImport}'

export const { withEvlog, useLogger, log, createError } = createEvlog(config)`,
        reason: `${libRelative} does not import the config, so the settings in it do not reach the app. Move the options you pass to createEvlog into evlog.config.ts`,
      })
    }
  }

  const instrumentation = firstExisting(base, configCandidates('instrumentation'))
  if (!instrumentation) {
    const path = join(base, 'instrumentation.ts')
    plan.actions.push({ path, relative: relative(input.root, path), kind: 'create', contents: instrumentationTemplate(libImport) })
  } else {
    const instrumentationRelative = relative(input.root, instrumentation)
    plan.already.push(`${instrumentationRelative} already exists`)
    if (!mentions(instrumentation, libImport.slice(2)) && !mentions(instrumentation, 'evlog.config')) {
      plan.manual.push({
        title: 'Start the logger from evlog.config.ts',
        file: instrumentationRelative,
        snippet: lib
          ? `import { toLoggerConfig } from 'evlog'
import { createInstrumentation } from 'evlog/next/instrumentation/create'
import config from '${configImport}'

// in ${libRelative}, loaded from ${instrumentationRelative} with defineNodeInstrumentation(() => import('${libImport}'))
export const { register, onRequestError } = createInstrumentation({
  ...toLoggerConfig(config),
  captureOutput: true,
})`
          : instrumentationTemplate(libImport).trim(),
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
