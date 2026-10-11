import { globSync, readdirSync, readFileSync } from 'node:fs'
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

  it('keeps the sweep ledger compact, with history in an archive and rejected findings in a searchable file', () => {
    const agentDir = join(import.meta.dirname, '..')
    const ledgers = join(agentDir, 'ledgers')
    const compactPath = 'apps/evi/agent/ledgers/repo-health-sweep.md'
    const rejectedPath = 'apps/evi/agent/ledgers/repo-health-sweep-rejected.jsonl'
    const skill = readFileSync(join(agentDir, 'skills', 'repo-health-sweep', 'SKILL.md'), 'utf8')
    const schedule = readFileSync(join(agentDir, 'schedules', 'repo-health-sweep.ts'), 'utf8')
    const compact = readFileSync(join(ledgers, 'repo-health-sweep.md'), 'utf8')
    const rejected = readFileSync(join(ledgers, 'repo-health-sweep-rejected.jsonl'), 'utf8')
    const archives = readdirSync(join(ledgers, 'archive')).filter(name => /^\d{4}-\d{2}\.md$/.test(name))

    for (const text of [skill, schedule]) {
      expect(text).toContain(compactPath)
      expect(text).toContain(rejectedPath)
      expect(text).toContain('archive')
    }
    expect(`${skill}\n${schedule}`).not.toMatch(/ledger issue|linear__list_comments/)

    const cap = Number(compact.match(/Hard cap: (\d+) lines/)?.[1])
    expect(cap).toBeGreaterThan(0)
    expect(compact.trimEnd().split('\n').length).toBeLessThanOrEqual(cap)
    expect(compact).not.toMatch(/^## Entry \d+/m)

    const archived = archives.map(name => readFileSync(join(ledgers, 'archive', name), 'utf8')).join('\n')
    expect(archives.length).toBeGreaterThan(0)
    expect(archived.match(/^## (Entry \d+|Run \d{4}-\d{2}-\d{2})/gm)?.length).toBeGreaterThanOrEqual(7)

    const lines = rejected.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const finding = JSON.parse(line) as Record<string, unknown>
      expect(Object.keys(finding).sort()).toEqual(['area', 'claim', 'date', 'paths', 'reason', 'revision', 'source'])
      expect(Array.isArray(finding.paths)).toBe(true)
      const [file, section] = String(finding.source).split('#')
      expect(archives).toContain(file!.replace('archive/', ''))
      expect(archived).toContain(`## ${section}`)
    }
  })
})
