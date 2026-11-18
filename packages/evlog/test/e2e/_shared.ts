/**
 * Shared helpers for end-to-end tests against real observability platforms.
 *
 * These tests:
 *   - skip when the required env vars aren't set
 *   - tag every event with a unique correlation ID + run/branch/sha so the data
 *     is identifiable and easy to clean up later
 *   - exercise the public adapter API (`createXxxDrain` / `sendBatchToXxx`)
 *     against the real endpoint, with no mocks
 *
 * They are NOT included in the default `pnpm run test` run — see
 * `vitest.e2e.config.ts` and `pnpm run test:e2e`.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import type { OTLPExportLogsRequest, OTLPLogRecord } from '../../src/adapters/otlp'

export interface RunMetadata {
  runId: string
  branch: string
  sha: string
  ci: boolean
}

export interface E2ETags extends Record<string, unknown> {
  e2e: true
  e2e_run_id: string
  e2e_branch: string
  e2e_sha: string
  e2e_test: string
  e2e_correlation_id: string
}

export function getRunMetadata(): RunMetadata {
  const ci = Boolean(process.env.GITHUB_ACTIONS)
  return {
    runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
    branch: process.env.GITHUB_REF_NAME ?? 'local',
    sha: (process.env.GITHUB_SHA ?? 'local').slice(0, 7),
    ci,
  }
}

/**
 * Build a tag bag for a single event. The correlation ID is unique per call,
 * so each emitted event can be located individually in the destination.
 */
export function makeTags(testName: string): E2ETags {
  const meta = getRunMetadata()
  return {
    e2e: true,
    e2e_run_id: meta.runId,
    e2e_branch: meta.branch,
    e2e_sha: meta.sha,
    e2e_test: testName,
    e2e_correlation_id: randomUUID(),
  }
}

/**
 * Build a minimal valid wide event with e2e tags merged in.
 */
export function makeEvent(
  testName: string,
  overrides: Partial<WideEvent> = {},
): WideEvent & E2ETags {
  const tags = makeTags(testName)
  return {
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'evlog-e2e',
    environment: 'test',
    ...tags,
    ...overrides,
  }
}

/**
 * Read an env var and trim it. GitHub Actions can leak trailing whitespace
 * when secrets are piped through certain shells, and an unparseable URL
 * value is much harder to diagnose than a "missing" suite.
 */
export function readEnv(key: string): string | undefined {
  const value = process.env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * `describe.skipIf` wrapper that prints why a suite was skipped — important so
 * a missing token in CI is visible in the logs instead of silently green.
 */
export function describeIfEnv(
  name: string,
  envVars: string[],
  fn: () => void,
): void {
  const missing = envVars.filter(key => !readEnv(key))
  if (missing.length > 0) {
    describe.skip(`${name} (skipped: missing ${missing.join(', ')})`, fn)
    return
  }
  describe(name, fn)
}

/**
 * Poll a predicate until it returns truthy or the timeout elapses.
 * Used by adapters with a read API (Axiom) to wait for ingestion lag.
 */
export async function pollUntil<T>(
  predicate: () => Promise<T | null | undefined>,
  options: { timeoutMs: number, intervalMs: number, label: string },
): Promise<T> {
  const { timeoutMs, intervalMs, label } = options
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  let attempts = 0
  while (Date.now() < deadline) {
    attempts += 1
    try {
      const result = await predicate()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(
    `[${label}] pollUntil timed out after ${timeoutMs}ms (${attempts} attempts)${
     lastError ? `; last error: ${(lastError as Error).message ?? lastError}` : ''}`,
  )
}

/**
 * `it` with a friendlier label that prints the correlation ID on failure,
 * so when a real-world adapter fails you can grep the destination platform.
 */
export function itWithCorrelationId(
  name: string,
  fn: (correlationId: string) => Promise<void>,
  timeoutMs?: number,
): void {
  it(name, async () => {
    const correlationId = randomUUID()
    try {
      await fn(correlationId)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      err.message = `${err.message}\n   ↳ correlation_id: ${correlationId}`
      throw err
    }
  }, timeoutMs)
}

export interface RecordedRequest {
  url: string
  headers: Headers
  body: RequestInit['body']
  status: number
}

/**
 * Let `fetch` reach the network and keep each request with the status the
 * destination answered, so a write-only API can still be checked on the wire.
 */
export function recordFetch(): { requests: RecordedRequest[], restore: () => void } {
  const original = globalThis.fetch
  const requests: RecordedRequest[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await original(input, init)
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: init?.body, status: response.status })
    return response
  })
  return { requests, restore: () => spy.mockRestore() }
}

export interface CollectedRecord {
  resource: Record<string, unknown>
  scope: { name: string, version?: string }
  record: OTLPLogRecord
}

/** Plain value of an OTLP attribute as the collector writes it: int64 comes back as a string. */
export function attributeValue(attributes: OTLPLogRecord['attributes'] | undefined, key: string): unknown {
  const value = attributes?.find(attribute => attribute.key === key)?.value as Record<string, unknown> | undefined
  if (!value) return undefined
  if ('intValue' in value) return Number(value.intValue)
  return value.stringValue ?? value.boolValue ?? value.doubleValue ?? value.kvlistValue ?? value.arrayValue
}

/**
 * Wait for the sandbox OpenTelemetry Collector to write the record whose
 * `e2e_correlation_id` attribute matches, and return it with its resource and scope.
 */
export function waitForCollectedRecord(file: string, correlationId: string, label: string): Promise<CollectedRecord> {
  return pollUntil(async () => {
    const content = await readFile(file, 'utf8').catch(() => '')
    for (const line of content.split('\n')) {
      if (!line.includes(correlationId)) continue
      const request = JSON.parse(line) as OTLPExportLogsRequest
      for (const { resource, scopeLogs } of request.resourceLogs) {
        for (const { scope, logRecords } of scopeLogs) {
          const record = logRecords.find(r => attributeValue(r.attributes, 'e2e_correlation_id') === correlationId)
          if (record) return { resource: Object.fromEntries((resource.attributes ?? []).map(a => [a.key, attributeValue([a], a.key)])), scope, record }
        }
      }
    }
    return null
  }, { timeoutMs: 15_000, intervalMs: 250, label })
}
