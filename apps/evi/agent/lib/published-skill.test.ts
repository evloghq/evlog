import { describe, expect, it } from 'vitest'
import { publishedSkill } from './published-skill'

describe('publishedSkill', () => {
  it('lowers a published SKILL.md into a skill definition with its references', () => {
    const skill = publishedSkill('review-logging-patterns')
    expect(skill.description).toMatch(/^Review code for logging patterns/)
    expect(skill.license).toBe('MIT')
    expect(skill.metadata).toEqual({ author: 'HugoRCD', version: expect.any(String) })
    expect(skill.markdown.startsWith('# Review logging patterns')).toBe(true)
    expect(Object.keys(skill.files!)).toContain('references/code-review.md')
  })

  it('reads a folded description and a skill without references', () => {
    expect(publishedSkill('build-audit-logs').description).toMatch(/^Build or review audit trails/)
    expect(publishedSkill('analyze-logs').files).toEqual({})
  })
})
