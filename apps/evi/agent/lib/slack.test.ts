import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadSlack(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return await import('./slack')
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

describe('scheduleAnchor', () => {
  it('names the run and stamps it in UTC, with a plain-text fallback', async () => {
    const { scheduleAnchor } = await loadSlack({})
    const anchor = scheduleAnchor('Daily digest', new Date('2026-09-03T05:00:12Z'))

    expect(anchor.card.title).toBe('Daily digest')
    expect(anchor.card.subtitle).toBe('Scheduled run, 2026-09-03 05:00 UTC')
    expect(anchor.card.children).toHaveLength(1)
    expect(anchor.fallbackText).toBe('Daily digest: scheduled run, 2026-09-03 05:00 UTC')
  })
})

describe('scheduleTarget', () => {
  it('targets the configured channel and installation with a fresh anchor', async () => {
    const { scheduleTarget } = await loadSlack({ EVI_SLACK_CHANNEL_ID: 'C0123', EVI_SLACK_TEAM_ID: 'T0123' })
    const target = scheduleTarget('Daily digest')

    expect(target.channelId).toBe('C0123')
    expect(target.installationTeamId).toBe('T0123')
    expect(target.initialMessage).toMatchObject({ card: { title: 'Daily digest' } })
    expect(target).not.toHaveProperty('threadTs')
  })

  it('omits the installation when no team is configured', async () => {
    const { scheduleTarget } = await loadSlack({ EVI_SLACK_CHANNEL_ID: 'C0123', EVI_SLACK_TEAM_ID: undefined })
    expect(scheduleTarget('Daily digest')).not.toHaveProperty('installationTeamId')
  })

  it('throws when the channel is missing or empty', async () => {
    for (const channelId of [undefined, '']) {
      const { scheduleTarget } = await loadSlack({ EVI_SLACK_CHANNEL_ID: channelId })
      expect(() => scheduleTarget('Daily digest')).toThrow('EVI_SLACK_CHANNEL_ID')
    }
  })
})
