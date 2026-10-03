import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { cliErrors } from '../errors'
import type { FileAction } from '../init/wiring'
import type { Framework } from '../map/types'
import { renderAgentsFile, renderBlock, upsertBlock, upsertClaudePointer } from './block'

export interface AgentsPlanInput {
  /** Package root — where `AGENTS.md` belongs. */
  root: string
  projectName: string
  framework: Framework | null
  /** Whether the block should point at the skills for the deeper guidance. */
  hasSkills: boolean
}

export interface AgentsPlan {
  actions: FileAction[]
  /** Files that already say exactly this — printed so a run is never silent. */
  already: string[]
}

function action(root: string, path: string, contents: string): FileAction {
  const full = join(root, path)
  return {
    path: full,
    relative: relative(root, full) || path,
    kind: existsSync(full) ? 'patch' : 'create',
    contents,
  }
}

/**
 * Read a file we may be about to rewrite, or `null` when it is not there.
 *
 * An existing path that cannot be read — a directory named `AGENTS.md`, or one
 * the user has no permission on — would otherwise surface as a raw stack trace,
 * since only catalog errors get a `why` and a `fix`.
 */
function read(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw cliErrors.AGENTS_UNREADABLE({ file: basename(path) })
  }
}

/**
 * What `evlog agents` will write, given the project on disk.
 *
 * Pure and synchronous — the whole idempotency story is testable without a
 * filesystem write. Skill files are not ours to plan; see `./skills`.
 */
export function planAgents(input: AgentsPlanInput): AgentsPlan {
  const actions: FileAction[] = []
  const already: string[] = []

  const block = renderBlock({ framework: input.framework, hasSkills: input.hasSkills })

  const agentsPath = join(input.root, 'AGENTS.md')
  const agentsSource = read(agentsPath)

  if (agentsSource === null) {
    actions.push(action(input.root, 'AGENTS.md', renderAgentsFile(input.projectName, block)))
  } else {
    const next = upsertBlock(agentsSource, block)
    if (next === null) already.push('AGENTS.md is up to date')
    else actions.push(action(input.root, 'AGENTS.md', next))
  }

  const claudePath = join(input.root, 'CLAUDE.md')
  const claude = upsertClaudePointer(read(claudePath))
  if (claude === null) already.push('CLAUDE.md already points at AGENTS.md')
  else actions.push(action(input.root, 'CLAUDE.md', claude))

  return { actions, already }
}
