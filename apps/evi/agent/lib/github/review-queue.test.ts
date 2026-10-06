import { beforeEach, expect, it, vi } from 'vitest'
import type { GitHubInboundContext, GitHubPullRequestEvent } from 'eve/channels/github'
import { queuePullRequestReview } from './review-queue'

vi.mock('../trust', async () => ({
  ...await vi.importActual('../trust'),
  EVI_SLACK_TEAM_ID: 'T123',
}))

const sha = 'a'.repeat(40)
const pr = {
  state: 'open', draft: false, title: 'Fix a bug',
  user: { id: 999, login: 'contributor', type: 'User' },
  author_association: 'NONE', head: { sha }, base: { sha: 'b'.repeat(40) },
}
const request = vi.fn()
const ctx = {
  repository: { owner: 'evloghq', name: 'evlog', fullName: 'evloghq/evlog' },
  github: { request },
} as unknown as GitHubInboundContext
const event = { action: 'opened', pullRequestNumber: 12 } as GitHubPullRequestEvent

beforeEach(() => {
  vi.stubEnv('EVI_PR_REVIEW_SLACK_CHANNEL_ID', 'C123')
  request.mockReset().mockResolvedValue({ body: pr, ok: true, status: 200 })
})

it('reads the GitHub response body and routes a scoped approval task to Slack', async () => {
  const send = vi.fn()
  await queuePullRequestReview(ctx, event, send)
  expect(send).toHaveBeenCalledOnce()
  expect(send.mock.calls[0]?.[0]).toMatchObject({ channelId: 'C123', installationTeamId: 'T123' })
  expect(send.mock.calls[0]?.[2]).toMatchObject({
    authenticator: 'pr-review', principalType: 'service',
    attributes: { number: '12', sha },
  })
})

it.each([
  { draft: true },
  { state: 'closed' },
  { author_association: 'MEMBER' },
  { author_association: 'OWNER' },
  { author_association: 'COLLABORATOR' },
  { user: { id: 999, login: 'HugoRCD', type: 'User' } },
  { user: { id: 999, login: 'evlogai[bot]', type: 'Bot' } },
])('does not queue an ineligible PR: %j', async (change) => {
  request.mockResolvedValue({ body: { ...pr, ...change }, ok: true, status: 200 })
  const send = vi.fn()
  await queuePullRequestReview(ctx, event, send)
  expect(send).not.toHaveBeenCalled()
})

it('does nothing when the review channel is unconfigured', async () => {
  vi.stubEnv('EVI_PR_REVIEW_SLACK_CHANNEL_ID', undefined)
  const send = vi.fn()
  await queuePullRequestReview(ctx, event, send)
  expect(request).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})
