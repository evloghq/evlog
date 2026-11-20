import { connectSlackCredentials } from '@vercel/connect/eve'
import type { SlackInboundMessageContext, SlackMessage, SlackMentionResult } from 'eve/channels/slack'
import { defaultSlackAuth, slackChannel } from 'eve/channels/slack'
import { jobLogger } from '../lib/job'
import { FOLLOWED_THREAD_GUIDANCE, isFullSlackMember, SLACK_CONNECTOR, type SlackRequest } from '../lib/slack'
import { isMaintainer } from '../lib/trust'

/**
 * Fail closed: a lookup Slack cannot answer drops the message. The Slack
 * error code is logged, never the user's profile.
 */
async function admitsMember(request: SlackRequest, userId: string | undefined): Promise<boolean> {
  if (userId === undefined) return false
  try {
    return await isFullSlackMember(request, userId)
  } catch (error) {
    const log = jobLogger('slack.member-check')
    log.error((error as Error).message, { admitted: false })
    log.emit()
    return false
  }
}

/**
 * A valid signature proves Slack sent the event, not who typed it. Every
 * inbound path admits only full members of the one configured workspace:
 * `isMaintainer` checks the principal, and `users.info` turns away guests,
 * deactivated accounts, and Slack Connect users from other workspaces, whom
 * eve names after this workspace. Bots never get a turn.
 */
async function admitMaintainer(ctx: SlackInboundMessageContext, message: SlackMessage): Promise<SlackMentionResult> {
  const auth = defaultSlackAuth(message, ctx)
  if (auth === null || !isMaintainer(auth)) return null
  if (!(await admitsMember(ctx.slack.request, message.author?.userId))) return null
  return { auth }
}

/** A mention or DM is addressed to Evi, so it shows typing at once. */
async function answerAddressed(ctx: SlackInboundMessageContext, message: SlackMessage): Promise<SlackMentionResult> {
  const admitted = await admitMaintainer(ctx, message)
  if (admitted !== null) await ctx.thread.startTyping('Thinking…')
  return admitted
}

export default slackChannel({
  credentials: connectSlackCredentials(SLACK_CONNECTOR),
  // A code channel is one session for one task, and every message in it reaches Evi without a
  // mention. `tools/open_code_channel.ts` moves long work into one.
  codeChannels: true,
  threadContext: { since: 'last-agent-reply' },
  onAppMention: answerAddressed,
  onDirectMessage: answerAddressed,
  // Messages without a mention: every message in a code channel is for Evi, and
  // a reply in a thread Evi already serves (a scheduled run, an earlier mention)
  // reaches the session quietly, so Evi can stay out of a conversation between
  // people with `no_reply`. Mentions are dispatched by `onAppMention`.
  async onMessage(ctx, message) {
    if (ctx.slack.codeChannel) return admitMaintainer(ctx, message)
    if (ctx.isBotMentioned() || !(await ctx.isSubscribed())) return null
    const admitted = await admitMaintainer(ctx, message)
    return admitted && { ...admitted, status: 'deferred', guidance: FOLLOWED_THREAD_GUIDANCE }
  },
  // The same gate for approval and question clicks, so a guest in a thread a member started cannot approve a write.
  async onAnswers(ctx, submission) {
    if (!isMaintainer(ctx.defaultAuth)) return null
    return (await admitsMember(ctx.slack.request, submission.user.id)) ? { auth: ctx.defaultAuth } : null
  },
})
