import type { CANCEL_SYMBOL } from '@clack/prompts'
import {
  autocomplete,
  autocompleteMultiselect,
  cancel,
  confirm,
  groupMultiselect,
  intro,
  isCancel,
  log as clackLog,
  multiselect,
  note,
  outro,
  select,
  tasks,
  text,
} from '@clack/prompts'
import type { CliContext } from '../../core/context'
import { DOCS_URL, createStyle } from '../../core/output'
import type { Framework } from '../map/types'
import { INIT_FRAMEWORK_IDS, getFramework } from '../frameworks'
import {
  availableExtras,
  DEFAULT_ENRICHERS,
  DEV_DESTINATIONS,
  ENRICHERS,
  offerEvidence,
  PROD_DESTINATIONS,
  SAMPLING_PRESETS,
} from './catalog'
import type { DrainId, EnricherId, ExtraGroup, ExtraId, OfferContext, SamplingProfile } from './catalog'
import type { FileAction, ManualStep } from './wiring'

/** Every answer `init` needs, however it was obtained. */
export interface InitAnswers {
  framework: Framework
  service: string
  /** Local sink: `fs` or `none`. */
  devDrain: DrainId
  /** Production destinations — more than one fans the same event out to each. */
  prodDrains: DrainId[]
  extras: ExtraId[]
  enrichers: EnricherId[]
  sampling: SamplingProfile
  /** Run the package manager for a missing `evlog`. */
  install: boolean
  /** Write the `AGENTS.md` block and install the published skills. */
  agentGuide: boolean
}

/** Thrown when the user aborts a prompt — the command exits quietly, writing nothing. */
export class InitCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'InitCancelled'
  }
}

/** Unwrap a clack answer, turning a cancel into a throw. */
function required<T>(value: T | typeof CANCEL_SYMBOL): T {
  if (isCancel(value)) throw new InitCancelled()
  return value
}

export interface PromptContext {
  ctx: CliContext
  detected: Framework
  /** Detection was a guess rather than a match — ask instead of announcing. */
  uncertain: boolean
  defaultService: string
  evlogInstalled: boolean
  /** Whether `--install` is still on — `--no-install` is an answer, not a prompt. */
  installRequested: boolean
  /** Whether `--agents` is still on — `--no-agents` is an answer, not a prompt. */
  agentGuideRequested: boolean
  /** Builds the offer list once the destinations are known. */
  offers: (prodDrains: DrainId[], framework: Framework) => OfferContext
}

export function openInteractive(ctx: CliContext, command: string, projectLabel: string): void {
  const { paint } = createStyle(ctx)
  intro(`${paint(['bold', 'cyan'], ` ${command} `)} ${paint('dim', projectLabel)}`)
}

/**
 * Ask everything, in the order a person thinks about it: what am I, what am I
 * called, where do events go here, where do they go in production, what else.
 */
