import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

describe('authored skill frontmatter', () => {
  it('parses as YAML in every skill', () => {
    const skillsDir = join(import.meta.dirname, '..', 'skills')
    const files = globSync(join(skillsDir, '*/SKILL.md'))
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const raw = readFileSync(file, 'utf8')
      expect(raw.startsWith('---\n'), file).toBe(true)
      const end = raw.indexOf('\n---', 4)
      const frontmatter = raw.slice(4, end)
      const parsed = parse(frontmatter) as Record<string, string>
      expect(parsed.name, file).toBeTruthy()
      expect(parsed.description, file).toBeTruthy()
    }
  })
})