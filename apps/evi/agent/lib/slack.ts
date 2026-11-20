import { getToken } from '@vercel/connect'
import type { SlackApiResponse, SlackInitialMessage, SlackReceiveTarget } from 'eve/channels/slack'
import { callSlackApi, Card, CardText } from 'eve/channels/slack'
import { eviErrors } from './errors'
import { EVI_SLACK_TEAM_ID } from './trust'

/** The Connect connector behind the Slack channel. */
export const SLACK_CONNECTOR = 'slack/evi'

/** The Slack channel every scheduled run posts into. */
export const { EVI_SLACK_CHANNEL_ID } = process.env

/** How the model treats a reply in a followed thread that doesn't mention Evi. The eval in `evals/threads/` sends the same block. */
export const FOLLOWED_THREAD_GUIDANCE
  = 'You are part of this Slack thread, so you see replies people send each other. This reply '
    + 'doesn\'t mention you. Answer only if it\'s meant for you or you can clearly help; otherwise '
    + 'call `no_reply`.'

/** A Slack Web API call: `ctx.slack.request` inside a channel hook, {@link slackApi} outside one. */
export type SlackRequest = (operation: string, body: Record<string, unknown>) => Promise<SlackApiResponse>

/** Calls the Slack Web API with the connector's bot token, for code that runs outside a channel hook. */
export const slackApi: SlackRequest = (operation, body) =>
  callSlackApi({ botToken: () => getToken(SLACK_CONNECTOR, { subject: { type: 'app' } }), operation, body })

interface SlackUser {
  deleted?: boolean
  is_bot?: boolean
  is_restricted?: boolean
  is_ultra_restricted?: boolean
  team_id?: string
}

const MEMBER_TTL_MS = 10 * 60 * 1000
const members = new Map<string, { member: boolean, expiresAt: number }>()

/** Tests only. */
export function resetSlackMemberCache() {
  members.clear()
}

/**
 * Whether a Slack user is a full member of `EVI_SLACK_TEAM_ID`: active, human,
 * not a guest, and from that workspace. eve names a Slack Connect user after
 * the workspace the app is installed in, so the principal alone cannot tell
 * them apart; `users.info` reports their own team. Throws when Slack cannot
 * answer, and only answers are cached, so an outage never reads as a verdict.
 */
export async function isFullSlackMember(request: SlackRequest, userId: string): Promise<boolean> {
  const cached = members.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.member

  const response = await request('users.info', { user: userId })
  let member: boolean
  if (response.ok) {
    const { user } = response as { user?: SlackUser }
    member = user !== undefined
      && EVI_SLACK_TEAM_ID !== undefined
      && user.team_id === EVI_SLACK_TEAM_ID
      && user.deleted !== true
      && user.is_bot !== true
      && user.is_restricted !== true
      && user.is_ultra_restricted !== true
  } else if (response.error === 'user_not_found') {
    member = false
  } else {
    throw eviErrors.SLACK_REQUEST_FAILED({ operation: 'users.info', slackError: response.error ?? 'unknown_error' })
  }
  members.set(userId, { member, expiresAt: Date.now() + MEMBER_TTL_MS })
  return member
}

const MEMBER_PAGES = 10

interface ConversationInfo {
  is_private?: boolean
  is_im?: boolean
  is_mpim?: boolean
}

/**
 * Whether `userId` can still read `channelId`. Any member reads a public
 * channel and a DM with the app is theirs, so only private channels and group
 * DMs need a membership check: without it, someone removed from a private
 * channel would keep posting there through Evi. A missing channel is a denial;
 * any other Slack error throws. A channel too large to page through fails closed.
 */
export async function canReachSlackChannel(request: SlackRequest, channelId: string, userId: string): Promise<boolean> {
  const info = await request('conversations.info', { channel: channelId })
  if (!info.ok) {
    if (info.error === 'channel_not_found') return false
    throw eviErrors.SLACK_REQUEST_FAILED({ operation: 'conversations.info', slackError: info.error ?? 'unknown_error' })
  }
  const { channel } = info as { channel?: ConversationInfo }
  if (channel === undefined) return false
  if (channel.is_im || (!channel.is_private && !channel.is_mpim)) return true

  let cursor: string | undefined
  for (let page = 0; page < MEMBER_PAGES; page++) {
    const response = await request('conversations.members', { channel: channelId, limit: 1000, ...(cursor ? { cursor } : {}) })
    if (!response.ok) {
      if (response.error === 'channel_not_found') return false
      throw eviErrors.SLACK_REQUEST_FAILED({ operation: 'conversations.members', slackError: response.error ?? 'unknown_error' })
    }
    const { members: ids, response_metadata: meta } = response as { members?: string[], response_metadata?: { next_cursor?: string } }
    if (ids?.includes(userId)) return true
    cursor = meta?.next_cursor || undefined
    if (!cursor) return false
  }
  return false
}

/**
 * The message a scheduled run posts before the agent starts. It becomes the
 * thread root, so every run gets its own thread and its own session, and the
 * channel view reads as one card per run.
 */
export function scheduleAnchor(label: string, now = new Date()) {
  const stamp = `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  return {
    card: Card({
      title: label,
      subtitle: `Scheduled run, ${stamp}`,
      children: [CardText('Running now. The result follows in this thread.', { style: 'muted' })],
    }),
    fallbackText: `${label}: scheduled run, ${stamp}`,
  } satisfies SlackInitialMessage
}

/** Where a scheduled run lands. Throws when the channel is not configured, so a misconfigured deploy fails at cron time rather than posting nowhere. */
export function scheduleTarget(label: string): SlackReceiveTarget {
  if (!EVI_SLACK_CHANNEL_ID) throw eviErrors.SLACK_CHANNEL_NOT_CONFIGURED()
  return {
    channelId: EVI_SLACK_CHANNEL_ID,
    ...(EVI_SLACK_TEAM_ID ? { installationTeamId: EVI_SLACK_TEAM_ID } : {}),
    initialMessage: scheduleAnchor(label),
  }
}
