import { log as clackLog } from '@clack/prompts'
import { EvlogError } from 'evlog'
import { runDoctor } from '../../commands/doctor'
import type { CliContext } from '../../core/context'
import { planAgents } from '../agents/plan'
import { dropSkillsPointer } from '../agents/run'
import { findInstalledSkills, runSkills, skillsCommand } from '../agents/skills'
import type { CliDebug } from '../debug'
import { createNoopCliDebug } from '../debug'
import { cliErrors } from '../errors'
import { detectFramework, rangeMajor } from '../map/detect'
import type { DetectionResult } from '../map/detect'
import { eveAgentDirs, findEveRoot } from '../frameworks/eve/mount'
import { findVercelProject } from '../logs/vercel'
import { findLogConnectors, runSetupVercel } from '../setup-vercel'
import type { ConnectorChoice } from '../setup-vercel'
import type { Framework } from '../map/types'
import { evlogReached, resolveEvlog, resolveProject } from '../project'
import type { PackageJson, ProjectInfo } from '../project'
import { getFramework, isInitFramework } from '../frameworks'
import type { InitFramework } from '../frameworks'
import type { DrainId, EnricherId, ExtraId, OfferContext, SamplingProfile } from './catalog'
import { configuredService, planWiring } from './wiring'
import type { FileAction, ManualStep } from './wiring'
import { readProject } from './insight'
import type { ProjectInsight } from './insight'
import { previewActions, previewInstall } from './diff'
import type { FilePreview } from './diff'
import { detectPackageManager, installCommand, installSpecs, runInstall } from './pm'
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
  askVercelConnector,
  noteInfo,
  noteSkillsStarting,
  noteStep,
  openInteractive,
  showPreview,
  runVerification,
} from './prompts'
import { vercelOutcome } from './report'
import type { InitAnswers } from './prompts'
import { droppedExtras, resolveAnswers } from './resolve'
import { writeActions } from './write'
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
  /** Under `--dry-run`, what each written file and the install would change. Empty otherwise. */
  preview: FilePreview[]
  already: string[]
  /** What the setup gives that no file shows, such as the agent's logs tool. */
  notes: string[]
  manual: ManualStep[]
  /** The app an eve agent ships inside, wired beside it. */
  host: InitFramework | null
  /** Services eve agents report under, apart from `answers.service`. */
  agentServices: string[]
  /** The Vercel connector step for an eve agent, when one was chosen. */
  vercel: VercelSummary | null
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
  /**
   * Wrapper packages that forward evlog to this app (`@acme/logger`). When evlog
   * is reached only through one, `init` stops: nothing to install, nothing to scaffold.
   */
  wrappers: string[]
}