export async function askAnswers(input: PromptContext): Promise<InitAnswers> {
  const framework = input.uncertain
    ? required(await select<Framework>({
      message: 'Which framework is this?',
      /* Only the frameworks init can wire — map-only ones would crash the planner. */
      options: INIT_FRAMEWORK_IDS.map(id => ({
        value: id,
        label: getFramework(id).label,
      })),
      initialValue: input.detected,
    }))
    : input.detected

  if (!input.uncertain) {
    clackLog.step(`Detected ${getFramework(framework).label}`)
  }

  const service = required(await text({
    message: 'Service name on every wide event',
    placeholder: input.defaultService,
    defaultValue: input.defaultService,
    validate(value) {
      /* Empty means "take the default", which clack fills in afterwards. */
      if (value !== undefined && value.length > 0 && !/^[\w.-]+$/.test(value)) {
        return 'Letters, numbers, dot, dash and underscore only — it ends up in a log field'
      }
      return undefined
    },
  }))

  /* Two questions: nobody sends local traffic to Axiom, and nobody reads
     production logs off the box's filesystem. */
  const devDrain = required(await select<DrainId>({
    message: 'In development, where should events go?',
    options: DEV_DESTINATIONS.map(destination => ({
      value: destination.id,
      label: destination.label,
      hint: destination.hint,
    })),
    initialValue: 'fs' as DrainId,
  }))

  const prodDrains = required(await autocompleteMultiselect<DrainId>({
    message: 'And in production?',
    placeholder: 'Type to search — leave empty to decide later',
    options: PROD_DESTINATIONS.map(destination => ({
      value: destination.id,
      label: destination.label,
      hint: destination.hint,
    })),
    initialValues: [],
    required: false,
  }))

  const context = input.offers(prodDrains, framework)
  const offered = availableExtras(context)

  let extras: ExtraId[] = []
  if (offered.length > 0) {
    // Grouped: eight options under one heading is a list, under four it is a decision.
    const groups: Record<string, { value: ExtraId, label: string, hint?: string }[]> = {}
    for (const extra of offered) {
      const evidence = offerEvidence(extra, context)
      const { group } = extra
      groups[group] ??= []
      groups[group]!.push({
        value: extra.id,
        // In the label, not the hint: only the focused row renders its hint.
        label: evidence ? `${extra.label} · ${evidence}` : extra.label,
        hint: extra.hint,
      })
    }

    extras = required(await groupMultiselect<ExtraId>({
      message: 'Anything else?',
      options: groups,
      initialValues: [],
      required: false,
      selectableGroups: false,
    }))
  }

  const enrichers = extras.includes('enrichers')
    ? required(await multiselect<EnricherId>({
      message: 'Which enrichers?',
      options: ENRICHERS.map(enricher => ({
        value: enricher.id,
        label: enricher.label,
        hint: enricher.hint,
      })),
      initialValues: [...DEFAULT_ENRICHERS],
      required: false,
    }))
    : []

  const sampling = extras.includes('sampling')
    ? required(await select<SamplingProfile>({
      message: 'How much healthy traffic should reach the drain?',
      options: SAMPLING_PRESETS.map(preset => ({
        value: preset.id,
        label: preset.label,
        hint: preset.hint,
      })),
      initialValue: 'medium' as SamplingProfile,
    }))
    : 'all'

  /* Wiring evlog in and leaving the agent that writes the handlers unaware of
     it is most of the way to nothing. */
  const agentGuide = input.agentGuideRequested
    ? required(await confirm({
      message: 'Teach AI agents the evlog conventions? (AGENTS.md + skills)',
      initialValue: true,
    }))
    : false

  // Not a question of its own: the plan lists the install and asks once.
  return {
    framework,
    service: service || input.defaultService,
    devDrain,
    prodDrains,
    extras: extras.filter(id => id !== 'enrichers' || enrichers.length > 0),
    enrichers,
    sampling,
    install: !input.evlogInstalled && input.installRequested,
    agentGuide,
  }
}

/**
 * Nothing lands until the user has read what is about to land.
 *
 * @param runs - Commands this run will shell out to, listed before the writes.
 */
export function showPlan(
  actions: FileAction[],
  already: string[],
  runs: string[] = [],
): boolean {
  const lines: string[] = []

  for (const run of runs) lines.push(`run  ${run}`)
  for (const action of actions) {
    lines.push(`${action.kind === 'create' ? 'create' : 'update'}  ${action.relative}`)
  }
  for (const entry of already) lines.push(`skip  ${entry}`)

  if (lines.length === 0) {
    note('Everything is already wired.', 'Nothing to do')
    return false
  }

  note(lines.join('\n'), 'Plan')
  return true
}

export async function confirmPlan(
  actions: FileAction[],
  already: string[],
  runs: string[] = [],
): Promise<boolean> {
  if (!showPlan(actions, already, runs)) return false

  return required(await confirm({ message: 'Apply?', initialValue: true }))
}

/** How the agent skills ended up, for a run that is drawing its own frame. */
export interface SkillsNote {
  status: 'pending' | 'already' | 'installed' | 'skipped' | 'failed'
  /** `npx skills add …`, as the user would type it. */
  command: string
  /** Agent directories they were found in, when they were already there. */
  dirs?: string[]
  error?: string
}

/**
 * A command the reader is meant to type.
 *
 * Label on the left, command on the right — the shape the outro already uses
 * for `score  evlog map`. Inline in a sentence it reads as prose and the reader
 * never registers there is something for them to run.
 */
