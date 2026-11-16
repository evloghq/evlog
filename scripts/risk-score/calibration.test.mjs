import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assessRisk, validateRiskScore } from './lib.mjs'

const fixture = number => JSON.parse(readFileSync(new URL(`fixtures/${number}.json`, import.meta.url), 'utf8'))

/**
 * Real pull requests, recorded with `pnpm risk-score:record`, and the score a
 * maintainer deciding whether to merge would give them. A rule change that
 * moves one of these has to be a deliberate recalibration.
 */
const CASES = [
  [1076, 'Evi: how git__push signs the commits it pushes', 3, 'Evi agent'],
  [1077, 'Evi: gate on GitHub writes', 3, 'Evi agent'],
  [1074, 'Evi: always-on prompt cut by 60%', 3, 'Evi agent'],
  [1065, 'Evi: GitHub credentials and channel rewired', 4, 'Evi agent'],
  [1048, 'Evi: sweep ledger only', 1, 'Evi agent'],
  [1059, '@evlog/telemetry: consent, notice and sanitize', 4, '@evlog/telemetry'],
  [1052, '@evlog/telemetry: outbox flushing', 3, '@evlog/telemetry'],
  [989, 'Telemetry dashboard: where the session secret is read from', 4, 'Telemetry dashboard'],
  [1051, 'Telemetry dashboard: polling', 2, 'Telemetry dashboard'],
  [1083, '@evlog/cli: init and agents writing into users\' files', 3, '@evlog/cli'],
  [1016, 'Version Packages with minor bumps', 3, 'evlog core'],
  [1008, 'Version Packages with a patch bump', 2, 'evlog core'],
  [1017, 'Version Packages for a beta', 2, 'evlog core'],
  [1072, 'comments only across 50 files', 1, 'evlog adapters'],
  [1029, 'two unused imports removed', 2, 'evlog integrations'],
  [1046, 'dead code removed from adapters', 2, 'evlog adapters'],
  [1042, 'small redaction fix from a fork', 2, 'evlog core'],
  [1030, 'redaction rewrite on the hot path', 3, 'evlog core'],
  [1082, 'peer range widened', 3, 'evlog core'],
  [1002, 'breaking fs adapter change', 4, 'evlog adapters'],
  [1063, 'npm publish workflow', 4, 'CI and release'],
  [1069, 'pinned action bump in every workflow', 2, 'CI and release'],
  [1028, 'docs only', 1, 'Docs and sites'],
]

describe('calibration on recorded pull requests', () => {
  it.each(CASES)('#%i (%s) scores %i, led by %s', (number, _, level, top) => {
    const result = assessRisk(fixture(number))
    expect(result.level).toBe(level)
    expect(result.areas[0].name).toBe(top)
    expect(() => validateRiskScore({ plugin: 'riskScore', ...result })).not.toThrow()
  })

  it('says what merging a Version Packages pull request publishes', () => {
    expect(assessRisk(fixture(1016)).explanations[0]).toBe('On merge: publishes @evlog/cli 0.11.3 (patch), evlog 2.36.0 (minor) and @evlog/telemetry 0.4.0 (minor)')
  })

  it('says what merging deploys and ships', () => {
    expect(assessRisk(fixture(1076)).explanations[0]).toBe('On merge: deploys Evi')
    expect(assessRisk(fixture(1059)).explanations[0]).toMatch(/^On merge: ships @evlog\/cli \(patch\) and @evlog\/telemetry \(patch\) in the next release; deploys the telemetry dashboard/)
  })

  it('names the fork a pull request comes from', () => {
    expect(assessRisk(fixture(1042)).explanations).toContain('Opened from a fork by @onmax')
  })
})
