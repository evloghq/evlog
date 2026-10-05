import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitHubActionsTelemetry } from '../src/github-actions'
import { disableTelemetry, enableTelemetry, _resetActiveTelemetryForTests } from '../src/create'
import type { RunEvent } from '../src/types'

const TOOL = 'github-actions-test'

describe('createGitHubActionsTelemetry', () => {
  let directory: string
  let events: RunEvent[]

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'evlog-gha-test-'))
    events = []
    vi.stubEnv('XDG_CONFIG_HOME', directory)
    vi.stubEnv('DO_NOT_TRACK', '0')
    vi.stubEnv('EVLOG_TELEMETRY', '1')
    vi.stubEnv('EVLOG_TELEMETRY_ENDPOINT', 'https://telemetry.test/ingest')
    vi.stubEnv('GITHUB_ACTION', 'test-action')
    vi.stubEnv('GITHUB_EVENT_NAME', 'push')
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      events.push(...JSON.parse(String(init.body)).events)
      return Promise.resolve(new Response(null, { status: 204 }))
    }))
  })

  afterEach(async () => {
    _resetActiveTelemetryForTests()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })

  it('exposes the full handle and records custom fields with action metadata', async () => {
    const handle = createGitHubActionsTelemetry({ name: TOOL, version: '1.0.0' })
    expect(handle.enabled).toBe(true)
    expect(typeof handle.set).toBe('function')
    expect(typeof handle.flush).toBe('function')
    await handle.flush()
    const value = await handle.run('map', () => {
      handle.set({ routes: 3 })
      return 42
    })
    await handle.flush()
    expect(value).toBe(42)
    expect(events).toHaveLength(1)
    expect(events[0]?.custom).toEqual({ routes: 3, ghaAction: 'test-action', ghaEvent: 'push' })
  })

  it('reflects consent changes through the enabled getter', async () => {
    const handle = createGitHubActionsTelemetry({ name: TOOL, version: '1.0.0' })
    await disableTelemetry(TOOL)
    expect(handle.enabled).toBe(false)
    await enableTelemetry(TOOL)
    expect(handle.enabled).toBe(true)
  })

  it.each([{ DO_NOT_TRACK: '1' }, { EVLOG_TELEMETRY: '0' }])('runs work without delivery when opted out with %j', async (env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    const handle = createGitHubActionsTelemetry({ name: TOOL, version: '1.0.0' })
    expect(handle.enabled).toBe(false)
    expect(await handle.run('map', () => 42)).toBe(42)
    await handle.flush()
    expect(fetch).not.toHaveBeenCalled()
  })
})