/** The connector a deployed eve agent reads its Vercel runtime logs through. */
export interface VercelSummary {
  projectId: string
  connector: string
  /** `pending` under `--dry-run`, `ready` once attached and read back, `failed` with why. */
  status: 'pending' | 'ready' | 'failed'
  error?: string
  /** The config init left as it is, which still has to name the connector. */
  addTo?: string
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
  /** eve only: the agent's `evlog__logs` tool. Default: true, or asked. */
  agentLogs?: boolean
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

/** The evlog major init writes import paths for: the installed one, or 3, the major init installs. */
export function detectEvlogMajor(installedVersion: string | undefined): 2 | 3 {
  return installedVersion !== undefined && Number.parseInt(installedVersion, 10) === 2 ? 2 : 3
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

  /* eve below 1.0 is not detected as eve, so an agent on it would otherwise be
     set up as its web app, or not at all, without saying why. */
  const eveRange = project.packageJson?.dependencies?.eve ?? project.packageJson?.devDependencies?.eve
  const eveMajor = eveRange === undefined ? null : rangeMajor(eveRange)
  const oldEve = eveRange !== undefined && eveMajor !== null && eveMajor < 1 && eveAgentDirs(project.packageDir).length > 0
  let detection: DetectionResult
  try {
    detection = await log.step(
      'detectFramework',
      () => detectFramework(project, options.framework),
      r => ({ framework: r.framework }),
    )
  } catch (error) {
    if (oldEve && error instanceof EvlogError && error.code === 'cli.MAP_FRAMEWORK_NOT_DETECTED') throw cliErrors.INIT_EVE_TOO_OLD({ range: eveRange! })
    throw error
  }

  /* An eve agent inside a web app: the app is wired beside it, from the same
     config. An explicit --framework picks one of the two. */
  const hostOf = (framework: Framework): InitFramework | undefined => framework === 'eve' && options.framework === undefined
    ? detection.also.find((id): id is InitFramework => isInitFramework(id) && id !== 'eve')
    : undefined

  /* `map` scans more frameworks than `init` can wire: refuse the map-only ones
     here, before any prompt, instead of crashing in the planner. */
  if (!isInitFramework(detection.framework)) {
    throw cliErrors.INIT_FRAMEWORK_UNSUPPORTED({ framework: detection.framework })
  }

  const resolved = await log.step(
    'resolveEvlog',
    () => resolveEvlog(project),
    r => ({ hasEvlog: evlogReached(r) }),
  )

  // The same analysis `map` runs, so an offer can carry its evidence.
  const insight = await log.step(
    'readProject',
    () => readProject(project.packageDir, hostOf(detection.framework) ?? detection.framework, project.packageName ?? 'app'),
    r => ({ repeatedErrors: r?.repeatedErrors.length ?? 0, auditGaps: r?.auditGaps.length ?? 0 }),
  )

  const packageManager = detectPackageManager([project.packageDir, project.root])
  const dryRun = options.dryRun === true
  const evlogInstalled = !!resolved.install
  /* evlog plus the framework's own package (`@evlog/eve`), minus what the
     project already has. */
  const missingPackages = (framework: Framework): string[] => {
    const declared = { ...project.packageJson?.dependencies, ...project.packageJson?.devDependencies }
    return [
      ...(evlogInstalled ? [] : ['evlog']),
      ...(getFramework(framework).packages ?? []).filter(name => !(name in declared)),
    ]
  }
  const nothingToInstall = missingPackages(detection.framework).length === 0
  let command = installCommand(packageManager, nothingToInstall ? ['evlog'] : missingPackages(detection.framework))
  const wrappers = [...resolved.wrappers.keys()]
  const interactive = !options.nonInteractive && !options.yes && canPrompt(ctx)

  const offers = (prodDrains: DrainId[], framework: Framework): OfferContext => ({
    framework,
    prodDrains,
    facts: insight?.facts ?? null,
    auditGaps: insight?.auditGaps.length ?? 0,
  })

  const base = {
    framework: detection.framework,
    defaultService: configuredService({ root: project.packageDir, workspaceRoot: project.root }) ?? defaultService(project),
    evlogInstalled: nothingToInstall,
    install: options.install !== false,
    agentGuide: options.agentGuide !== false,
    agentLogs: options.agentLogs,
    devDrain: options.devDrain,
    prodDrains: options.prodDrains,
    extras: options.extras,
    enrichers: options.enrichers,
    sampling: options.sampling,
    service: options.service,
    offers,
  }

  /* evlog already reaches this app through a wrapper package: there is nothing
     to install and no second setup to scaffold beside it. Stop before any
     prompt or write. The answers are the defaults this run would have used. */
  if (!evlogInstalled && wrappers.length > 0) {
    const wrappedAnswers = resolveAnswers({ ...base, install: false, agentGuide: false })
    log.set({ steps: ['done'] })
    const stopped: InitResult = {
      project,
      answers: wrappedAnswers,
      packageManager,
      install: { status: 'already', command },
      written: [],
      preview: [],
      already: [],
      notes: [],
      manual: [],
      host: null,
      agentServices: [],
      vercel: null,
      dropped: [],
      insight: null,
      verified: null,
      agentGuide: null,
      dryRun,
      interactive: false,
      cancelled: false,
      wrappers,
    }
    recordInitAnswers(stopped)
    return stopped
  }

  let answers: InitAnswers

  if (interactive) {
    openInteractive(ctx, 'evlog init', project.packageName ?? project.packageDir)
    try {
      answers = await askAnswers({
        ctx,
        detected: detection.framework,
        host: hostOf(detection.framework),
        /* An explicit --framework is an answer, not a guess: do not ask again. */
        uncertain: options.framework === undefined && detection.warnings.length > 0 && !hostOf(detection.framework),
        defaultService: base.defaultService,
        evlogInstalled: nothingToInstall,
        installRequested: base.install,
        agentGuideRequested: base.agentGuide,
        agentLogs: options.agentLogs,
        offers,
      })
    } catch (error) {
      if (error instanceof InitCancelled) {
        closeCancelled()
        return cancelled(cancelledResult({ project, answers: resolveAnswers(base), packageManager, command, dryRun, wrappers }))
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

  const host = hostOf(answers.framework)
  const vercelProject = answers.framework === 'eve' ? await findVercelProject(project.packageDir, project.root) : undefined
  /* Asked, never assumed: a connector carries the authority of the key it
     stores. Only a run with somebody to answer looks the team's connectors up. */
  let connector: ConnectorChoice | null = null
  const notes: string[] = []
  if (vercelProject && interactive) {
    try {
      const found = await findLogConnectors(vercelProject)
      connector = await askVercelConnector(vercelProject.projectId, found.reusable, found.attached, 'vercel/evlog')
    } catch (error) {
      if (error instanceof InitCancelled) {
        closeCancelled()
        return cancelled(cancelledResult({ project, answers, packageManager, command, dryRun, wrappers }))
      }
      if (!(error instanceof EvlogError)) throw error
      notes.push(`Could not list the team's Vercel connectors (${error.message}). npx evlog setup vercel sets one up later`)
    }
  }
  const plan = await log.step(
    'planWiring',
    () => planWiring({
      root: project.packageDir,
      workspaceRoot: project.root,
      framework: answers.framework,
      host,
      agentLogs: answers.agentLogs,
      vercelProject: vercelProject?.projectId,
      logsConnector: connector?.connector,
      service: answers.service,
      devDrain: answers.devDrain,
      prodDrains: answers.prodDrains,
      extras: answers.extras,
      enrichers: answers.enrichers,
      sampling: answers.sampling,
      nitroMajor: detectNitroMajor(project.packageJson, host ?? answers.framework),
      evlogMajor: detectEvlogMajor(resolved.install?.version),
      repeatedErrors: insight?.repeatedErrors ?? [],
      auditGaps: insight?.auditGaps ?? [],
    }),
    r => ({ writes: r.actions.length, manual: r.manual.length }),
  )

  plan.notes.push(...notes)
  if (answers.framework !== 'eve') {
    const eveRoot = findEveRoot(project.packageDir)
    if (eveRoot) plan.notes.push(`eve runs this app's agent from ${eveRoot}. Set it up with evlog init --cwd ${eveRoot}`)
    if (oldEve) plan.notes.push(`The agent here is on eve ${eveRange}: @evlog/eve needs eve 1.0 or later, so init set up ${getFramework(answers.framework).label} only`)
  }

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

  /* The framework answered may not be the one detected. */
  const packages = missingPackages(answers.framework)
  if (packages.length > 0) command = installCommand(packageManager, packages)

  /* What the run would shell out to, `--dry-run` included: a preview that hides
     the commands is the one thing a preview exists to show. Execution stays
     gated on `dryRun` separately, further down. */
  const wouldInstall = packages.length > 0 && answers.install
  /* Already-installed skills belong to `npx skills update`, not to us. */
  const wouldAddSkills = agentGuide !== null && agentGuide.found.length === 0
  const installing = wouldInstall && !dryRun
  const runs = [
    ...(wouldInstall ? [command] : []),
    ...(wouldAddSkills ? [agentGuide!.command] : []),
  ]

  /* Read before anything is written: the diff is against the files as they are. */
  const preview = dryRun
    ? [...(wouldInstall ? [previewInstall(project.packageDir, installSpecs(packages), command)] : []), ...previewActions(plan.actions)]
    : []

  if (interactive && dryRun) {
    /* `--dry-run` promises the plan. The confirm step is the only thing that
       renders it, and interactive runs suppress the written report — so
       without this the terminal shows the questions and then nothing. */
    showPlan(plan.actions, plan.already, runs)
    showPreview(ctx, preview)
  }

  if (interactive && !dryRun) {
    let confirmed: boolean
    try {
      confirmed = await confirmPlan(plan.actions, plan.already, runs)
    } catch (error) {
      if (error instanceof InitCancelled) {
        closeCancelled()
        return cancelled(cancelledResult({ project, answers, packageManager, command, dryRun, wrappers }))
      }
      throw error
    }
    if (!confirmed) {
      closeCancelled()
      return cancelled(cancelledResult({ project, answers, packageManager, command, dryRun, wrappers }))
    }
  }

  let install: InstallOutcome
  if (packages.length === 0) {
    install = { status: 'already', command, version: resolved.install?.version }
  } else if (!answers.install || dryRun) {
    install = { status: 'skipped', command }
  } else {
    const outcome = await log.step(
      'install',
      () => runInstall(packageManager, project.packageDir, packages),
      r => ({ installed: r.ok }),
    )
    install = outcome.ok ? { status: 'installed', command } : { status: 'failed', command, error: outcome.error }
  }

  if (!dryRun) {
    await log.step('write', async () => {
      await writeActions(plan.actions)
      return plan.actions.length
    })
  }

  /* After the writes, so the config naming the connector is on disk whatever
     Vercel answers. The same steps as `evlog setup vercel`, each skipped when done. */
  let vercel: VercelSummary | null = null
  if (vercelProject && connector) {
    const uid = connector.connector
    const addTo = plan.manual.find(step => step.title === `Read the agent's Vercel logs through ${uid}`)?.file
    vercel = { projectId: vercelProject.projectId, connector: uid, status: 'pending', ...(addTo && { addTo }) }
    if (!dryRun) {
      try {
        await runSetupVercel({ ...ctx, cwd: project.packageDir }, {
          connector: connector.connector,
          create: connector.create,
          /* The plan already wrote the connector into a new config, or listed it as a manual step for an existing one. */
          writeConfig: false,
          onStep: step => noteStep(ctx, step),
        })
        vercel.status = 'ready'
      } catch (error) {
        if (!(error instanceof EvlogError)) throw error
        vercel.status = 'failed'
        vercel.error = error.fix ? `${error.message}. ${error.fix}` : error.message
      }
    }
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
      if (!outcome.ok) {
        agentGuide.error = outcome.error
        await log.step('rewriteBlock', () => dropSkillsPointer({
          root: project.packageDir,
          projectName: project.packageName ?? 'This project',
          framework: answers.framework,
        }))
      }
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
    noteInfo(plan.notes)
    if (vercel?.status === 'ready') (vercel.addTo ? clackLog.warn : clackLog.success)(vercelOutcome(vercel))
    if (vercel?.status === 'failed') clackLog.error(vercelOutcome(vercel))
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
    preview,
    already: plan.already,
    notes: plan.notes,
    host: host ?? null,
    agentServices: plan.agentServices ?? [],
    vercel,
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
    wrappers,
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
  wrappers: string[]
}): InitResult {
  return {
    project: input.project,
    answers: input.answers,
    packageManager: input.packageManager,
    install: { status: 'skipped', command: input.command },
    written: [],
    preview: [],
    already: [],
    notes: [],
    manual: [],
    host: null,
    agentServices: [],
    vercel: null,
    dropped: [],
    insight: null,
    verified: null,
    agentGuide: null,
    dryRun: input.dryRun,
    /* Only an interactive run can be cancelled — there is nothing to answer
       when nobody was asked. */
    interactive: true,
    cancelled: true,
    wrappers: input.wrappers,
  }
}

/** A cancelled run still reports its answers: what people back out of matters. */
function cancelled(result: InitResult): InitResult {
  recordInitAnswers(result)
  return result
}
