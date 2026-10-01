import type { AgentMessageResult, AgentSession, WorkflowToolContext } from 'eve/tools'
import { describe, expect, it, vi } from 'vitest'
import {
  assembleVerification,
  assignFindingIds,
  parseStructuredResult,
  reviewMessage,
  revisionMessage,
  runSimplificationSweep,
  simplificationInputSchema,
  summarizeSimplificationSweep,
  verificationMessage,
} from './workflow'

type Reply = { data: unknown } | { message: string } | { error: string }

/** Each sent message settles with the turn `reply` returns for it. */
function agentSessions(reply: (target: string, message: string) => Reply) {
  const sent: Array<{ target: string, message: string }> = []
  const agent = vi.fn((target: string): AgentSession => ({
    send: <TOutput>(message: string) => {
      sent.push({ target, message })
      const settled = reply(target, message)
      const result: AgentMessageResult = 'error' in settled
        ? { status: 'failed', data: undefined, message: undefined, error: { message: settled.error } }
        : { status: 'waiting', data: undefined, message: undefined, ...settled }
      return Promise.resolve({ result: () => Promise.resolve(result as AgentMessageResult<TOutput>) })
    },
  }))
  return { ctx: { agent } satisfies Pick<WorkflowToolContext, 'agent'>, sent }
}

const replied = (data: unknown): Reply => ({ data })

const finding = {
  id: 'code-1',
  category: 'code' as const,
  path: 'packages/evlog/src/shared/compose.ts',
  lines: '10-14',
  problem: 'Duplicate guard',
  evidence: 'Both callers already validate the value.',
  simplification: 'Remove the duplicate guard.',
  preservedBehavior: 'Invalid values remain rejected by both callers.',
  risk: 'A new caller could bypass validation.',
  confidence: 0.9,
}

const revision = 'a'.repeat(40)

const input = {
  revision,
  codeScope: 'packages/evlog/src/runtime',
  testScope: 'packages/evlog/test/core and packages/evlog/src/runtime',
  architectureScope: 'packages/evlog/src/adapters and packages/evlog/src/shared',
  communicationScope: 'agent/instructions.md and complete excerpt from PR #1',
  priorDecisions: [],
}

const review = {
  agent: 'code_simplifier' as const,
  category: 'code' as const,
  scope: 'shared',
  status: 'complete' as const,
  limitations: [],
  findings: [finding],
  cleanAreas: [],
}

const verifiedFinding = {
  ...finding,
  verdict: 'confirmed' as const,
  delivery: 'pull_request' as const,
  verification: 'No counterexample found.',
}

