import type { AgentSendOptions, WorkflowToolContext } from 'eve/tools'
import { z } from 'zod'

export const simplificationInputSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/).describe('Full commit SHA reviewed by every specialist'),
  codeScope: z.string().min(1).describe('Exact files or directories assigned to the code simplifier'),
  testScope: z.string().min(1).describe('Exact test files and corresponding source assigned to the test reviewer'),
  architectureScope: z.string().min(1).describe('Exact boundaries and relationships assigned to the architecture reviewer'),
  communicationScope: z.string().min(1).describe('Exact authored files and complete recent Evi artifacts assigned to the communication reviewer'),
  priorDecisions: z.array(z.string()).describe('Previously rejected findings and maintainer decisions that must not be raised again'),
})

export type SimplificationSweepInput = z.infer<typeof simplificationInputSchema>

const findingProperties = {
  id: { type: 'string' },
  category: { type: 'string', enum: ['code', 'tests', 'architecture', 'communication'] },
  path: { type: 'string' },
  lines: { type: 'string' },
  problem: { type: 'string' },
  evidence: { type: 'string' },
  simplification: { type: 'string' },
  preservedBehavior: { type: 'string' },
  risk: { type: 'string' },
  confidence: { type: 'number' },
} as const

const findingSchema = {
  type: 'object',
  properties: findingProperties,
  required: Object.keys(findingProperties),
  additionalProperties: false,
} as const

const reviewOutputSchema = {
  type: 'object',
  properties: {
    scope: { type: 'string' },
    status: { type: 'string', enum: ['complete', 'recovered', 'incomplete'] },
    limitations: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: findingSchema },
    cleanAreas: { type: 'array', items: { type: 'string' } },
  },
  required: ['scope', 'status', 'limitations', 'findings', 'cleanAreas'],
  additionalProperties: false,
} as const

const findingResultSchema = z.object({
  id: z.string(),
  category: z.enum(['code', 'tests', 'architecture', 'communication']),
  path: z.string(),
  lines: z.string(),
  problem: z.string(),
  evidence: z.string(),
  simplification: z.string(),
  preservedBehavior: z.string(),
  risk: z.string(),
  confidence: z.number(),
})

const reviewResultSchema = z.object({
  scope: z.string(),
  status: z.enum(['complete', 'recovered', 'incomplete']),
  limitations: z.array(z.string()),
  findings: z.array(findingResultSchema),
  cleanAreas: z.array(z.string()),
})

const verdictProperties = {
  id: { type: 'string' },
  verdict: { type: 'string', enum: ['confirmed', 'rejected', 'question'] },
  delivery: { type: 'string', enum: ['pull_request', 'proposal', 'question'] },
  verification: { type: 'string' },
} as const

const verifiedFindingSchema = {
  type: 'object',
  properties: verdictProperties,
  required: Object.keys(verdictProperties),
  additionalProperties: false,
} as const

const verificationOutputSchema = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: verifiedFindingSchema },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
  additionalProperties: false,
} as const

const revisionResultSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/),
})

const revisionOutputSchema = {
  type: 'object',
  properties: {
    revision: { type: 'string', pattern: '^[a-f0-9]{40}$' },
  },
  required: ['revision'],
  additionalProperties: false,
} as const

const verdictResultSchema = z.object({
  id: z.string(),
  verdict: z.enum(['confirmed', 'rejected', 'question']),
  delivery: z.enum(['pull_request', 'proposal', 'question']),
  verification: z.string(),
})

const verificationResultSchema = z.object({
  findings: z.array(verdictResultSchema),
  summary: z.string(),
})

interface ReviewAssignment {
  agent: 'code_simplifier' | 'test_reviewer' | 'architecture_reviewer' | 'communication_reviewer'
  category: 'code' | 'tests' | 'architecture' | 'communication'
  scope: string
}

type FindingResult = z.infer<typeof findingResultSchema>
type ReviewResult = z.infer<typeof reviewResultSchema> & Pick<ReviewAssignment, 'agent' | 'category'>
type VerdictResult = z.infer<typeof verdictResultSchema>
type VerificationResult = z.infer<typeof verificationResultSchema>
type VerifiedFinding = FindingResult & Omit<VerdictResult, 'id'>

/**
 * A subagent turn can settle with prose instead of the requested structured
 * result. Recover the structured result when the prose carries one; otherwise
 * fail the parse.
 */
export function parseStructuredResult<T>(schema: z.ZodType<T>, output: unknown): T {
  if (typeof output === 'string') {
    const start = output.indexOf('{')
    const end = output.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return schema.parse(JSON.parse(output.slice(start, end + 1)))
      } catch {
        // The prose did not carry a valid result; report the original output below.
      }
    }
    throw new Error(`Expected a structured result, received text: ${output.slice(0, 200)}`)
  }

  return schema.parse(output)
}

