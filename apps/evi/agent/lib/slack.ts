import type { SlackInitialMessage, SlackReceiveTarget } from 'eve/channels/slack'
import { Card, CardText } from 'eve/channels/slack'
import { eviErrors } from './errors'
import { EVI_SLACK_TEAM_ID } from './trust'

/** The Slack channel every scheduled run posts into. */
export const { EVI_SLACK_CHANNEL_ID } = process.env

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
