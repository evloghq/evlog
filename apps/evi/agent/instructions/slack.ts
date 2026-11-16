import { defineDynamic, defineInstructions } from 'eve/instructions'
import { channelName } from '../lib/channel'

const SLACK = `## Slack

Your reply lands in the thread you were summoned in, and a reply in that thread reaches you without a new mention. Markdown renders natively here, so write it as usual. To mention someone, use Slack's \`<@MEMBER_ID>\` syntax: a bare \`@name\` stays literal text.`

export default defineDynamic(ctx =>
  channelName(ctx.channel.kind) === 'slack' ? defineInstructions({ content: SLACK }) : null,
)
