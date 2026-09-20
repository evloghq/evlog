import type { ModelMessage } from 'ai'
import type { Experimental_EvaluationQuestion as EvaluationQuestion } from 'ai'
import { evaluate } from 'eve/ai'
import type { SessionAuthContext } from 'eve/context'
import { channelName } from './channel'
import { gatewayRouting, sessionTags } from './gateway'
import { preEscalateTriage, shouldPreEscalate } from './github/escalate'
import { addIssueLabels, fetchIssueSnapshot, listRepositoryLabels, type IssueSnapshot, type RepositoryLabel } from './github/issues'
import { githubCredentials } from './github/credentials'
import { mintInstallationToken } from './github/push'
import { isAutonomous } from './trust'

/**
 * Pre-routing for the first-responder turn (EVL-426): one Jev evaluation over
 * the issue body answers three typed questions before the expensive turn
 * starts. The router only picks how much reasoning budget the turn gets; it
 * never reduces what the turn may do. Any failure runs today's behavior: a
 * full turn at the agent's default reasoning.
 *
 * Opt-in until calibrated against historical first-responder turns:
 * `EVI_TRIAGE_ROUTER_ENABLED=1`. `EVI_JEV_MODEL` pins the evaluation model,
 * which Jev reports back resolved on every response (logged below).
 */

export interface TriageTurnContext {
  readonly channel: { readonly kind?: string }
  readonly messages?: readonly ModelMessage[]
  readonly session: { readonly auth: { readonly current: SessionAuthContext | null } }
}

export interface TriageRoute {
  readonly cheapTurn: boolean
}

export type TriageKind = 'question' | 'bug-with-repro' | 'bug-without-repro' | 'doc-gap' | 'off-topic'

/**
 * Thresholds in code, one per action. A wrong cheap turn only costs reasoning
 * budget, so it routes below the write thresholds; a wrong pre-escalation
 * notifies the maintainer, so it clears 0.85 (in `escalate.ts`).
 */
export const TRIAGE_THRESHOLDS = {
  /** Kind probability at or above which a non-bug issue runs a cheap turn. */
  cheapTurn: 0.75,
  /** Kind probability below which the distribution reads as flat: no signal is acted on. */
  flatKind: 0.45,
  /** Label probability at or above which the router applies the label itself. */
  applyLabel: 0.8,
} as const

/** Kinds that never run a reproduction in the sandbox, so a cheap turn serves them. */
const CHEAP_KINDS: ReadonlySet<string> = new Set<TriageKind>(['question', 'doc-gap', 'off-topic'])

const KIND_CRITERIA: Record<TriageKind, string> = {
  'question': 'Asks how something works or how to do it with evlog. Expects an answer, not a fix.',
  'bug-with-repro': 'Claims broken behavior and includes concrete reproduction steps, a snippet, or a failing example.',
  'bug-without-repro': 'Claims broken behavior but gives no steps or evidence to reproduce it.',
  'doc-gap': 'The substance is missing, unclear, or wrong documentation rather than code behavior.',
  'off-topic': 'Not about evlog: spam, a different project, a job post, or a personal request.',
}

const NEEDS_MAINTAINER_CRITERIA = {
  true: 'Someone with repository authority must decide: a security disclosure, a feature request needing a product decision, an issue in maintainer-only territory, or a report an answer, a reproduction request, or a label cannot serve.',
  false: 'A grounded answer, a request for reproduction steps, or a label resolves it.',
} as const

/**
 * Untrusted issue bodies are untrusted input: bounded before they reach the
 * evaluation model, same as any other surface that sees them.
 */
const TRIAGE_STATE_MAX_CHARS = 8000

export function triageRouterEnabled(): boolean {
  return process.env.EVI_TRIAGE_ROUTER_ENABLED === '1'
}

export function isTriageTurn(ctx: TriageTurnContext): boolean {
  return channelName(ctx.channel?.kind) === 'github' && isAutonomous(ctx.session?.auth?.current ?? null)
}

/**
 * The first-responder dispatch is the only GitHub turn whose first message is
 * eve's issue webhook line, `Issue opened: #<n> <title>` (see
 * `formatIssueEventMessage`). Reopened or edited issues re-run the full turn:
 * their triage history is not a fresh classification.
 */
export function parseTriageIssueNumber(messages: readonly ModelMessage[] | undefined): number | null {
  const first = messages?.[0]
  if (!first || first.role !== 'user') return null
  const match = /^Issue opened: #(\d+)/.exec(messageText(first.content))
  return match ? Number(match[1]) : null
}

export function buildQuestions(taxonomy: readonly RepositoryLabel[]): Record<string, EvaluationQuestion> {
  const questions: Record<string, EvaluationQuestion> = {
    kind: {
      type: 'choice',
      instructions: 'Triage a newly opened community issue about the evlog logging library: what does the reporter need?',
      criteria: KIND_CRITERIA,
    },
    needsMaintainer: {
      type: 'boolean',
      instructions: 'Does this issue need the maintainer rather than a grounded reply, a reproduction request, or a label?',
      criteria: NEEDS_MAINTAINER_CRITERIA,
    },
  }
  if (taxonomy.length > 0) {
    questions.label = {
      type: 'choice',
      instructions: 'The single best-fitting existing repository label for this issue. Choose only among the labels listed in the criteria.',
      criteria: Object.fromEntries(taxonomy.map(label => [label.name, label.description])),
    }
  }
  return questions
}

interface ChoiceAnswer {
  readonly choice: string
  readonly probabilities?: Record<string, number>
}

interface BooleanAnswer {
  readonly probability: number
}

