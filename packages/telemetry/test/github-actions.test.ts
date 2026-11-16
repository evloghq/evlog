import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitHubActionsTelemetry } from '../src/github-actions'
import { disableTelemetry, enableTelemetry, _resetActiveTelemetryForTests } from '../src/create'
import type { RunEvent } from '../src/types'
import { closeServers, ingest } from './helpers/server'

const TOOL = 'github-actions-test'

describe('createGitHubActionsTelemetry', () => {
  let directory: string
  let server: Awaited<ReturnType<typeof ingest>>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'evlog-gha-test-'))
    vi.stubEnv('XDG_CONFIG_HOME', directory)
    vi.stubEnv('DO_NOT_TRACK', '0')
    vi.stubEnv('EVLOG_TELEMETRY', '1')
    server = await ingest()
    vi.stubEnv('EVLOG_TELEMETRY_ENDPOINT', server.url)
    vi.stubEnv('GITHUB_ACTION', 'test-action')
    vi.stubEnv('GITHUB_EVENT_NAME', 'push')
  })

  function received(): RunEvent[] {
    return server.bodies.flatMap(body => (JSON.parse(body) as { events: RunEvent[] }).events)
  }

  afterEach(async () => {
    _resetActiveTelemetryForTests()
    await closeServers()
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
    expect(received()).toHaveLength(1)
    expect(received()[0]?.custom).toEqual({ routes: 3, ghaAction: 'test-action', ghaEvent: 'push' })
  })

  it('POSTs after each run without waiting for the coalescing window', async () => {
    const handle = createGitHubActionsTelemetry({ name: TOOL, version: '1.0.0', flushIntervalMs: 60 * 60 * 1000 })
    expect(await handle.run('map', () => 42)).toBe(42)
    await expect(handle.run('fail', () => {
      throw Object.assign(new Error('boom'), { code: 'MAP_FAILED' })
    })).rejects.toThrow('boom')
    expect(received().map(e => [e.command, e.outcome, e.errorCode])).toEqual([
      ['map', 'success', undefined],
      ['fail', 'error', 'MAP_FAILED'],
    ])
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
    expect(server.requests).toHaveLength(0)
  })
})