describe('simplification workflow', () => {
  it('requires separate scopes and a source revision', () => {
    expect(simplificationInputSchema.safeParse(input).success).toBe(true)

    expect(simplificationInputSchema.safeParse({
      revision,
      codeScope: '',
      testScope: '',
      architectureScope: '',
      communicationScope: '',
      priorDecisions: [],
    }).success).toBe(false)
  })

  it('requires a full commit SHA', () => {
    expect(simplificationInputSchema.safeParse({ ...input, revision: 'abcdef0' }).success).toBe(false)
  })

  it('requires the verifier to attest the shared checkout before review', () => {
    const message = revisionMessage(revision)

    expect(message).toContain(revision)
    expect(message).toContain('Call revision_check')
    expect(message).toContain('before any review starts')
  })

  it('keeps each reviewer inside its assigned scope', () => {
    const message = reviewMessage(
      'abcdef0',
      { agent: 'code_simplifier', category: 'code', scope: 'packages/evlog/src/runtime' },
      ['Keep the request lifecycle wrapper.'],
    )

    expect(message).toContain('packages/evlog/src/runtime')
    expect(message).toContain('revision abcdef0')
    expect(message).toContain('/workspace/repo')
    expect(message).toContain('Use glob to locate files')
    expect(message).toContain('must not be raised again')
    expect(message).toContain('Taste is not a finding')
    expect(message).toContain('status complete')
  })

  it('sets a higher evidence bar for removing tests', () => {
    const message = reviewMessage(
      'abcdef0',
      { agent: 'test_reviewer', category: 'tests', scope: 'packages/evlog/test/core' },
      [],
    )

    expect(message).toContain('existing test that covers the same behavior')
    expect(message).toContain('distinct failure mode')
    expect(message).toContain('runtime boundary')
  })

  it('requires complete communication excerpts', () => {
    const message = reviewMessage(
      'abcdef0',
      { agent: 'communication_reviewer', category: 'communication', scope: 'PR #1' },
      [],
    )

    expect(message).toContain('complete excerpts')
    expect(message).toContain('Do not infer missing or truncated text')
    expect(message).toContain('Do not create a finding from incomplete evidence')
  })

  it('gives the verifier candidates, reviewer health, and prior decisions', () => {
    const message = verificationMessage(
      'abcdef0',
      [
        {
          agent: 'communication_reviewer',
          category: 'communication',
          scope: 'PR #1',
          status: 'incomplete',
          limitations: ['Comment body was truncated.'],
          findings: [],
          cleanAreas: [],
        },
      ],
      ['Do not combine framework entrypoints.'],
    )

    expect(message).toContain('Try to disprove every candidate')
    expect(message).toContain('/workspace/repo')
    expect(message).toContain('Do not combine framework entrypoints.')
    expect(message).toContain('pull_request only for a mechanical')
    expect(message).toContain('Reject a test removal unless another cited test covers the same behavior')
    expect(message).toContain('Never confirm a finding based on an incomplete review')
    expect(message).toContain('Return one verdict per candidate id')
    expect(message).toContain('Comment body was truncated.')
  })

  it('derives run status and counts from structured results', () => {
    const summary = summarizeSimplificationSweep(
      [
        {
          agent: 'code_simplifier',
          category: 'code',
          scope: 'shared',
          status: 'recovered',
          limitations: ['Located the toolkit barrel after an invalid path lookup.'],
          findings: [finding],
          cleanAreas: [],
        },
        {
          agent: 'communication_reviewer',
          category: 'communication',
          scope: 'PR #1',
          status: 'complete',
          limitations: [],
          findings: [{ ...finding, id: 'comm-1', category: 'communication' }],
          cleanAreas: [],
        },
      ],
      {
        findings: [
          { ...finding, verdict: 'confirmed', delivery: 'pull_request', verification: 'No counterexample found.' },
          {
            ...finding,
            id: 'comm-1',
            category: 'communication',
            verdict: 'rejected',
            delivery: 'question',
            verification: 'The existing structure is deliberate.',
          },
        ],
      },
    )

    expect(summary.status).toBe('recovered')
    expect(summary.counts).toEqual({
      reviewers: 2,
      proposed: 2,
      confirmed: 1,
      rejected: 1,
      questions: 0,
      pullRequestCandidates: 1,
      proposals: 0,
    })
  })

  it('assigns finding ids in code so reviewers cannot collide', () => {
    const [identified] = assignFindingIds([{ ...review, findings: [{ ...finding, id: 'F1' }, { ...finding, id: 'F1' }] }])

    expect(identified?.findings.map(candidate => candidate.id)).toEqual(['code-1', 'code-2'])
  })

  it('keeps candidate fields and records a gap when a verdict is missing', () => {
    const assembled = assembleVerification([review], {
      findings: [{ id: 'code-2', verdict: 'confirmed', delivery: 'pull_request', verification: 'Invented.' }],
      summary: 'Checked.',
    })

    expect(assembled.findings).toEqual([
      {
        ...finding,
        verdict: 'question',
        delivery: 'question',
        verification: 'The verifier returned no verdict for this candidate.',
      },
    ])
    expect(assembled.limitations).toEqual([
      'Unknown verification result id: code-2.',
      'Missing verification result id: code-1.',
    ])
  })

  it('recovers a structured result embedded in prose', () => {
    const parsed = parseStructuredResult(
      simplificationInputSchema.pick({ revision: true }),
      `The checkout matches.\n{"revision":"${revision}"}`,
    )

    expect(parsed).toEqual({ revision })
  })

  it('rejects prose that carries no structured result', () => {
    expect(() => parseStructuredResult(
      simplificationInputSchema.pick({ revision: true }),
      'No structured result was produced.',
    )).toThrow('Expected a structured result, received text:')
  })

  it('continues with a degraded result when one reviewer fails', async () => {
    const { ctx, sent } = agentSessions((target, message) => {
      if (target === 'finding_verifier' && message.includes('before any review starts'))
        return replied({ revision })

      if (target === 'test_reviewer')
        return { error: 'review failed' }

      if (target === 'finding_verifier') {
        return replied({
          findings: [
            {
              ...finding,
              verdict: 'confirmed',
              delivery: 'pull_request',
              verification: 'No counterexample found.',
            },
          ],
          summary: 'One candidate survived.',
        })
      }

      return replied({
        scope: target,
        status: 'complete',
        limitations: [],
        findings: target === 'code_simplifier' ? [finding] : [],
        cleanAreas: [],
      })
    })

    const result = await runSimplificationSweep(input, ctx)

    expect(result.status).toBe('degraded')
    expect(result.counts).toEqual({
      reviewers: 4,
      proposed: 1,
      confirmed: 1,
      rejected: 0,
      questions: 0,
      pullRequestCandidates: 1,
      proposals: 0,
    })
    expect(result.reviewers).toContainEqual({
      agent: 'test_reviewer',
      category: 'tests',
      status: 'incomplete',
      limitations: ['Reviewer failed before returning a valid structured result: review failed'],
    })
    expect(sent).toHaveLength(6)
    expect(sent[5]?.message).toContain('Reviewer failed before returning a valid structured result: review failed')
  })

  it('degrades instead of failing when verification returns prose', async () => {
    const { ctx } = agentSessions((target, message) => {
      if (target === 'finding_verifier' && message.includes('before any review starts'))
        return replied({ revision })

      if (target === 'finding_verifier')
        return { message: 'Verification complete, but no structured result was produced.' }

      return replied({
        scope: target,
        status: 'complete',
        limitations: [],
        findings: target === 'code_simplifier' ? [{ ...finding, id: 'F1' }] : [],
        cleanAreas: [],
      })
    })

    const result = await runSimplificationSweep(input, ctx)

    expect(result.status).toBe('degraded')
    expect(result.verification.findings).toEqual([
      expect.objectContaining({
        id: 'code-1',
        problem: finding.problem,
        verdict: 'question',
        delivery: 'question',
      }),
    ])
    expect(result.reviewers).toContainEqual(expect.objectContaining({
      agent: 'code_simplifier',
      status: 'incomplete',
      limitations: [expect.stringContaining('Expected a structured result, received text:')],
    }))
  })

  it('stops before dispatching specialists when the checkout revision differs', async () => {
    const checkoutRevision = 'b'.repeat(40)
    const { ctx, sent } = agentSessions(() => replied({ revision: checkoutRevision }))

    await expect(runSimplificationSweep(input, ctx)).rejects.toThrow(
      `Shared checkout revision ${checkoutRevision} does not match requested revision ${revision}.`,
    )
    expect(sent).toHaveLength(1)
  })
})