export function reviewMessage(
  revision: string,
  assignment: ReviewAssignment,
  priorDecisions: readonly string[],
): string {
  return [
    `Review only the assigned ${assignment.category} scope at revision ${revision}.`,
    'The checkout is shared with the parent at /workspace/repo. Resolve every repository-relative path under that directory. Use glob to locate files before reading or grepping an exact path. Do not invent a path, write files, or change Git state.',
    `Assigned scope:\n${assignment.scope}`,
    assignment.category === 'tests'
      ? 'A proposed removal must name the existing test that covers the same behavior and prove the candidate has no distinct failure mode, runtime boundary, regression history, or public contract.'
      : '',
    assignment.category === 'communication'
      ? 'Review external artifacts only from complete excerpts supplied in the scope. A URL identifies an artifact but is not evidence by itself. Do not infer missing or truncated text.'
      : '',
    `Prior decisions that must not be raised again:\n${priorDecisions.length === 0 ? '_None._' : priorDecisions.join('\n')}`,
    'Return status complete when every assigned artifact was reviewed, recovered when a failed lookup was replaced with equivalent complete evidence, or incomplete when any evidence remains missing or truncated. Record every failed or incomplete lookup in limitations. Do not create a finding from incomplete evidence.',
    'Return only findings that reduce code, tests, or prose while preserving intended behavior. Every finding needs an exact path, line range, evidence, the smaller shape, preserved behavior, risk, and confidence from 0 to 1. Taste is not a finding.',
  ].filter(Boolean).join('\n\n')
}

export function revisionMessage(revision: string): string {
  return [
    `Verify that the shared checkout is exactly commit ${revision} before any review starts.`,
    'Call revision_check with this commit. Do not inspect candidates or return from memory. Return only the tool-confirmed revision.',
  ].join('\n\n')
}

export function verificationMessage(
  revision: string,
  reviews: readonly unknown[],
  priorDecisions: readonly string[],
): string {
  return [
    `Try to disprove every candidate finding against revision ${revision}.`,
    'The checkout is shared with the parent at /workspace/repo. Resolve every repository-relative path under that directory and use glob before reading or grepping an exact path. Do not write files or change Git state.',
    'Read the cited files and search for callers, tests, constraints, and counterexamples. Reject taste, behavior changes disguised as cleanup, duplicates, and anything covered by a prior maintainer decision. Reject a test removal unless another cited test covers the same behavior and the candidate adds no distinct failure mode, runtime boundary, regression history, or public contract.',
    'Never confirm a finding based on an incomplete review or incomplete source artifact. Mark it as a question when the missing evidence could change the verdict.',
    `Prior decisions:\n${priorDecisions.length === 0 ? '_None._' : priorDecisions.join('\n')}`,
    `Candidate reviews:\n${JSON.stringify(reviews)}`,
    'Use pull_request only for a mechanical, behavior-preserving change with enough evidence to implement and test without judgement. Use proposal for architectural decisions. Use question when evidence is incomplete.',
    'Return one verdict per candidate id and nothing else. Do not repeat the candidate fields; the workflow keeps them.',
  ].join('\n\n')
}

export function assignFindingIds(reviews: readonly ReviewResult[]): ReviewResult[] {
  const counts = new Map<string, number>()

  return reviews.map(review => ({
    ...review,
    findings: review.findings.map((finding) => {
      const count = (counts.get(review.category) ?? 0) + 1
      counts.set(review.category, count)
      return { ...finding, id: `${review.category}-${count}` }
    }),
  }))
}

export function assembleVerification(
  reviews: readonly ReviewResult[],
  verification: VerificationResult,
): { findings: VerifiedFinding[], summary: string, limitations: string[] } {
  const candidates = reviews.flatMap(review => review.findings)
  const candidatesById = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const verdictsById = new Map<string, VerdictResult>()
  const limitations: string[] = []

  for (const verdict of verification.findings) {
    if (verdictsById.has(verdict.id)) {
      limitations.push(`Duplicate verification result id: ${verdict.id}.`)
      continue
    }
    if (!candidatesById.has(verdict.id)) {
      limitations.push(`Unknown verification result id: ${verdict.id}.`)
      continue
    }
    verdictsById.set(verdict.id, verdict)
  }

  const findings = candidates.map((candidate) => {
    const verdict = verdictsById.get(candidate.id)
    if (!verdict) {
      limitations.push(`Missing verification result id: ${candidate.id}.`)
      return {
        ...candidate,
        verdict: 'question' as const,
        delivery: 'question' as const,
        verification: 'The verifier returned no verdict for this candidate.',
      }
    }

    return { ...candidate, verdict: verdict.verdict, delivery: verdict.delivery, verification: verdict.verification }
  })

  return { findings, summary: verification.summary, limitations }
}

