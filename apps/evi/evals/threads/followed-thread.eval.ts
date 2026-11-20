import { defineEval, type EveEvalContext } from 'eve/evals'
import { satisfies } from 'eve/evals/expect'
import { FOLLOWED_THREAD_GUIDANCE } from '../../agent/lib/slack'

const BOT_USER_ID = 'U0EVI0001'
const ada = { userId: 'U0ADA0001', displayName: 'Ada' }
const sam = { userId: 'U0SAM0001', displayName: 'Sam' }

/**
 * Evals run over eve's HTTP channel, so this rebuilds the block a Slack message
 * gives the model, with the guidance `channels/slack.ts` adds to a reply in a
 * followed thread that doesn't mention Evi.
 */
function slackMessage(input: { from: typeof ada, text: string, ts: string, mentioned: boolean }): string {
  return [
    '<slack_message>',
    '<sender>',
    'type: user',
    `id: ${input.from.userId}`,
    `display_name: ${input.from.displayName}`,
    '</sender>',
    '<bot>',
    `id: ${BOT_USER_ID}`,
    `mentioned: ${input.mentioned}`,
    '</bot>',
    '<thread>',
    'team_id: T0EVLOG01',
    'channel_id: C0EVLOG01',
    'thread_ts: 1767268800.000100',
    `message_ts: ${input.ts}`,
    '</thread>',
    ...(input.mentioned ? [] : ['<guidance>', FOLLOWED_THREAD_GUIDANCE, '</guidance>']),
    '<content>',
    input.text,
    '</content>',
    '</slack_message>',
  ].join('\n')
}

// Ada brings Evi into a thread with a mention; later replies arrive without one.
async function startThread(t: EveEvalContext) {
  const first = await t.send(slackMessage({
    from: ada,
    text: `<@${BOT_USER_ID}> in evlog, what is a wide event? Two sentences, no need to look anything up.`,
    ts: '1767268800.000100',
    mentioned: true,
  }))
  first.succeeded()
  return first.session
}

export default [
  defineEval({
    description: 'A reply people send each other in a followed Slack thread gets no_reply and no text.',
    tags: ['fast'],
    async test(t) {
      const session = await startThread(t)
      const turn = await session.send(slackMessage({
        from: sam,
        text: `<@${ada.userId}> I can pair with you on the drain refactor after lunch if you want.`,
        ts: '1767268900.000200',
        mentioned: false,
      }))
      turn.succeeded()
      turn.calledTool('no_reply')
      t.check(turn.reply ?? '', satisfies((reply: string) => reply.trim() === '', 'posts no text'))
    },
  }),
  defineEval({
    description: 'A follow-up meant for Evi in a followed Slack thread gets an answer.',
    tags: ['fast'],
    async test(t) {
      const session = await startThread(t)
      const turn = await session.send(slackMessage({
        from: ada,
        text: 'And is that one event per request, or one per log call?',
        ts: '1767268900.000200',
        mentioned: false,
      }))
      turn.succeeded()
      turn.notCalledTool('no_reply')
      t.judge('The response answers the follow-up directly: evlog emits one event per request or unit of work, not one per log call.', { on: turn.reply }).gate(0.7)
    },
  }),
]
