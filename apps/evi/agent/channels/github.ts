import { defaultGitHubAuth, githubChannel } from 'eve/channels/github'
import type { GitHubChannelState } from 'eve/channels/github'
import { githubCredentials } from '../lib/github/credentials'
import { escalateFailedTriage, isAutonomousTriageState } from '../lib/github/escalate'
import { failureComment } from '../lib/failure'
import { AUTONOMOUS_GITHUB_PRINCIPAL, isAutonomous, MAINTAINER_GITHUB_ID, MAINTAINER_GITHUB_LOGIN } from '../lib/trust'

const botName = 'evlogai'
const mentionPattern = new RegExp(
  `@${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z0-9_-])`,
  'iu',
)

export default githubChannel({
  botName,
  credentials: githubCredentials,
  onComment: (ctx, comment) => {
    if (ctx.sender.login.toLowerCase() !== MAINTAINER_GITHUB_LOGIN) return null
    if (!mentionPattern.test(comment.body)) return null
    return { auth: defaultGitHubAuth(ctx) }
  },
  onIssue: (ctx) => {
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
})

async function escalate(state: GitHubChannelState): Promise<void> {
  if (state.issueNumber === null) return
  try {
    await escalateFailedTriage(state.issueNumber)
  } catch (error) {
    // Never let the escalation turn a triage failure into a failure loop.
    console.error('[evi:github] failed to escalate a failed triage', error)
  }
}
