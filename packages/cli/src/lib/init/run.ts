import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runDoctor } from '../../commands/doctor'
import type { CliContext } from '../../core/context'
import { planAgents } from '../agents/plan'
import { findInstalledSkills, runSkills, skillsCommand } from '../agents/skills'
import type { CliDebug } from '../debug'
import { createNoopCliDebug } from '../debug'
import { cliErrors } from '../errors'
import { detectFramework } from '../map/detect'
import type { Framework } from '../map/types'
import { resolveEvlog, resolveProject } from '../project'
import type { PackageJson, ProjectInfo } from '../project'
import { getFramework, isInitFramework } from '../frameworks'
import type { DrainId, EnricherId, ExtraId, OfferContext, SamplingProfile } from './catalog'
import { planWiring } from './wiring'
import type { FileAction, ManualStep } from './wiring'
import { readProject } from './insight'
import type { ProjectInsight } from './insight'
import { detectPackageManager, installCommand, runInstall } from './pm'
import type { PackageManager } from './pm'
import {
  askAnswers,
  canPrompt,
  closeCancelled,
  closeInteractive,
  confirmPlan,
  showPlan,
  InitCancelled,
  noteManual,
  noteSkills,
  noteSkillsStarting,
  openInteractive,
  runVerification,
} from './prompts'
import type { InitAnswers } from './prompts'
import { droppedExtras, resolveAnswers } from './resolve'
import { recordInitAnswers } from './telemetry'

export interface InstallOutcome {
  status: 'already' | 'installed' | 'skipped' | 'failed'
  /** The command as the user would type it — printed whatever the outcome. */
  command: string
  version?: string
  error?: string
}

export interface InitResult {
  project: Pick<ProjectInfo, 'cwd' | 'root' | 'packageDir' | 'kind' | 'packageName'>
  answers: InitAnswers
  packageManager: PackageManager
  install: InstallOutcome
  /** Files written (or that would be, under `--dry-run`). */
  written: FileAction[]
  already: string[]
  manual: ManualStep[]
  /** Extras asked for that this project cannot use. */
  dropped: ExtraId[]
  /** What the scan found — why the offers were what they were. */
  insight: InsightSummary | null
  /** `evlog doctor` after the writes, when it ran. */
  verified: VerifySummary | null
  /** The agent guidelines step, when it was asked for. */
  agentGuide: AgentGuideSummary | null
  dryRun: boolean
  /** True when the run asked questions — the report stays quiet if so. */
  interactive: boolean
  /** True when the user answered "no" at the plan, or hit Ctrl-C. */
  cancelled: boolean
}

/** What the scan found, summarised for the report and the telemetry event. */
export interface InsightSummary {
  repeatedErrors: number
  auditGaps: number
  pairable: string[]
}

/** The `evlog doctor` tally taken straight after the writes. */
export interface VerifySummary {
  ok: number
  warn: number
  fail: number
}

export type SkillsStatus = 'pending' | 'already' | 'installed' | 'failed'

/** What the agent guidelines step managed to do. */
export interface AgentGuideSummary {
  /** Skills already on disk when the run started, in any agent's directory. */
  found: string[]
  /** The agent directories they were found in. */
  dirs: string[]
  /** `npx skills add …`, as the user would type it. */
  command: string
  status: SkillsStatus
  /** Why the skills CLI did not finish, when it did not. */
  error?: string
}

export interface InitOptions {
  framework?: Framework
  service?: string
  devDrain?: DrainId
  prodDrains?: DrainId[]
  extras?: ExtraId[]
  enrichers?: EnricherId[]
  sampling?: SamplingProfile
  /** Plan everything, write nothing. */
  dryRun?: boolean
  /** Run the package manager when evlog is missing. Default: true. */
  install?: boolean
  /** Skip every question and take the defaults. */
  yes?: boolean
  /** Write the AGENTS.md block and install the skills. Default: true. */
  agentGuide?: boolean
  /** Force non-interactive regardless of the terminal (set by `--json`). */
  nonInteractive?: boolean
}

/** The package name without its scope: `@acme/checkout` → `checkout`. */
function defaultService(project: ProjectInfo): string {
  const name = project.packageName
  if (!name) return 'app'
  const unscoped = name.startsWith('@') ? name.split('/').at(-1) ?? name : name
  return unscoped.replace(/[^a-z0-9-_]/gi, '-') || 'app'
}

/** The module subpath and config factory differ per major. */
export function detectNitroMajor(pkg: PackageJson | null, framework: Framework): 2 | 3 {
  if (framework === 'tanstack-start') return 3
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  /* Nuxt 4 bundles Nitro v2 and never lists nitropack directly, so the nuxt
     version decides, not the dependency tree. Nightlies install through an
     npm: alias, so read the version out of the alias when there is one. */
  if (framework === 'nuxt') {
    const { nuxt } = deps
    return nuxt && majorFromRange(nuxt) >= 5 ? 3 : 2
  }
  if ('nitropack' in deps) return 2
  return 3
}

