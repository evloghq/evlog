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

type Reply = Record<string, unknown> & { ok: boolean }

/** A Slack Web API stand-in answering each method from `replies`, recording every call. */
function slackStub(replies: Record<string, Reply | Reply[]>) {
  const calls: Array<{ operation: string, body: Record<string, unknown> }> = []
  const request = (operation: string, body: Record<string, unknown>) => {
    calls.push({ operation, body })
    const reply = replies[operation]
    if (reply === undefined) return Promise.reject(new Error(`unexpected Slack call ${operation}`))
    return Promise.resolve(Array.isArray(reply) ? reply.shift()! : reply)
  }
  return { request, calls }
}

const fullMember = { team_id: 'T0HOME', deleted: false, is_bot: false, is_restricted: false, is_ultra_restricted: false }

describe('isFullSlackMember', () => {
  it('admits an active member of the home workspace', async () => {
    const { isFullSlackMember } = await loadSlack({ EVI_SLACK_TEAM_ID: 'T0HOME' })
    const { request } = slackStub({ 'users.info': { ok: true, user: fullMember } })
    expect(await isFullSlackMember(request, 'U0ADA')).toBe(true)
  })

  it.each([
    ['a Slack Connect user from another workspace', { ...fullMember, team_id: 'T0OTHER' }],
    ['a multi-channel guest', { ...fullMember, is_restricted: true }],
    ['a single-channel guest', { ...fullMember, is_ultra_restricted: true }],
    ['a deactivated account', { ...fullMember, deleted: true }],
    ['a bot user', { ...fullMember, is_bot: true }],
  ])('refuses %s', async (_label, user) => {
    const { isFullSlackMember } = await loadSlack({ EVI_SLACK_TEAM_ID: 'T0HOME' })
    const { request } = slackStub({ 'users.info': { ok: true, user } })
    expect(await isFullSlackMember(request, 'U0X')).toBe(false)
  })

  it('refuses everyone when no home workspace is configured', async () => {
    const { isFullSlackMember } = await loadSlack({ EVI_SLACK_TEAM_ID: undefined })
    const { request } = slackStub({ 'users.info': { ok: true, user: fullMember } })
    expect(await isFullSlackMember(request, 'U0ADA')).toBe(false)
  })

  it('throws on a Slack error and asks again next time, so an outage is never cached as a refusal', async () => {
    const { isFullSlackMember } = await loadSlack({ EVI_SLACK_TEAM_ID: 'T0HOME' })
    const { request, calls } = slackStub({
      'users.info': [{ ok: false, error: 'missing_scope' }, { ok: true, user: fullMember }],
    })
    await expect(isFullSlackMember(request, 'U0ADA')).rejects.toThrow('missing_scope')
    expect(await isFullSlackMember(request, 'U0ADA')).toBe(true)
    expect(calls).toHaveLength(2)
  })
})

describe('canReachSlackChannel', () => {
  it('lets anyone reach a public channel without listing its members', async () => {
    const { canReachSlackChannel } = await loadSlack({})
    const { request, calls } = slackStub({ 'conversations.info': { ok: true, channel: { is_private: false } } })
    expect(await canReachSlackChannel(request, 'C0PUB', 'U0ADA')).toBe(true)
    expect(calls.map(call => call.operation)).toEqual(['conversations.info'])
  })

  it('finds a private channel member on a later page and refuses someone who left', async () => {
    const { canReachSlackChannel } = await loadSlack({})
    const pages = () => [
      { ok: true, members: ['U0BOB'], response_metadata: { next_cursor: 'next' } },
      { ok: true, members: ['U0ADA'], response_metadata: { next_cursor: '' } },
    ]
    const info = { ok: true, channel: { is_private: true } }
    const present = slackStub({ 'conversations.info': info, 'conversations.members': pages() })
    expect(await canReachSlackChannel(present.request, 'G0PRIV', 'U0ADA')).toBe(true)
    expect(present.calls[2]!.body.cursor).toBe('next')
    const gone = slackStub({ 'conversations.info': info, 'conversations.members': pages() })
    expect(await canReachSlackChannel(gone.request, 'G0PRIV', 'U0EVE')).toBe(false)
  })

  it('denies a deleted channel and throws on any other error', async () => {
    const { canReachSlackChannel } = await loadSlack({})
    const missing = slackStub({ 'conversations.info': { ok: false, error: 'channel_not_found' } })
    expect(await canReachSlackChannel(missing.request, 'C0GONE', 'U0ADA')).toBe(false)
    const outage = slackStub({ 'conversations.info': { ok: false, error: 'ratelimited' } })
    await expect(canReachSlackChannel(outage.request, 'C0X', 'U0ADA')).rejects.toThrow('ratelimited')
  })
})
