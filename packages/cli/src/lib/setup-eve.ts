import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CliContext } from '../core/context'
import { resolveProject } from './project'

export const EVE_INSTRUMENTATION = `import { evlogTraces } from '@evlog/eve/instrumentation'

// Puts each turn's traceId and invoke_agent spanId on its wide event.
// Reads span ids only: it exports nothing and adds no sampling.
export default evlogTraces()
`

export interface SetupEveResult {
  /** The instrumentation file, relative to the package. */
  file: string
  /**
   * `written` by this run, `present` already, `missing` (a `check` run that
   * wrote nothing), or `conflict`: a file of that name without `evlogTraces`, left as it is.
   */
  state: 'written' | 'present' | 'missing' | 'conflict'
}

/**
 * Where an eve agent's `evlogTraces()` instrumentation stands, without writing.
 * `evlog init` plans the file from this, and `evlog setup eve` writes it.
 */
export function inspectEveInstrumentation(packageDir: string): SetupEveResult & { state: 'present' | 'missing' | 'conflict' } {
  const dir = join('agent', 'instrumentation')
  const file = join(dir, 'evlog.ts')
  if (existsSync(join(packageDir, dir))) {
    for (const name of readdirSync(join(packageDir, dir))) {
      if (/\.[cm]?[jt]s$/.test(name) && readFileSync(join(packageDir, dir, name), 'utf8').includes('evlogTraces')) {
        return { file: join(dir, name), state: 'present' }
      }
    }
  }
  return { file, state: existsSync(join(packageDir, file)) ? 'conflict' : 'missing' }
}

/**
 * Writes `agent/instrumentation/evlog.ts` for an eve agent, which extensions
 * cannot declare themselves. Never overwrites: a run on a project that has
 * it, or another file exporting `evlogTraces()`, changes nothing.
 * With `check`, it only reports what it would do.
 */
export async function runSetupEve(ctx: CliContext, options: { check?: boolean } = {}): Promise<SetupEveResult> {
  const project = await resolveProject(ctx.cwd)
  const found = inspectEveInstrumentation(project.packageDir)
  if (found.state !== 'missing' || options.check) return found
  const path = join(project.packageDir, found.file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, EVE_INSTRUMENTATION)
  return { file: found.file, state: 'written' }
}
