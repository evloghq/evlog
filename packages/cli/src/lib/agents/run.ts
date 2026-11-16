import { telemetry } from '@evlog/telemetry'
import type { CliContext } from '../../core/context'
import type { CliDebug } from '../debug'
import { createNoopCliDebug } from '../debug'
import type { FileAction } from '../init/wiring'
import { writeActions } from '../init/write'
import {
  canPrompt,
  closeAgents,
  closeCancelled,
  confirmPlan,
  InitCancelled,
  noteSkills,
  noteSkillsStarting,
  openInteractive,
  showPlan,
} from '../init/prompts'
import { detectFramework } from '../map/detect'
import type { Framework } from '../map/types'
import { resolveProject } from '../project'
import type { ProjectInfo } from '../project'
import { planAgents } from './plan'
import type { AgentsPlanInput } from './plan'
import { findInstalledSkills, runSkills, skillsCommand } from './skills'

export interface AgentsOptions {
  /** Pass through to `npx skills add --skill`; empty means every published one. */
  skills?: string[]
  /** Do not touch the skills at all — write the block and stop. */
  noSkills?: boolean
  /** Install the skills into this project rather than for every project. */
  local?: boolean
  /** Where the skills are published. */
  source?: string
  /** Plan everything, write nothing, run nothing. */
  dryRun?: boolean
  /** Force non-interactive regardless of the terminal (set by `--json`). */
  nonInteractive?: boolean
  /** Skip the confirm step and apply. */
  yes?: boolean
}

/** What became of the skills step. Mirrors `init`'s install outcome. */
export interface SkillsOutcome {
  status: 'already' | 'installed' | 'skipped' | 'failed'
  /** The command as the user would type it — printed whatever the outcome. */
  command: string
  /** Skill names already on disk when the run started. */
  found: string[]
  /** Agent directories they were found in. */
  dirs: string[]
  error?: string
}

export interface AgentsResult {
  project: Pick<ProjectInfo, 'cwd' | 'root' | 'packageDir' | 'packageName'>
  /** `null` when detection found nothing — the block is written regardless. */
  framework: Framework | null
  skills: SkillsOutcome
  written: FileAction[]
  already: string[]
  dryRun: boolean
  interactive: boolean
  cancelled: boolean
}

/**
 * Framework detection, downgraded to a hint.
 *
 * `init` writes framework-specific wiring and must refuse when it cannot tell
 * what it is looking at. This command writes prose, and prose about wide events
 * is worth having in an Express app the detector does not cover.
 */
function detectSoftly(project: ProjectInfo): Framework | null {
  try {
    return detectFramework(project).framework
  } catch {
    return null
  }
}

/**
 * Teach the agents working in this project how to use evlog.
 *
 * Writes a marker-delimited block into `AGENTS.md` and hands the skills to
 * `npx skills add`. Safe to re-run: anything already
 * saying exactly this is reported rather than rewritten, and skills already on
 * disk are left for `npx skills update`.
 */
