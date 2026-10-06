import type { GitHubChannelConfig, GitHubInboundContext, GitHubPullRequestEvent } from 'eve/channels/github'
import { githubChannel } from 'eve/channels/github'
import type { Channel } from 'eve/channels'
import type { SlackReceiveTarget } from 'eve/channels/slack'
import { Card, CardText } from 'eve/channels/slack'
import type { SessionAuthContext } from 'eve/context'
import { z } from 'zod'
import { isHomeRepository } from '../repo'
import { EVI_SLACK_TEAM_ID, MAINTAINER_GITHUB_ID, MAINTAINER_GITHUB_LOGIN, pullRequestReviewAuth } from '../trust'
import { repositoryToken } from './credentials'

export const pullRequestSchema = z.object({
  state: z.string(),
  draft: z.boolean(),
  title: z.string(),
  user: z.object({ id: z.number(), login: z.string(), type: z.string() }),
  author_association: z.string(),
  head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  base: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
})

export type ReviewSend = (target: SlackReceiveTarget, message: string, auth: SessionAuthContext) => Promise<unknown>

/** Route-local handoff keeps GitHub signature verification in the native adapter. */
export function reviewGitHubChannel(config: GitHubChannelConfig, slack: Channel<unknown, SlackReceiveTarget>) {
  const channel = githubChannel(config)
  return {
    ...channel,
    routes: channel.routes.map(route => {
      if (route.transport === 'websocket') return route
      return {
        ...route,
        handler(request, args) {
          const bound = githubChannel({
            ...config,
            async onPullRequest(ctx, event) {
              await queuePullRequestReview(ctx, event, (target, message, auth) => args.to(slack, target).send(message, { auth }))
              return null
            },
          })
          const handler = bound.routes.find(candidate => candidate.method === route.method && candidate.path === route.path)
          if (!handler || handler.transport === 'websocket') throw new Error('GitHub webhook route not found.')
          return handler.handler(request, args)
        },
      }
    }),
  } satisfies typeof channel
}

/** Queue a native approval turn without fetching or running contributor code. */
export async function queuePullRequestReview(ctx: GitHubInboundContext, event: GitHubPullRequestEvent, send: ReviewSend): Promise<void> {
  const channelId = process.env.EVI_PR_REVIEW_SLACK_CHANNEL_ID
  if (!channelId) return
  if (!EVI_SLACK_TEAM_ID) throw new Error('EVI_SLACK_TEAM_ID is required for PR review approvals.')
  if (!isHomeRepository(ctx.repository) || !['opened', 'reopened', 'ready_for_review', 'synchronize'].includes(event.action)) return
  const response = await ctx.github.request({ method: 'GET', path: `/repos/${ctx.repository.fullName}/pulls/${event.pullRequestNumber}` })
  const pr = pullRequestSchema.parse(response.body)
  if (pr.state !== 'open' || pr.draft || pr.user.type !== 'User'
    || pr.user.login.toLowerCase() === MAINTAINER_GITHUB_LOGIN || String(pr.user.id) === MAINTAINER_GITHUB_ID
    || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association)) return
  const scope = { owner: ctx.repository.owner, repo: ctx.repository.name, number: event.pullRequestNumber, sha: pr.head.sha }
  const url = `https://github.com/${scope.owner}/${scope.repo}/pull/${scope.number}`
  await send({
    channelId,
    installationTeamId: EVI_SLACK_TEAM_ID,
    initialMessage: {
      card: Card({ title: `Review PR #${scope.number}`, children: [
        CardText(url),
        CardText(`Commit ${scope.sha}. Review, tests and suggestions only. No branch changes.`),
      ] }),
      fallbackText: `Review PR #${scope.number}: ${url}`,
    },
  }, 'Call pr_review__prepare to request approval. Do not inspect or execute contributor code before it succeeds. If declined, stop without any PR action. After approval, load external-pr-review, verify the diff and publish only with pr_review__publish. Never push, merge or approve the PR.', pullRequestReviewAuth(scope))
}

/** Keep GitHub write credentials outside the contributor sandbox. */
export async function reviewGitHubRequest(record: { owner: string, repo: string }, suffix: string, body?: unknown): Promise<unknown> {
  const token = await repositoryToken(record)
  if (token === null) throw new Error('The GitHub App is not installed on the review repository.')
  const response = await fetch(`https://api.github.com/repos/${record.owner}/${record.repo}/${suffix}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`PR review GitHub request failed with status ${response.status}.`)
  return response.json()
}
