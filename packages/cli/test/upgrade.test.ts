import { describe, expect, it } from 'vitest'
import { planUpgrade } from '../src/commands/upgrade'
import { UPGRADE_TRANSFORMS } from '../src/lib/upgrade/transforms'

describe('upgrade transform table', () => {
  it('gives every entry a unique id, a source, and a distinct replacement', () => {
    const ids = UPGRADE_TRANSFORMS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of UPGRADE_TRANSFORMS) {
      expect(t.source).toBeTruthy()
      expect(t.to).not.toBe(t.from)
    }
  })

  it('covers the four renames the upgrade issue names', () => {
    const froms = UPGRADE_TRANSFORMS.map(t => t.from)
    expect(froms).toContain('evlog/browser')
    expect(froms).toContain('token')
    expect(froms).toContain('sourceToken')
    expect(froms).toContain('redactMessage: true | false')
    expect(froms).toContain('EvlogConfig')
  })

  it('marks only mechanical rewrites as auto', () => {
    const auto = UPGRADE_TRANSFORMS.filter(t => t.mode === 'auto').map(t => t.id)
    expect(auto).toEqual([
      'browser-import',
      'axiom-token',
      'better-stack-source-token',
      'eve-redact-message',
      'nitro-config-alias',
    ])
  })
})

describe('planUpgrade', () => {
  it('reports the plan without claiming any file was written', () => {
    const plan = planUpgrade()
    expect(plan.writes).toBe(false)
    expect(plan.summary.auto + plan.summary.report).toBe(UPGRADE_TRANSFORMS.length)
  })
})
