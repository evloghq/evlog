import type { SessionAuthContext } from 'eve/context'
import type { ToolContext } from 'eve/tools'
import type { ApprovalContext, ApprovalResponseContext, ApprovalStatus } from 'eve/tools/approval'
import { z } from 'zod'
import { cloneUrl, homeRepository, isHomeRepository } from '../repo'
import { isMaintainer, isPullRequestReview } from '../trust'
import { REPO_DIR, runOutput } from '../workspace'
import { pullRequestSchema, reviewGitHubRequest } from './review-queue'
import { reviewState } from './review-state'

const scopeSchema = z.object({
  owner: z.string(), repo: z.string(),
  number: z.coerce.number().int().positive(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
})
export type ReviewScope = z.infer<typeof scopeSchema>

export const reviewInputSchema = z.object({
  body: z.string().min(1).max(50_000),
  comments: z.array(z.object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    side: z.enum(['LEFT', 'RIGHT']),
    start_line: z.number().int().positive().optional(),
    start_side: z.enum(['LEFT', 'RIGHT']).optional(),
    body: z.string().min(1).max(10_000),
  })).max(50),
})
export type ReviewInput = z.infer<typeof reviewInputSchema>

/** Resolve the scope minted by the verified GitHub webhook, never model input. */
export function reviewScope(auth: SessionAuthContext | null): ReviewScope {
  if (!isPullRequestReview(auth) || auth === null) throw new Error('This tool requires a PR review session.')
  const scope = scopeSchema.parse(auth.attributes)
  if (!isHomeRepository({ owner: scope.owner, name: scope.repo })) throw new Error('PR review repository is not allowed.')
  return scope
}

/** Native approval owns the pending request and authenticates both decisions. */
export function reviewApprovalResponse({ response }: ApprovalResponseContext) {
  return isMaintainer(response.principal)
    ? { status: 'allowed' as const }
    : { status: 'rejected' as const, reason: 'Only a trusted maintainer may decide this review.' }
}

/** Contributor code cannot run until the approved checkout has completed. */
export function reviewExecutionPolicy({ session }: ApprovalContext): ApprovalStatus {
  if (!isPullRequestReview(session.auth.current)) return 'not-applicable'
  return reviewState.get().prepared ? 'not-applicable' : { type: 'denied', reason: 'Approve and prepare the PR before running contributor code.' }
}

export interface ReviewApi {
  request(record: ReviewScope, suffix: string, body?: unknown): Promise<unknown>
}
const api: ReviewApi = { request: reviewGitHubRequest }

async function currentPullRequest(scope: ReviewScope, github: ReviewApi) {
  const pr = pullRequestSchema.parse(await github.request(scope, `pulls/${scope.number}`))
  if (pr.state !== 'open' || pr.draft || pr.head.sha !== scope.sha) throw new Error('The PR changed or closed. A new head commit needs a new approval.')
  return pr
}

/** Run only behind native approval and fetch exactly its server-held head. */
export async function prepareExternalReview(auth: SessionAuthContext | null, ctx: { getSandbox(): Promise<Pick<Awaited<ReturnType<ToolContext['getSandbox']>>, 'run'>> }, github: ReviewApi = api) {
  const scope = reviewScope(auth)
  const pr = await currentPullRequest(scope, github)
  const sandbox = await ctx.getSandbox()
  const checkout = await sandbox.run({
    command: `cd ${REPO_DIR} && git fetch ${cloneUrl(homeRepository())} refs/pull/${scope.number}/head && test "$(git rev-parse FETCH_HEAD)" = '${scope.sha}' && git checkout --detach '${scope.sha}'`,
  })
  if (checkout.exitCode !== 0) throw new Error(`Approved PR checkout failed: ${runOutput(checkout)}`)
  reviewState.update(state => ({ ...state, prepared: true }))
  return { repository: `${scope.owner}/${scope.repo}`, number: scope.number, revision: scope.sha, baseRevision: pr.base.sha, path: REPO_DIR }
}

/** Publish a COMMENT review at the approved head, with no branch mutation. */
export async function publishExternalReview(auth: SessionAuthContext | null, input: ReviewInput, github: ReviewApi = api) {
  const scope = reviewScope(auth)
  const state = reviewState.get()
  if (state.url !== null) return { url: state.url, alreadyPublished: true }
  if (!state.prepared || state.publishing) throw new Error('Review is not prepared or publication was already attempted. Check GitHub before retrying.')
  await currentPullRequest(scope, github)
  if (reviewState.get().publishing) throw new Error('Review publication was already attempted. Check GitHub before retrying.')
  reviewState.update(current => ({ ...current, publishing: true }))
  const result = z.object({ html_url: z.string() }).parse(await github.request(scope, `pulls/${scope.number}/reviews`, {
    commit_id: scope.sha, event: 'COMMENT',
    body: `${input.body}\n\nReviewed commit: \`${scope.sha}\`. Suggestions require a maintainer to apply them.`,
    comments: input.comments,
  }))
  reviewState.update(current => ({ ...current, url: result.html_url }))
  return { url: result.html_url, alreadyPublished: false }
}
