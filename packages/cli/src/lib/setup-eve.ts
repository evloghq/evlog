import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
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
 * Writes `agent/instrumentation/evlog.ts` for an eve agent, which extensions
 * cannot declare themselves. Never overwrites: a run on a project that has
 * it, or another file exporting `evlogTraces()`, changes nothing.
 * With `check`, it only reports what it would do.
 */
export async function runSetupEve(ctx: CliContext, options: { check?: boolean } = {}): Promise<SetupEveResult> {
  const project = await resolveProject(ctx.cwd)
  const dir = join(project.packageDir, 'agent', 'instrumentation')
  const file = join(dir, 'evlog.ts')
  const shown = relative(project.packageDir, file)
  if (existsSync(dir)) {
    for (const name of await readdir(dir)) {
      if (/\.[cm]?[jt]s$/.test(name) && (await readFile(join(dir, name), 'utf8')).includes('evlogTraces')) {
        return { file: relative(project.packageDir, join(dir, name)), state: 'present' }
      }
    }
  }
  if (existsSync(file)) return { file: shown, state: 'conflict' }
  if (options.check) return { file: shown, state: 'missing' }
  await mkdir(dir, { recursive: true })
  await writeFile(file, EVE_INSTRUMENTATION)
  return { file: shown, state: 'written' }
}
