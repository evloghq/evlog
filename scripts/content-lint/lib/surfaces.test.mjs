import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { corpusFiles, profileOf, surfaceOf } from './surfaces.mjs'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')

describe('surfaceOf', () => {
  it('separates the surfaces that carry different thresholds', () => {
    expect(surfaceOf('apps/docs/content/0.landing.md')).toBe('landing')
    expect(surfaceOf('apps/docs/content/8.reference/2.performance.md')).toBe('reference')
    expect(surfaceOf('apps/docs/content/blog/why-wide-events.md')).toBe('blog')
    expect(surfaceOf('apps/docs/content/2.learn/2.wide-events.md')).toBe('docs')
  })

  it('tells the surfaces an agent reads from the ones a person reads', () => {
    expect(surfaceOf('.agents/skills/create-adapter/SKILL.md')).toBe('skill')
    expect(surfaceOf('skills/analyze-logs/SKILL.md')).toBe('skill')
    expect(surfaceOf('AGENTS.md')).toBe('agents')
    expect(surfaceOf('apps/docs/AGENTS.md')).toBe('agents')
    expect(surfaceOf('packages/evlog/README.md')).toBe('readme')
  })
})

describe('profileOf', () => {
  it('turns the rhythm checks off where rhythm carries nothing', () => {
    expect(profileOf('skill').rhythm).toBe(false)
    expect(profileOf('agents').rhythm).toBe(false)
    expect(profileOf('docs').rhythm).toBe(true)
  })
})

describe('corpusFiles', () => {
  const files = corpusFiles(REPO_ROOT)

  it('reaches every surface a reader or an agent lands on', () => {
    expect(files).toContain('AGENTS.md')
    expect(files).toContain('packages/evlog/README.md')
    expect(files.some(file => file.startsWith('apps/docs/content/'))).toBe(true)
    expect(files.some(file => file.startsWith('.agents/skills/'))).toBe(true)
  })

  it('leaves out what a pass must not rewrite', () => {
    // Evi's operating instructions, the doctrine's own worked pairs, and the
    // symlinked root README that would double every finding.
    expect(files.some(file => file.startsWith('apps/evi/agent/skills/'))).toBe(false)
    expect(files.some(file => file.startsWith('.agents/skills/write-evlog-content/references/'))).toBe(false)
    expect(files).not.toContain('README.md')
  })
})
