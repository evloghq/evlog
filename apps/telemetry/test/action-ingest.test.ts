import { parseIngestBody } from '@evlog/telemetry/ingest'
import { describe, expect, it } from 'vitest'
import { parseAllowedCustomKeys, parseAllowedTools } from '../server/utils/allowed-tools'

const custom = {
  ghaAction: 'evloghq/action',
  ghaEvent: 'pull_request',
  baselineMode: 'base',
  checkOutcome: 'created',
  commentOutcome: 'updated',
  errorStage: 'cli',
  packages: 2,
  entryPoints: 10,
  score: 80,
  instrumented: 6,
  partial: 2,
  dark: 2,
  regressions: 1,
  fixed: 3,
  gatePassed: false,
  baselineDelta: -5,
}

function body(fields: Record<string, string | number | boolean>) {
  return JSON.stringify({ events: [
    {
      event: 'run',
      command: 'map',
      durationMs: 500,
      outcome: 'success',
      flags: { gate: false },
      tool: { name: 'evlog-action', version: 'v1' },
      env: { node: 'v24.0.0', ci: true, provider: 'github_actions', tty: false, agent: null, os: 'linux', arch: 'x64', environment: 'production' },
      custom: fields,
      idempotencyKey: 'action-run-test',
      timestamp: '2026-10-05T12:00:00.000Z',
    }
  ] })
}

const options = () => ({ allowedTools: parseAllowedTools(undefined), allowedCustomKeys: parseAllowedCustomKeys(undefined) })

describe('action telemetry ingestion', () => {
  it('accepts action metadata, aggregate scan totals and reporting outcomes', () => {
    const events = parseIngestBody(body(custom), options())
    expect(events).toHaveLength(1)
    expect(events[0]?.custom).toEqual(custom)
    expect(events[0]?.tool).toEqual({ name: 'evlog-action', version: 'v1' })
  })

  it('drops repository data and undeclared fields', () => {
    const events = parseIngestBody(body({ ...custom, repository: 'private/repo', sha: 'secret', token: 'secret', path: '/private/source.ts' }), options())
    expect(events[0]?.custom).toEqual(custom)
  })

  it('keeps explicit deployment tool overrides authoritative', () => {
    expect(() => parseIngestBody(body(custom), { ...options(), allowedTools: parseAllowedTools('evlog-cli') })).toThrow('unknown tool')
  })
})