export async function runAgents(
  ctx: CliContext,
  log: CliDebug = createNoopCliDebug(),
  options: AgentsOptions = {},
): Promise<AgentsResult> {
  const project = await log.step(
    'resolveProject',
    () => resolveProject(ctx.cwd),
    p => ({ cwd: ctx.cwd, project: { kind: p.kind, root: p.root, name: p.packageName } }),
  )

  const framework = await log.step('detectFramework', () => detectSoftly(project), f => ({ framework: f ?? 'none' }))

  const dryRun = options.dryRun === true
  const interactive = !options.nonInteractive && !options.yes && canPrompt(ctx)

  const installed = await log.step(
    'findSkills',
    () => findInstalledSkills(project.packageDir, ctx.home),
    r => ({ skills: r.names.length }),
  )

  const command = skillsCommand({
    source: options.source,
    skills: options.skills,
    local: options.local,
    interactive,
  })

  /* Already there is the common case on a second run, and re-adding would only
     ask the skills CLI to redo work it tracks better than we do. */
  const installing = !options.noSkills && installed.names.length === 0

  const plan = await log.step(
    'planAgents',
    () => planAgents({
      root: project.packageDir,
      projectName: project.packageName ?? 'This project',
      framework,
      hasSkills: installed.names.length > 0 || installing,
    }),
    p => ({ writes: p.actions.length, already: p.already.length }),
  )

  /* In the plan as well as the report: a step nobody sees considered is a step
     the reader assumes was forgotten. */
  if (installed.names.length > 0) {
    plan.already.push(`evlog skills already installed · ${installed.dirs.join(', ')}`)
  }

  if (interactive) {
    openInteractive(ctx, 'evlog agents', project.packageName ?? project.packageDir)

    if (dryRun) {
      showPlan(plan.actions, plan.already, installing ? [command.display] : [])
    } else {
      let confirmed: boolean
      try {
        confirmed = await confirmPlan(plan.actions, plan.already, installing ? [command.display] : [])
      } catch (error) {
        if (error instanceof InitCancelled) {
          closeCancelled()
          return cancelled({ project, framework, command: command.display, installed })
        }
        throw error
      }
      if (!confirmed) {
        closeCancelled()
        return cancelled({ project, framework, command: command.display, installed })
      }
    }
  }

  if (!dryRun) {
    await log.step('write', async () => {
      await writeActions(plan.actions)
      return plan.actions.length
    })
  }

  let skills: SkillsOutcome
  if (installed.names.length > 0) {
    skills = { status: 'already', command: command.display, found: installed.names, dirs: installed.dirs }
  } else if (options.noSkills || dryRun) {
    skills = { status: 'skipped', command: command.display, found: [], dirs: [] }
  } else {
    if (interactive) noteSkillsStarting(ctx, command.display)
    const outcome = await log.step(
      'runSkills',
      () => runSkills(command, project.packageDir, interactive),
      r => ({ installed: r.ok }),
    )
    skills = outcome.ok
      ? { status: 'installed', command: command.display, found: [], dirs: findInstalledSkills(project.packageDir, ctx.home).dirs }
      : { status: 'failed', command: command.display, found: [], dirs: [], error: outcome.error }
  }

  if (skills.status === 'failed' && !dryRun) {
    await log.step('rewriteBlock', () => dropSkillsPointer({
      root: project.packageDir,
      projectName: project.packageName ?? 'This project',
      framework,
    }))
  }

  if (interactive) {
    noteSkills(ctx, skills)
    closeAgents(ctx, dryRun)
  }

  const result: AgentsResult = {
    project,
    framework,
    skills,
    written: plan.actions,
    already: plan.already,
    dryRun,
    interactive,
    cancelled: false,
  }

  recordAgentsRun(result)
  return result
}

/**
 * Rewrite the block after a failed skills install.
 *
 * The block is written before the install so it stands whatever the
 * subprocess does, which means on failure it points at a skill that is known
 * not to exist.
 */
export async function dropSkillsPointer(input: Omit<AgentsPlanInput, 'hasSkills'>): Promise<number> {
  const corrected = planAgents({ ...input, hasSkills: false })
  await writeActions(corrected.actions)
  return corrected.actions.length
}

function cancelled(input: {
  project: ProjectInfo
  framework: Framework | null
  command: string
  installed: { names: string[], dirs: string[] }
}): AgentsResult {
  const result: AgentsResult = {
    project: input.project,
    framework: input.framework,
    skills: {
      status: 'skipped',
      command: input.command,
      found: input.installed.names,
      dirs: input.installed.dirs,
    },
    written: [],
    already: [],
    dryRun: false,
    interactive: true,
    cancelled: true,
  }
  recordAgentsRun(result)
  return result
}

/**
 * Counts and booleans only.
 *
 * Which skills exist is already public; how many files a given project rewrote
 * is not interesting enough to justify sending anything shaped like a path.
 */
function agentsTelemetryFields(result: AgentsResult): Record<string, boolean | number> {
  return {
    agentsSkillsFound: result.skills.found.length,
    agentsSkillsInstalled: result.skills.status === 'installed',
    agentsSkillsFailed: result.skills.status === 'failed',
    agentsFilesWritten: result.written.length,
    agentsAlready: result.already.length,
    agentsDetected: result.framework !== null,
    agentsDryRun: result.dryRun,
    agentsInteractive: result.interactive,
    agentsCancelled: result.cancelled,
  }
}

function recordAgentsRun(result: AgentsResult): void {
  telemetry.set(agentsTelemetryFields(result))
}

/**
 * Every field {@link recordAgentsRun} can emit — used to document the disclosure.
 *
 * Read off the payload rather than listed again: a field added to one and not
 * the other would leave the disclosure quietly incomplete, and what this CLI
 * transmits is exactly the thing that must not drift.
 */
export function agentsTelemetryFieldNames(): string[] {
  return Object.keys(agentsTelemetryFields({
    project: { cwd: '', root: '', packageDir: '', packageName: null },
    framework: null,
    skills: { status: 'skipped', command: '', found: [], dirs: [] },
    written: [],
    already: [],
    dryRun: false,
    interactive: false,
    cancelled: false,
  }))
}