function command(ctx: CliContext, label: string, line: string): string {
  const { paint } = createStyle(ctx)
  return `${paint('dim', label)}  ${paint('bold', line)}`
}

/**
 * Say what happened to the skills.
 *
 * The interactive flow suppresses the written report, so without this the whole
 * step is invisible — and "already installed" looks exactly like "did nothing"
 * to somebody watching the terminal.
 */
export function noteSkills(ctx: CliContext, note: SkillsNote): void {
  const { paint } = createStyle(ctx)

  switch (note.status) {
    case 'already':
      clackLog.success(`evlog skills already installed${note.dirs?.length ? ` · ${paint('dim', note.dirs.join(', '))}` : ''}`)
      clackLog.message(command(ctx, 'refresh', 'npx skills update'))
      return
    case 'installed':
      clackLog.success('Installed the evlog skills')
      return
    case 'failed':
      clackLog.error('Skills not installed')
      if (note.error) clackLog.message(paint('dim', note.error))
      clackLog.message(command(ctx, 'retry  ', note.command))
      return
    default:
      clackLog.warn('Skills not installed')
      clackLog.message(command(ctx, 'install', note.command))
  }
}

/** Said before handing the terminal to the skills CLI, so it is not a surprise. */
export function noteSkillsStarting(ctx: CliContext, line: string): void {
  const { paint } = createStyle(ctx)
  clackLog.step(
    `${command(ctx, 'running', line)}\n${paint('dim', 'the skills CLI takes over from here')}`,
  )
}

export function noteManual(steps: ManualStep[]): void {
  for (const step of steps) {
    note(`${step.snippet}\n\n${step.reason}`, `${step.title} — ${step.file}`)
  }
}

/** The question after a setup is "did it work" — answer it here. */
export async function runVerification(verify: () => Promise<string>): Promise<void> {
  await tasks([
    {
      title: 'Verifying the install',
      task: async () => await verify(),
    },
  ])
}

export function closeInteractive(
  ctx: CliContext,
  framework: Framework,
  docsPath: string,
  dryRun = false,
): void {
  const { paint } = createStyle(ctx)
  if (dryRun) {
    /* "Nitro wired" after a run that wrote nothing is the command claiming
       credit for work it did not do. */
    outro(`${paint('yellow', 'Dry run')} — nothing was written. Drop --dry-run to apply.`)
    return
  }
  clackLog.message(`${paint('dim', 'score')}  evlog map`)
  outro(`${getFramework(framework).label} wired · ${DOCS_URL}${docsPath}`)
}

/** Closes the `evlog agents` session — without it the run just stops mid-frame. */
export function closeAgents(ctx: CliContext, dryRun = false): void {
  const { paint } = createStyle(ctx)
  if (dryRun) {
    outro(`${paint('yellow', 'Dry run')} — nothing was written. Drop --dry-run to apply.`)
    return
  }
  outro(`Your agents know evlog · ${DOCS_URL}/cli/agents`)
}

export function closeCancelled(): void {
  cancel('Cancelled — nothing was written.')
}

/** Ask which workspace packages to set up. */
export async function askWorkspaceTargets(
  candidates: { name: string, dir: string, framework: Framework }[],
): Promise<string[]> {
  return required(await multiselect<string>({
    message: 'Which apps should be set up?',
    options: candidates.map(candidate => ({
      value: candidate.dir,
      label: candidate.name,
      hint: getFramework(candidate.framework).label,
    })),
    initialValues: candidates.map(candidate => candidate.dir),
    required: true,
  }))
}

/**
 * Whether prompting is possible and wanted.
 *
 * Non-interactive is the default whenever anything suggests nobody is watching:
 * no TTY, a CI environment, `--json`, or an explicit `--yes`. An agent running
 * this command must never end up waiting on a keystroke that is not coming.
 */
export function canPrompt(ctx: CliContext): boolean {
  /* Both halves matter and they are not the same question: without a terminal
     on stdin there is nobody to answer, and without one on stdout there is
     nowhere to draw. */
  if (!ctx.stdinTty || !ctx.tty) return false
  if (ctx.env.CI !== undefined && ctx.env.CI !== 'false' && ctx.env.CI !== '0') return false
  return true
}
