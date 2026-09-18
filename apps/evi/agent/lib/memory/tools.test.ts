import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionAuthContext } from 'eve/context'
import type { MemorySession } from './session'

const openMemorySession = vi.fn()

vi.mock('./session', () => ({
  openMemorySession: (...args: Parameters<typeof import('./session').openMemorySession>) =>
    openMemorySession(...args),
}))

const ENV = { EVI_MEMORY_ENABLED: '1', DATABASE_URL: 'postgres://u:p@localhost/db', MAINTAINER_GITHUB_ID: '4271224', VERCEL_ENV: 'production' }

async function loadMemoryTools(env: Record<string, string> = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries({ ...ENV, ...env })) vi.stubEnv(key, value)
  return await import('../../../agent/tools/memory')
}

function auth(): SessionAuthContext {
  return {
    attributes: {},
    authenticator: 'github',
    principalId: 'github:4271224',
    principalType: 'user',
  } as SessionAuthContext
}

const HUGO = auth()

function resolverCtx() {
  return {
    session: { id: 'sess-1', auth: { current: HUGO } },
    channel: { kind: 'channel:slack' },
    messages: [],
  } as never
}

function toolCtx() {
  return {
    session: { id: 'sess-1', auth: { current: HUGO } },
  } as never
}

function fakeSession(): MemorySession {
  return {
    tenantId: 'evlog',
    personId: 'person-1',
    targets: [
      { tenantId: 'evlog', realm: 'agent', realmKey: '' },
      { tenantId: 'evlog', realm: 'person', realmKey: 'person-1' },
    ],
    store: {
      remember: vi.fn().mockResolvedValue({ id: 'memory-1' }),
      search: vi.fn().mockResolvedValue([]),
      forget: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([]),
    },
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  openMemorySession.mockReset()
})

describe('memory tools resolver', () => {
  it('exposes no tools when memory is unavailable', async () => {
    const mod = await loadMemoryTools({ EVI_MEMORY_ENABLED: '0' })
    const handler = mod.default.events['turn.started']
    if (handler === undefined) throw new Error('turn.started resolver is missing')
    expect(await handler(undefined, resolverCtx())).toBeNull()
  })

  it('reopens the session inside execute from the tool context, not the resolver closure', async () => {
    const mod = await loadMemoryTools()
    const handler = mod.default.events['turn.started']
    if (handler === undefined) throw new Error('turn.started resolver is missing')
    openMemorySession.mockResolvedValue(fakeSession())
    const tools = await handler(undefined, resolverCtx())
    if (tools === null || !('memory__remember' in tools)) throw new Error('resolver returned no memory tools')

    await tools.memory__remember.execute({ text: 'test fact', about: 'person' }, toolCtx())

    expect(openMemorySession).toHaveBeenCalledTimes(2)
    expect(openMemorySession).toHaveBeenLastCalledWith(HUGO)
  })

  it('remembers through the reopened session', async () => {
    const mod = await loadMemoryTools()
    const handler = mod.default.events['turn.started']
    if (handler === undefined) throw new Error('turn.started resolver is missing')
    const session = fakeSession()
    openMemorySession.mockResolvedValue(session)
    const tools = await handler(undefined, resolverCtx())
    if (tools === null || !('memory__remember' in tools)) throw new Error('resolver returned no memory tools')

    const result = await tools.memory__remember.execute({ text: 'Evi ships from the sandbox', about: 'person' }, toolCtx())

    expect(result).toEqual({ success: true, id: 'memory-1', about: 'person' })
    expect(session.store.remember).toHaveBeenCalledWith({
      tenantId: 'evlog',
      realm: 'person',
      realmKey: 'person-1',
      text: 'Evi ships from the sandbox',
      sourceKind: 'stated',
      source: { surface: 'slack', sessionId: 'sess-1', url: null },
      createdBy: 'github:4271224',
    })
  })

  it('searches through the reopened session', async () => {
    const mod = await loadMemoryTools()
    const handler = mod.default.events['turn.started']
    if (handler === undefined) throw new Error('turn.started resolver is missing')
    const session = fakeSession()
    openMemorySession.mockResolvedValue(session)
    ;(session.store.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'memory-1',
        title: null,
        text: 'Evi ships from the sandbox',
        invalidatedAt: null,
        validTo: null,
        updatedAt: new Date('2026-02-01T00:00:00Z'),
        source: { surface: 'slack' },
      },
    ])
    const tools = await handler(undefined, resolverCtx())
    if (tools === null || !('memory__search' in tools)) throw new Error('resolver returned no memory tools')

    const result = await tools.memory__search.execute({ query: 'sandbox', limit: 8 }, toolCtx())

    expect(session.store.search).toHaveBeenCalledWith(session.targets, 'sandbox', 8)
    expect(result).toEqual({
      success: true,
      memories: [{
        id: 'memory-1',
        title: null,
        text: 'Evi ships from the sandbox',
        current: true,
        recordedOn: 'slack',
        updatedAt: '2026-02-01T00:00:00.000Z',
      }],
    })
  })

  it('forgets through the reopened session', async () => {
    const mod = await loadMemoryTools()
    const handler = mod.default.events['turn.started']
    if (handler === undefined) throw new Error('turn.started resolver is missing')
    const session = fakeSession()
    openMemorySession.mockResolvedValue(session)
    const tools = await handler(undefined, resolverCtx())
    if (tools === null || !('memory__forget' in tools)) throw new Error('resolver returned no memory tools')

    const result = await tools.memory__forget.execute({ id: 'memory-1' }, toolCtx())

    expect(result).toEqual({ success: true, forgotten: true })
    expect(session.store.forget).toHaveBeenCalledWith(session.targets, 'memory-1')
  })
})
