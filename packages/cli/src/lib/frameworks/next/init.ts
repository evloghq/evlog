import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appendProperty, applySplices, findCreateEvlogCall, importsEnd, hasImportFrom, hasProperty, readConfig } from '../../init/edit'
import type { Splice } from '../../init/edit'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { configCandidates, factoryParts, firstExisting } from '../../init/wiring'

function nextInstrumentationTemplate(service: string): string {
  return `import { defineNodeInstrumentation } from 'evlog/next/instrumentation'

export const { register, onRequestError } = defineNodeInstrumentation({
  service: '${service}',
  captureOutput: true,
})
`
}

function nextLibTemplate(input: WiringInput): string {
  const { imports, preamble, options } = factoryParts(input)
  const all = [`import { createEvlog } from 'evlog/next'`, ...imports]

  return `${all.join('\n')}
${preamble}
export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: '${input.service}',
${options.join('\n')}${options.length > 0 ? '\n' : ''}})
`
}

/**
 * Splice the chosen options into a `lib/evlog.ts` that is already there.
 *
 * Only works when the file actually calls `createEvlog({ … })`; a re-export
 * barrel or a computed config gets the snippet to paste instead.
 */
function patchNextLib(plan: WiringPlan, input: WiringInput, path: string, relativePath: string): void {
  const { imports, preamble, options } = factoryParts(input)
  if (options.length === 0) {
    plan.already.push(`${relativePath} already exists`)
    return
  }

  const config = readConfig(path)
  const call = config ? findCreateEvlogCall(config.program) : null

  if (!config || !call) {
    plan.manual.push({
      title: 'Wire the destinations into your evlog factory',
      file: relativePath,
      snippet: `${imports.join('\n')}\n${preamble}\ncreateEvlog({\n${options.join('\n')}\n})`,
      reason: `${relativePath} exists but does not call createEvlog({ … }) here — splicing into it would be guesswork`,
    })
    return
  }

  const present = ['drain', 'enrich', 'sampling'].filter(key => hasProperty(call, key))
  if (present.length > 0) {
    plan.manual.push({
      title: 'Reconcile your evlog factory options',
      file: relativePath,
      snippet: options.join('\n'),
      reason: `${relativePath} already sets ${present.join(', ')} — replacing what you wrote is not init's call`,
    })
    return
  }

  const splices: Splice[] = [appendProperty(config.source, call, options.map(line => line.trim()).join('\n  ').replace(/,$/, ''))]

  const missing = imports.filter((statement) => {
    const specifier = statement.match(/from '([^']+)'/)?.[1]
    return specifier && !hasImportFrom(config.program, specifier)
  })

  const head = [
    missing.length > 0 ? `\n${missing.join('\n')}` : '',
    preamble.trim().length > 0 ? `\n\n${preamble.trim()}` : '',
  ].join('')

  if (head.length > 0) {
    splices.push({ at: importsEnd(config.source, config.program), text: head })
  }

  plan.actions.push({
    path,
    relative: relativePath,
    kind: 'patch',
    contents: applySplices(config.source, splices),
  })
}

export default function planNext(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  /* Next resolves both `instrumentation.ts` and `src/instrumentation.ts`, but
     only the one that matches the app directory — putting it at the root of a
     `src/` project makes a file that is never loaded. */
  const useSrc = existsSync(join(input.root, 'src', 'app')) || existsSync(join(input.root, 'src', 'pages'))
  const base = useSrc ? join(input.root, 'src') : input.root

  const instrumentation = firstExisting(base, configCandidates('instrumentation'))
  if (instrumentation) {
    plan.already.push(`${relative(input.root, instrumentation)} already exists`)
  } else {
    const path = join(base, 'instrumentation.ts')
    plan.actions.push({
      path,
      relative: relative(input.root, path),
      kind: 'create',
      contents: nextInstrumentationTemplate(input.service),
    })
  }

  const lib = firstExisting(base, ['lib/evlog.ts', 'lib/evlog.tsx', 'app/lib/evlog.ts'])
  if (lib) {
    patchNextLib(plan, input, lib, relative(input.root, lib))
  } else {
    const path = join(base, 'lib', 'evlog.ts')
    plan.actions.push({
      path,
      relative: relative(input.root, path),
      kind: 'create',
      contents: nextLibTemplate(input),
    })
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
    reason: 'Next has no ambient request logger — each handler opts in with withEvlog()',
  })

  return plan
}