export interface TriageAnswers {
  readonly kind: ChoiceAnswer
  readonly label?: ChoiceAnswer
  readonly needsMaintainer?: BooleanAnswer
}

export interface RoutingDecision {
  readonly kind: string
  readonly kindProbability: number
  readonly cheapTurn: boolean
  readonly label: string | null
  readonly labelProbability: number
  readonly applyLabel: boolean
  readonly preEscalate: boolean
}

/**
 * Pure decision over the Jev answers: thresholds here, no I/O. A flat kind
 * distribution means the criteria missed, not that the model is sure — every
 * signal falls back to today's full turn.
 */
export function decideRouting(answers: TriageAnswers, taxonomy: ReadonlySet<string>): RoutingDecision {
  const kind = answers.kind.choice
  const kindProbability = answers.kind.probabilities?.[kind] ?? 0
  const flat = kindProbability < TRIAGE_THRESHOLDS.flatKind

  const cheapTurn = !flat
    && CHEAP_KINDS.has(kind)
    && kindProbability >= TRIAGE_THRESHOLDS.cheapTurn

  const label = answers.label && taxonomy.has(answers.label.choice) ? answers.label.choice : null
  const labelProbability = label ? answers.label?.probabilities?.[label] ?? 0 : 0
  const applyLabel = !flat
    && label !== null
    && labelProbability >= TRIAGE_THRESHOLDS.applyLabel

  const preEscalate = !flat
    && shouldPreEscalate(answers.needsMaintainer?.probability ?? 0)

  return { kind, kindProbability, cheapTurn, label, labelProbability, applyLabel, preEscalate }
}

/**
 * Pre-route an autonomous first-responder turn. Returns null — keep today's
 * full turn at the agent's default reasoning — whenever the router is off,
 * the turn is not an issue dispatch, or anything below fails.
 */
export async function preRouteTriage(ctx: TriageTurnContext): Promise<TriageRoute | null> {
  if (!triageRouterEnabled() || !isTriageTurn(ctx)) return null
  const issueNumber = parseTriageIssueNumber(ctx.messages)
  if (issueNumber === null) return null
  try {
    return await routeTriageIssue(issueNumber)
  }
  catch (error) {
    console.error(`[evi:triage-router] issue #${issueNumber} pre-routing failed; running the full turn`, error)
    return null
  }
}

async function routeTriageIssue(issueNumber: number): Promise<TriageRoute> {
  const startedAt = Date.now()
  const token = await mintInstallationToken(githubCredentials)
  const [issue, taxonomy] = await Promise.all([
    fetchIssueSnapshot(issueNumber, token),
    listRepositoryLabels(token),
  ])

  const jevModel = process.env.EVI_JEV_MODEL?.trim()
  const result = await evaluate({
    ...(jevModel ? { model: jevModel } : {}),
    state: triageState(issue),
    questions: buildQuestions(taxonomy),
    maxRetries: 1,
    providerOptions: {
      gateway: {
        ...gatewayRouting(true),
        tags: triageTags(),
      },
    },
  })

  const decision = decideRouting(answersOf(result), new Set(taxonomy.map(label => label.name)))

  if (decision.preEscalate) await preEscalateTriage(issueNumber, token)
  if (decision.applyLabel && decision.label && issue.labels.length === 0) {
    await addIssueLabels(issueNumber, [decision.label], token)
  }

  console.log(`[evi:triage-router] issue #${issueNumber} kind=${decision.kind} (${decision.kindProbability}) cheapTurn=${decision.cheapTurn} label=${decision.label ?? 'none'} (${decision.labelProbability}) preEscalate=${decision.preEscalate} model=${result.response.modelId} tokens=${result.usage.totalTokens ?? 'unknown'} ${Date.now() - startedAt}ms`)

  return { cheapTurn: decision.cheapTurn }
}

function triageState(issue: IssueSnapshot): string {
  const body = issue.body.length > TRIAGE_STATE_MAX_CHARS
    ? `${issue.body.slice(0, TRIAGE_STATE_MAX_CHARS)}\n[truncated]`
    : issue.body
  return `Issue title: ${issue.title}\n\n${body}`
}

function triageTags(): string[] {
  const [envTag] = sessionTags('github')
  return [envTag, 'evi:surface:triage-router']
}

type RawAnswer = {
  readonly choice?: unknown
  readonly probability?: unknown
  readonly probabilities?: unknown
}

/**
 * `evaluate` is generic over a statically known question map; the label
 * question is built from the live taxonomy, so the answers are narrowed by
 * shape here instead of by type.
 */
function answersOf(result: { readonly answers: Record<string, unknown> }): TriageAnswers {
  const answers = result.answers as Record<string, RawAnswer>
  const kind = choiceAnswer(answers.kind)
  if (!kind) throw new Error('the triage router got no kind answer')
  return {
    kind,
    label: choiceAnswer(answers.label) ?? undefined,
    needsMaintainer: booleanAnswer(answers.needsMaintainer) ?? undefined,
  }
}

function choiceAnswer(answer: RawAnswer | undefined): ChoiceAnswer | null {
  if (typeof answer?.choice !== 'string') return null
  const probabilities = answer.probabilities
  return {
    choice: answer.choice,
    probabilities: isProbabilityMap(probabilities) ? probabilities : undefined,
  }
}

function booleanAnswer(answer: RawAnswer | undefined): BooleanAnswer | null {
  return typeof answer?.probability === 'number' ? { probability: answer.probability } : null
}

function isProbabilityMap(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null
    && Object.values(value).every(number => typeof number === 'number')
}

function messageText(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const part of content) {
    if (part.type === 'text') text += part.text
  }
  return text
}