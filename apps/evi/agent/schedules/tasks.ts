import { byPrincipal, defineDynamicSchedules } from 'eve/experimental/schedules'
import { z } from 'zod'
import slack from '../channels/slack'
import { channelName } from '../lib/channel'
import { canReachSlackChannel, isFullSlackMember, scheduleAnchor, slackApi } from '../lib/slack'
import { isMaintainer, SCHEDULED_TASK_ATTRIBUTE } from '../lib/trust'

interface TaskPayload {
  task: string
  teamId: string
  userId: string
  channelId: string
  /** Set when each run replies in the thread the schedule was created in. */
  threadTs?: string
}

function attribute(attributes: Readonly<Record<string, unknown>> | undefined, key: string) {
  const value = attributes?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Schedules a maintainer creates by asking in Slack ("every Monday at 9, list
 * the open PRs waiting on review here"). Each run starts a new session in the
 * conversation the schedule was created in, as its creator, stamped as a
 * scheduled task: it reads and reports, and every write is denied
 * (`lib/github/label-approval.ts`). The fixed workflows stay in the other
 * files here.
 */
export default defineDynamicSchedules({
  description:
    'Scheduled tasks and reminders that run later and post in the Slack conversation where they were created. '
    + 'Use the person\'s time zone for single and cron timing, and ask for it when you don\'t know it. '
    + 'Write the task as a complete request to your future self: nobody is present when it runs, and a run can read and report but not write to GitHub, Linear or Vercel.',
  // Discovered through `eve__search`: only Slack sessions can use them, and `scope` denies them elsewhere.
  tool: 'deferred',
  inputSchema: z.object({
    task: z.string().min(1).max(4000).describe('What to do each time the schedule runs.'),
    reply: z.enum(['new_thread', 'this_thread']).default('new_thread')
      .describe('Post each run as a new thread in this conversation, or reply in the current thread.'),
  }).strict(),
  // Each person manages only their own schedules, and only from Slack, where the channel admitted them.
  scope(ctx) {
    const auth = ctx.session.auth.current
    if (channelName(ctx.channel.kind) !== 'slack' || !isMaintainer(auth)) return null
    return byPrincipal(ctx)
  },
  // The destination and creator come from the Slack session, never from the
  // model, so a schedule only posts where its creator asked for it.
  preparePayload(input, { session }): TaskPayload {
    if (session.schedule) throw new Error('Scheduled runs can\'t create or replace schedules.')
    const auth = session.auth.current
    const teamId = auth?.issuer?.startsWith('slack:') ? auth.issuer.slice('slack:'.length) : undefined
    const userId = attribute(auth?.attributes, 'user_id')
    const channelId = attribute(auth?.attributes, 'channel_id')
    const threadTs = attribute(auth?.attributes, 'thread_ts')
    if (auth?.principalType !== 'user' || !teamId || !userId || !channelId) {
      throw new Error('Schedules can only be created from a Slack message.')
    }
    const payload: TaskPayload = { task: input.task, teamId, userId, channelId }
    if (input.reply === 'this_thread' && threadTs) payload.threadTs = threadTs
    return payload
  },
  // Before every run: the same person, still a full member, still able to read
  // the conversation. A permanent denial disables the schedule; a failed lookup
  // throws, so the provider retries.
  async auth({ principal, payload, schedule }) {
    if (principal.principalId !== `slack:${payload.teamId}:${payload.userId}`) return null
    if (!(await isFullSlackMember(slackApi, payload.userId)) || !(await canReachSlackChannel(slackApi, payload.channelId, payload.userId))) {
      await schedule.disable()
      return null
    }
    return {
      attributes: {
        author_type: 'user',
        channel_id: payload.channelId,
        user_id: payload.userId,
        [SCHEDULED_TASK_ATTRIBUTE]: 'true',
      },
    }
  },
  async run({ payload, occurrence, to }) {
    const label = occurrence.displayName ?? occurrence.name
    await to(slack, {
      channelId: payload.channelId,
      installationTeamId: payload.teamId,
      ...(payload.threadTs ? { threadTs: payload.threadTs } : { initialMessage: scheduleAnchor(label) }),
    }).send(
      [
        `Run this scheduled task for <@${payload.userId}> now and post the result.`,
        'If the task says to stay quiet when there is nothing to report and there isn\'t, call `no_reply` instead.',
        'Nobody is present to answer questions or approve actions. If you can\'t finish, say what is missing.',
        `Schedule: ${label}`,
        `Scheduled for: ${occurrence.scheduledAt}`,
        `Task: ${payload.task}`,
      ].join('\n'),
      // Provider retries reuse the key, so a retried run reaches the same thread.
      { idempotencyKey: `${occurrence.executionId}:run` },
    )
  },
})
