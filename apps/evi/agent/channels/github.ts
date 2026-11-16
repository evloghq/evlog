import { githubChannel } from '@github-tools/eve-extension/channels'
import { defaultGitHubAuth } from 'eve/channels/github'
import type { GitHubChannelState } from 'eve/channels/github'
import { githubCredentials } from '../lib/github/credentials'
import { escalateFailedTriageQuietly, isAutonomousTriageState } from '../lib/github/escalate'
import { failureComment } from '../lib/failure'
import { isHomeRepository, repositoryOf } from '../lib/repo'
import { AUTONOMOUS_GITHUB_PRINCIPAL, isAutonomous, MAINTAINER_GITHUB_ID } from '../lib/trust'

const botName = 'evlogai'

export default githubChannel({
  botName,
  credentials: githubCredentials,
  // A mention from anyone below Maintain on the thread's repository starts nothing.
  respondTo: 'maintainers',
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
    async 'turn.settled'(event, ctx) {
      if (event.data.outcome !== 'failed') return
      if (isAutonomous(ctx.session.auth.current)) {
        await escalate(ctx.channel.state)
        return
      }
      await ctx.channel.thread.post(
        failureComment('I hit an error while handling this', 'Mention me again in this thread to retry.', event.data.error ?? {}),
      )
    },
    async 'session.ended'(event, ctx) {
      if (event.data.outcome !== 'failed') return
      if (isAutonomousTriageState(ctx.channel.state)) {
        await escalate(ctx.channel.state)
        return
      }
      await ctx.channel.thread.post(
        failureComment('This session could not recover from an error', 'Send a new mention in this thread to retry.', event.data.error ?? {}),
      )
    },
  },
})

async function escalate(state: GitHubChannelState): Promise<void> {
  if (state.issueNumber === null) return
  await escalateFailedTriageQuietly(repositoryOf(state), state.issueNumber)
}