function majorFromRange(range: string): number {
  const version = range.startsWith('npm:') ? range.slice(range.lastIndexOf('@') + 1) : range.replace(/^[^\d]*/, '')
  return Number.parseInt(version.split('.')[0] ?? '', 10)
}

/**
 * Wire evlog into the project: read it, ask, plan, confirm, write, verify.
 *
 * Interactive when there is somebody to answer; flags and defaults fill in
 * everything when there is not. Both paths produce the same {@link InitAnswers}.
 * Nothing here overwrites a file that already exists.
 */
export async function runInit(
  ctx: CliContext,
  log: CliDebug = createNoopCliDebug(),
  options: InitOptions = {},
): Promise<InitResult> {
  const project = await log.step(
    'resolveProject',
    () => resolveProject(ctx.cwd),
    p => ({ cwd: ctx.cwd, project: { kind: p.kind, root: p.root, name: p.packageName } }),
  )

  const detection = await log.step(
    'detectFramework',
    () => detectFramework(project, options.framework),
    r => ({ framework: r.framework }),
  )

  /* `map` scans more frameworks than `init` can wire: refuse the map-only ones
     here, before any prompt, instead of crashing in the planner. */
  if (!isInitFramework(detection.framework)) {
    throw cliErrors.INIT_FRAMEWORK_UNSUPPORTED({ framework: detection.framework })
  }

  const resolved = await log.step(
    'resolveEvlog',
    () => resolveEvlog(project),
    r => ({ hasEvlog: !!r.install }),
  )

  // The same analysis `map` runs, so an offer can carry its evidence.
  const insight = await log.step(
    'readProject',
    () => readProject(project.packageDir, detection.framework, project.packageName ?? 'app'),
    r => ({ repeatedErrors: r?.repeatedErrors.length ?? 0, auditGaps: r?.auditGaps.length ?? 0 }),
  )

  const packageManager = detectPackageManager([project.packageDir, project.root])
  const command = installCommand(packageManager)
  const dryRun = options.dryRun === true
  const evlogInstalled = !!resolved.install
  const interactive = !options.nonInteractive && !options.yes && canPrompt(ctx)

  const offers = (prodDrains: DrainId[], framework: Framework): OfferContext => ({
    framework,
    prodDrains,
    facts: insight?.facts ?? null,
    auditGaps: insight?.auditGaps.length ?? 0,
  })

  const base = {
    framework: detection.framework,
    defaultService: defaultService(project),
    evlogInstalled,
    install: options.install !== false,
    agentGuide: options.agentGuide !== false,
    devDrain: options.devDrain,
    prodDrains: options.prodDrains,
    extras: options.extras,
    enrichers: options.enrichers,
    sampling: options.sampling,
    service: options.service,
    offers,
  }

  let answers: InitAnswers

  if (interactive) {
    openInteractive(ctx, 'evlog init', project.packageName ?? project.packageDir)
    try {
      answers = await askAnswers({
        ctx,
        detected: detection.framework,
        /* An explicit --framework is an answer, not a guess: do not ask again. */
        uncertain: options.framework === undefined && detection.warnings.length > 0,
        defaultService: base.defaultService,
        evlogInstalled,
        installRequested: base.install,
        agentGuideRequested: base.agentGuide,
        offers,
      })
    } catch (error) {
      if (error instanceof InitCancelled) {
        closeCancelled()
        return cancelled(cancelledResult({ project, answers: resolveAnswers(base), packageManager, command, dryRun }))
      }
      throw error
    }
  } else {
    answers = resolveAnswers(base)
  }

  log.set({
    devDrain: answers.devDrain,
    prodDrains: answers.prodDrains.join(',') || 'none',
    extras: answers.extras.join(',') || 'none',
  })

  const plan = await log.step(
    'planWiring',
    () => planWiring({
      root: project.packageDir,
      framework: answers.framework,
      service: answers.service,
      devDrain: answers.devDrain,
      prodDrains: answers.prodDrains,
      extras: answers.extras,
      enrichers: answers.enrichers,
      sampling: answers.sampling,
      nitroMajor: detectNitroMajor(project.packageJson, answers.framework),
      repeatedErrors: insight?.repeatedErrors ?? [],
      auditGaps: insight?.auditGaps ?? [],
    }),
    r => ({ writes: r.actions.length, manual: r.manual.length }),
  )

  /* Merged into the same plan rather than run afterwards, so the user reads one
     list and confirms once. The skills are a separate step: `npx skills add`
     owns them, and it runs alongside the package-manager install below. */
  let agentGuide: AgentGuideSummary | null = null
  if (answers.agentGuide) {
    agentGuide = await log.step('agentGuide', () => {
      const found = findInstalledSkills(project.packageDir, ctx.home)
      const guide = planAgents({
        root: project.packageDir,
        projectName: project.packageName ?? 'This project',
        framework: answers.framework,
        hasSkills: true,
      })
      plan.actions.push(...guide.actions)
      plan.already.push(...guide.already)
      /* In the plan as well as the report: a step nobody sees considered is a
         step the reader assumes was forgotten. */
      if (found.names.length > 0) {
        plan.already.push(`evlog skills already installed · ${found.dirs.join(', ')}`)
      }

      return {
        found: found.names,
        dirs: found.dirs,
        command: skillsCommand({ interactive }).display,
        status: 'pending' as SkillsStatus,
      }
    }, r => ({ found: r.found.length }))
  }

  /* What the run would shell out to, `--dry-run` included: a preview that hides
     the commands is the one thing a preview exists to show. Execution stays
     gated on `dryRun` separately, further down. */
  const wouldInstall = !evlogInstalled && answers.install
  /* Already-installed skills belong to `npx skills update`, not to us. */
  const wouldAddSkills = agentGuide !== null && agentGuide.found.length === 0
  const installing = wouldInstall && !dryRun
  const runs = [
    ...(wouldInstall ? [command] : []),
    ...(wouldAddSkills ? [agentGuide!.command] : []),
  ]

  if (interactive && dryRun) {
    /* `--dry-run` promises the plan. The confirm step is the only thing that
       renders it, and interactive runs suppress the written report — so
       without this the terminal shows the questions and then nothing. */
    showPlan(plan.actions, plan.already, runs)
  }

  if (interactive && !dryRun) {
    let confirmed: boolean
    try {
      confirmed = await confirmPlan(plan.actions, plan.already, runs)
    } catch (error) {
      if (error instanceof InitCancelled) {
        closeCancelled()
        return cancelled(cancelledResult({ project, answers, packageManager, command, dryRun }))
      }
      throw error
    }
    if (!confirmed) {
      closeCancelled()
      return cancelled(cancelledResult({ project, answers, packageManager, command, dryRun }))
    }
  }

  let install: InstallOutcome
  if (evlogInstalled) {
    install = { status: 'already', command, version: resolved.install!.version }
  } else if (!answers.install || dryRun) {
    install = { status: 'skipped', command }
  } else {
    const outcome = await log.step(
      'install',
      () => runInstall(packageManager, project.packageDir),
      r => ({ installed: r.ok }),
    )
    install = outcome.ok ? { status: 'installed', command } : { status: 'failed', command, error: outcome.error }
  }

  if (!dryRun) {
    await log.step('write', async () => {
      for (const action of plan.actions) {
        await mkdir(dirname(action.path), { recursive: true })
        await writeFile(action.path, action.contents, 'utf8')
      }
      return plan.actions.length
    })
  }

  if (agentGuide) {
    if (agentGuide.found.length > 0) {
      agentGuide.status = 'already'
    } else if (dryRun) {
      agentGuide.status = 'pending'
    } else {
      /* Runs after the writes: the block is the part we own, and it should be
         on disk whatever a subprocess we do not control decides to do. */
      if (interactive) noteSkillsStarting(ctx, agentGuide.command)
      const outcome = await log.step(
        'skills',
        () => runSkills(skillsCommand({ interactive }), project.packageDir, interactive),
        r => ({ installed: r.ok }),
      )
      agentGuide.status = outcome.ok ? 'installed' : 'failed'
      if (!outcome.ok) agentGuide.error = outcome.error
    }
  }

  let verified: VerifySummary | null = null
  if (!dryRun) {
    const verify = async (): Promise<VerifySummary> => {
      const doctor = await runDoctor({ ...ctx, cwd: project.packageDir })
      return doctor.summary
    }
    if (interactive) {
      await runVerification(async () => {
        verified = await verify()
        return `${verified.ok} ok · ${verified.warn} warn · ${verified.fail} fail`
      })
    } else {
      verified = await log.step('verify', verify)
    }
  }

  if (interactive) {
    if (agentGuide) noteSkills(ctx, agentGuide)
    noteManual(plan.manual)
    closeInteractive(ctx, answers.framework, getFramework(answers.framework).docs, dryRun)
  }

  log.set({ steps: ['done'] })

  const result: InitResult = {
    project,
    answers,
    packageManager,
    install,
    written: plan.actions,
    already: plan.already,
    manual: plan.manual,
    dropped: droppedExtras(base),
    insight: insight
      ? {
        repeatedErrors: insight.repeatedErrors.length,
        auditGaps: insight.auditGaps.length,
        pairable: [...insight.facts.pairable],
      }
      : null,
    verified,
    agentGuide,
    dryRun,
    interactive,
    cancelled: false,
  }

  recordInitAnswers(result)
  return result
}

/** The result of a run the user walked away from: answers kept, nothing done. */
function cancelledResult(input: {
  project: ProjectInfo
  answers: InitAnswers
  packageManager: PackageManager
  command: string
  dryRun: boolean
}): InitResult {
  return {
    project: input.project,
    answers: input.answers,
    packageManager: input.packageManager,
    install: { status: 'skipped', command: input.command },
    written: [],
    already: [],
    manual: [],
    dropped: [],
    insight: null,
    verified: null,
    agentGuide: null,
    dryRun: input.dryRun,
    /* Only an interactive run can be cancelled — there is nothing to answer
       when nobody was asked. */
    interactive: true,
    cancelled: true,
  }
}

/** A cancelled run still reports its answers: what people back out of matters. */
function cancelled(result: InitResult): InitResult {
  recordInitAnswers(result)
  return result
}
