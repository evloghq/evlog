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

  it('keeps scheduled autonomous pull requests out of draft state', () => {
    const agentDir = join(import.meta.dirname, '..')
    const skillNames = ['adapter-alignment', 'content-pass', 'repo-health-sweep', 'self-review', 'upstream-sync']

    for (const name of skillNames) {
      const skill = readFileSync(join(agentDir, 'skills', name, 'SKILL.md'), 'utf8')
      const schedule = readFileSync(join(agentDir, 'schedules', `${name}.ts`), 'utf8')
      expect(skill, name).not.toMatch(/draft PR/i)
      expect(schedule, name).not.toMatch(/draft PR/i)
      expect(`${skill}\n${schedule}`, name).toMatch(/ready PR/i)
    }
  })

  it('binds sweep verification and delivery to the reviewed revision', () => {
    const skill = readFileSync(join(import.meta.dirname, '..', 'skills', 'repo-health-sweep', 'SKILL.md'), 'utf8')

    expect(skill).toContain('git rev-parse --verify HEAD^{commit}')
    expect(skill).toContain('git merge-base HEAD <reviewed-revision>')
    expect(skill).toContain('git diff <reviewed-revision>...HEAD')
  })

  it('keeps the sweep coverage ledger in the repository', () => {
    const agentDir = join(import.meta.dirname, '..')
    const ledgerPath = 'apps/evi/agent/ledgers/repo-health-sweep.md'
    const skill = readFileSync(join(agentDir, 'skills', 'repo-health-sweep', 'SKILL.md'), 'utf8')
    const schedule = readFileSync(join(agentDir, 'schedules', 'repo-health-sweep.ts'), 'utf8')
    const ledger = readFileSync(join(agentDir, 'ledgers', 'repo-health-sweep.md'), 'utf8')

    expect(skill).toContain(ledgerPath)
    expect(schedule).toContain(ledgerPath)
    expect(`${skill}\n${schedule}`).not.toMatch(/ledger issue|linear__list_comments/)
    expect(ledger).toMatch(/^## Entry 1, /m)
  })
})
