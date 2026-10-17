import { connectSlackCredentials } from '@vercel/connect/eve'
import type { SlackInboundMessageContext, SlackMessage, SlackMentionResult } from 'eve/channels/slack'
import { defaultSlackAuth, slackChannel } from 'eve/channels/slack'
import { isMaintainer } from '../lib/trust'

/**
 * A valid signature proves Slack sent the event, not who typed it. Every
 * inbound path goes through `isMaintainer`, which admits the humans of the
 * one configured workspace and nobody else: bots and Slack Connect guests
 * from another workspace get silence rather than a turn.
 */
async function admitMaintainer(ctx: SlackInboundMessageContext, message: SlackMessage): Promise<SlackMentionResult> {
  const auth = defaultSlackAuth(message, ctx)
  if (auth === null || !isMaintainer(auth)) return null
  if (ctx.slack.channelId === process.env.EVI_PR_REVIEW_SLACK_CHANNEL_ID) return null
  await ctx.thread.startTyping('Thinking…')
  return { auth }
}

export default slackChannel({
  credentials: connectSlackCredentials('slack/evi'),
  threadContext: { since: 'last-agent-reply' },
  onAppMention: admitMaintainer,
  onDirectMessage: admitMaintainer,
  // A reply in a thread Evi already owns (a scheduled run, an earlier
  // mention) continues that session without a new mention. Mentions are
  // dispatched by `onAppMention`; the matching `message` event is dropped here.
  async onMessage(ctx, message) {
    if (ctx.isBotMentioned() || !(await ctx.isSubscribed())) return null
    return admitMaintainer(ctx, message)
  },
  onInputResponse(ctx) {
    return isMaintainer(ctx.defaultAuth) ? { auth: ctx.defaultAuth } : null
  },
})
