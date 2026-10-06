import { beforeEach, expect, it, vi } from 'vitest'
import type { SessionAuthContext } from 'eve/context'
import type { ApprovalContext, ApprovalResponseContext } from 'eve/tools/approval'
import { canAccessAdminTools, canCaptureEvidence, isMaintainer, pullRequestReviewAuth } from '../trust'
import { writePolicy } from './label-approval'
import { reviewState } from './review-state'
import { prepareExternalReview, publishExternalReview, reviewApprovalResponse, reviewExecutionPolicy, reviewScope } from './external-review'

vi.mock('eve/context', () => ({
  defineState: (_name: string, initial: () => unknown) => {
    let value = initial()
    return {
      get: () => value,
      update: (fn: (current: unknown) => unknown) => {
        value = fn(value)
      },
    }
  },
}))

const sha = 'a'.repeat(40)
const auth = pullRequestReviewAuth({ owner: 'evloghq', repo: 'evlog', number: 12, sha })
const pr = {
  state: 'open', draft: false, title: 'Fix a bug',
  user: { id: 999, login: 'contributor', type: 'User' },
  author_association: 'NONE', head: { sha }, base: { sha: 'b'.repeat(40) },
}
const request = vi.fn()
const run = vi.fn()
const ctx = { getSandbox: vi.fn(() => Promise.resolve({ run })) }
const github = { request }

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  reviewState.update(() => ({ prepared: false, publishing: false, url: null }))
  request.mockReset().mockResolvedValue(pr)
  run.mockReset().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  ctx.getSandbox.mockClear()
})

it('keeps review sessions below maintainer and admin authority', () => {
  expect(isMaintainer(auth)).toBe(false)
  expect(canAccessAdminTools(auth)).toBe(false)
  expect(writePolicy(auth)).toMatchObject({ type: 'denied' })
  expect(canCaptureEvidence(auth)).toBe(false)
})

it('refuses execution and publication before approved preparation', async () => {
  expect(reviewExecutionPolicy({ session: { auth: { current: auth } } } as ApprovalContext)).toMatchObject({ type: 'denied' })
  await expect(publishExternalReview(auth, { body: 'Review', comments: [] }, github)).rejects.toThrow('not prepared')
  expect(request).not.toHaveBeenCalled()
  expect(ctx.getSandbox).not.toHaveBeenCalled()
})

it.each(['approve', 'cancel'])('rejects an untrusted %s without changing review state', (decision) => {
  const principal: SessionAuthContext = { authenticator: 'slack-webhook', principalType: 'user', principalId: 'slack:OTHER:U123', attributes: {} }
  expect(reviewApprovalResponse({ response: { principal, decision } } as ApprovalResponseContext)).toMatchObject({ status: 'rejected' })
  expect(reviewState.get().prepared).toBe(false)
})

it('requires a service identity and a home-repository scope', () => {
  expect(() => reviewScope(null)).toThrow('PR review session')
  expect(() => reviewScope({ ...auth, principalType: 'user' })).toThrow('PR review session')
  expect(() => reviewScope(pullRequestReviewAuth({ owner: 'other', repo: 'repo', number: 12, sha }))).toThrow('not allowed')
})

it('fetches the exact approved head and unlocks execution after checkout', async () => {
  await prepareExternalReview(auth, ctx, github)
  expect(run).toHaveBeenCalledOnce()
  expect(run.mock.calls[0]?.[0].command).toContain('refs/pull/12/head')
  expect(run.mock.calls[0]?.[0].command).toContain(`git checkout --detach '${sha}'`)
  expect(reviewExecutionPolicy({ session: { auth: { current: auth } } } as ApprovalContext)).toBe('not-applicable')
  expect(canCaptureEvidence(auth)).toBe(true)
})

it.each([{ head: { sha: 'c'.repeat(40) } }, { state: 'closed' }, { draft: true }])('refuses checkout after PR changes: %j', async (change) => {
  request.mockResolvedValue({ ...pr, ...change })
  await expect(prepareExternalReview(auth, ctx, github)).rejects.toThrow('changed or closed')
  expect(ctx.getSandbox).not.toHaveBeenCalled()
  expect(reviewState.get().prepared).toBe(false)
})

it('keeps execution blocked after a failed checkout', async () => {
  run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'failed' })
  await expect(prepareExternalReview(auth, ctx, github)).rejects.toThrow('checkout failed')
  expect(reviewState.get().prepared).toBe(false)
})

it('publishes only a COMMENT review at the scoped commit and returns its receipt on repetition', async () => {
  reviewState.update(state => ({ ...state, prepared: true }))
  request.mockResolvedValueOnce(pr).mockResolvedValueOnce({ html_url: 'https://github.com/review' })
  const input = { body: 'Verified regression', comments: [{ path: 'src/index.ts', line: 1, side: 'RIGHT' as const, body: '```suggestion\nfixed()\n```' }] }
  expect(await publishExternalReview(auth, input, github)).toEqual({ url: 'https://github.com/review', alreadyPublished: false })
  expect(request.mock.calls[1]).toEqual([expect.objectContaining({ number: 12, sha }), 'pulls/12/reviews', expect.objectContaining({ event: 'COMMENT', commit_id: sha, comments: input.comments })])
  expect(request.mock.calls[1]?.[2].body).toBe(`Verified regression\n\nReviewed commit: \`${sha}\`. Suggestions require a maintainer to apply them.`)
  expect(await publishExternalReview(auth, input, github)).toEqual({ url: 'https://github.com/review', alreadyPublished: true })
  expect(request).toHaveBeenCalledTimes(2)
})

it('refuses publication at a changed head without making a GitHub write', async () => {
  reviewState.update(state => ({ ...state, prepared: true }))
  request.mockResolvedValue({ ...pr, head: { sha: 'c'.repeat(40) } })
  await expect(publishExternalReview(auth, { body: 'Review', comments: [] }, github)).rejects.toThrow('changed or closed')
  expect(request).toHaveBeenCalledOnce()
})

it('refuses another write after an ambiguous publication failure', async () => {
  reviewState.update(state => ({ ...state, prepared: true }))
  request.mockResolvedValueOnce(pr).mockRejectedValueOnce(new Error('network'))
  await expect(publishExternalReview(auth, { body: 'Review', comments: [] }, github)).rejects.toThrow('network')
  await expect(publishExternalReview(auth, { body: 'Review', comments: [] }, github)).rejects.toThrow('already attempted')
  expect(request).toHaveBeenCalledTimes(2)
})
