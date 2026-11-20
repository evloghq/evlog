import { openCodeChannel } from 'eve/channels/slack'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import slack from '../channels/slack'
import { channelName } from '../lib/channel'
import { isMaintainer } from '../lib/trust'

// Slack only, for the people the channel admits: a code channel holds one coding task, as one session.
export default defineDynamic((ctx) => {
  if (channelName(ctx.channel.kind) !== 'slack' || !isMaintainer(ctx.session.auth.current)) return null
  return defineTool({
    description: [
      'Move this Slack conversation into a new Slack code channel before multi-step work: a fix or feature that ends in a pull request, a repro, or an investigation with long output.',
      'Answer in place when one message answers the request. Call it once per request; Slack links the new channel here and invites the person who asked, so afterward reply here in one short sentence at most and continue the work in the channel.',
      'If it returns unavailable, such as when this already is a code channel, continue here and quote the reason. Don\'t call it again for the same request unless the person asks you to try again.',
    ].join(' '),
    inputSchema: z.object({
      message: z.string().describe('The task and where to start. The channel sees the conversation so far.'),
      name: z.string().max(80).describe('A short channel title, such as `Fix the sentry drain flush`.'),
    }),
    async execute({ message, name }, toolCtx) {
      return await openCodeChannel(toolCtx, slack, message, { name })
    },
  })
})
