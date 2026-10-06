import { defaultGitHubAuth } from 'eve/channels/github'
import type { GitHubChannelState } from 'eve/channels/github'
import { reviewGitHubChannel } from '../lib/github/review-queue'
import { githubCredentials } from '../lib/github/credentials'
import { escalateFailedTriageQuietly, isAutonomousTriageState } from '../lib/github/escalate'
import { failureComment } from '../lib/failure'
import { isHomeRepository, repositoryOf } from '../lib/repo'
import { AUTONOMOUS_GITHUB_PRINCIPAL, isAutonomous, MAINTAINER_GITHUB_ID, MAINTAINER_GITHUB_LOGIN } from '../lib/trust'
import slack from './slack'

const botName = 'evlogai'
const mentionPattern = new RegExp(
  `@${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z0-9_-])`,
  'iu',
)

export default reviewGitHubChannel({
  botName,
  credentials: githubCredentials,
  onComment: (ctx, comment) => {
    if (ctx.sender.login.toLowerCase() !== MAINTAINER_GITHUB_LOGIN) return null
    if (!mentionPattern.test(comment.body)) return null
    return { auth: defaultGitHubAuth(ctx) }
  },
  onIssue: (ctx) => {
    // Unattended triage is a service to one community; an App installation elsewhere grants nothing by itself.
    if (!isHomeRepository(ctx.repository)) return null
    const login = ctx.sender.login.toLowerCase()
    // Community only: never the maintainer, never a bot (including our own loop).
    if (login === botName || login.endsWith('[bot]')) return null
    if (String(ctx.sender.id) === MAINTAINER_GITHUB_ID) return null
    // Unattended turn: the session runs as the bot, never as the issue opener.
    const auth = defaultGitHubAuth(ctx)
    return {
      auth: {
        ...auth,
        principalId: AUTONOMOUS_GITHUB_PRINCIPAL,
        principalType: 'service',
      },
    }
  },
  events: {
    // Autonomous triage failures escalate silently (label + assign); only
    // interactive failures post an error comment.
    async 'turn.failed'(event, channel, ctx) {
      if (isAutonomous(ctx.session.auth.current)) {
        await escalate(channel.state)
        return
      }
      await channel.thread.post(
        failureComment('I hit an error while handling this', 'Mention me again in this thread to retry.', event),
      )
    },
    async 'session.failed'(event, channel) {
      if (isAutonomousTriageState(channel.state)) {
        await escalate(channel.state)
        return
      }
      await channel.thread.post(
        failureComment('This session could not recover from an error', 'Send a new mention in this thread to retry.', event),
      )
    },
  },
}, slack)

async function escalate(state: GitHubChannelState): Promise<void> {
  if (state.issueNumber === null) return
  await escalateFailedTriageQuietly(repositoryOf(state), state.issueNumber)
}
