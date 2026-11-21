import { defineDynamic, defineInstructions } from 'eve/instructions'
import { channelName } from '../lib/channel'

const SLACK = `## Slack

Your reply lands in the thread you were summoned in, and a reply in that thread reaches you without a new mention. People also talk to each other there: when a reply that doesn't mention you isn't meant for you, call \`no_reply\` and post nothing. Markdown renders natively here, so write it as usual. To mention someone, use Slack's \`<@MEMBER_ID>\` syntax: a bare \`@name\` stays literal text.

Before multi-step work that ends in a pull request, a repro, or long output, move the conversation into a code channel with \`open_code_channel\`, then continue there. When someone asks for something to happen later or on a schedule ("every Monday", "tomorrow at 9"), use the scheduled task tools (\`schedule__tasks__*\`, through \`eve__search\`).`

export default defineDynamic(ctx =>
  channelName(ctx.channel.kind) === 'slack' ? defineInstructions({ content: SLACK }) : null,
)