function recordVerificationGap(reviews: ReviewResult[], limitations: readonly string[]) {
  if (limitations.length === 0) return

  const review = reviews.find(candidate => candidate.findings.length > 0) ?? reviews[0]
  if (!review) return

  review.status = 'incomplete'
  review.limitations.push(...limitations)
}

export function summarizeSimplificationSweep(
  reviews: readonly ReviewResult[],
  verification: { findings: readonly VerifiedFinding[] },
) {
  const proposed = reviews.reduce((count, review) => count + review.findings.length, 0)
  const confirmed = verification.findings.filter(finding => finding.verdict === 'confirmed')
  const rejected = verification.findings.filter(finding => finding.verdict === 'rejected')
  const questions = verification.findings.filter(finding => finding.verdict === 'question')
  const incomplete = reviews.some(review => review.status === 'incomplete')
  const recovered = reviews.some(review => review.status === 'recovered')

  return {
    status: incomplete ? 'degraded' : recovered ? 'recovered' : 'complete',
    reviewers: reviews.map(review => ({
      agent: review.agent,
      category: review.category,
      status: review.status,
      limitations: review.limitations,
    })),
    counts: {
      reviewers: reviews.length,
      proposed,
      confirmed: confirmed.length,
      rejected: rejected.length,
      questions: questions.length,
      pullRequestCandidates: confirmed.filter(finding => finding.delivery === 'pull_request').length,
      proposals: confirmed.filter(finding => finding.delivery === 'proposal').length,
    },
  } as const
}

/** Rejects on a failed turn, so each caller's fallback sees the reason. */
async function askAgent(
  ctx: Pick<WorkflowToolContext, 'agent'>,
  name: string,
  message: string,
  outputSchema: AgentSendOptions['outputSchema'],
): Promise<unknown> {
  const response = await ctx.agent(name).send(message, { outputSchema })
  const result = await response.result()
  if (result.status === 'failed') throw new Error(result.error?.message ?? `${name} failed`)
  return result.data ?? result.message
}

export async function runSimplificationSweep(
  input: SimplificationSweepInput,
  ctx: Pick<WorkflowToolContext, 'agent'>,
) {
  'use workflow'

  const checkout = parseStructuredResult(
    revisionResultSchema,
    await askAgent(ctx, 'finding_verifier', revisionMessage(input.revision), revisionOutputSchema),
  )
  if (checkout.revision !== input.revision) {
    throw new Error(`Shared checkout revision ${checkout.revision} does not match requested revision ${input.revision}.`)
  }

  const assignments: ReviewAssignment[] = [
    { agent: 'code_simplifier', category: 'code', scope: input.codeScope },
    { agent: 'test_reviewer', category: 'tests', scope: input.testScope },
    { agent: 'architecture_reviewer', category: 'architecture', scope: input.architectureScope },
    { agent: 'communication_reviewer', category: 'communication', scope: input.communicationScope },
  ]

  const reviews = await Promise.all(
    assignments.map(async (assignment): Promise<ReviewResult> => {
      try {
        const review = parseStructuredResult(
          reviewResultSchema,
          await askAgent(ctx, assignment.agent, reviewMessage(checkout.revision, assignment, input.priorDecisions), reviewOutputSchema),
        )

        return { agent: assignment.agent, category: assignment.category, ...review }
      } catch (error) {
        return {
          agent: assignment.agent,
          category: assignment.category,
          scope: assignment.scope,
          status: 'incomplete',
          limitations: [`Reviewer failed before returning a valid structured result: ${error instanceof Error ? error.message : String(error)}`],
          findings: [],
          cleanAreas: [],
        }
      }
    }),
  )

  const identified = assignFindingIds(reviews)

  let verification: { findings: VerifiedFinding[], summary: string }
  try {
    const verdicts = parseStructuredResult(
      verificationResultSchema,
      await askAgent(ctx, 'finding_verifier', verificationMessage(checkout.revision, identified, input.priorDecisions), verificationOutputSchema),
    )
    const assembled = assembleVerification(identified, verdicts)
    verification = assembled
    recordVerificationGap(identified, assembled.limitations)
  } catch (error) {
    verification = {
      findings: identified.flatMap(review => review.findings).map(finding => ({
        ...finding,
        verdict: 'question' as const,
        delivery: 'question' as const,
        verification: 'Verification did not return a usable result.',
      })),
      summary: 'Verification failed before returning a usable result.',
    }
    recordVerificationGap(identified, [`Verification failed before returning a usable result: ${error instanceof Error ? error.message : String(error)}`])
  }

  return {
    revision: checkout.revision,
    reviews: identified,
    verification,
    ...summarizeSimplificationSweep(identified, verification),
  }
}
