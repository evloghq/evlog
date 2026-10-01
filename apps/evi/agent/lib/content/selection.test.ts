import { describe, expect, it } from 'vitest'
import { cooldownCommand, groupOf, selectTargets, touchedPaths } from './selection'

const page = (path: string, score: number, criticals = 0, surface = 'docs') => ({
  path,
  surface,
  score,
  findings: [
    ...Array.from({ length: criticals }, (_value, index) => ({
      id: 'T-15',
      severity: 'critical' as const,
      line: index + 1,
      message: 'gone',
    })),
    { id: 'T-06', severity: 'standard' as const, line: 1, message: 'template lock' },
  ],
})

describe('groupOf', () => {
  it('names the top-level docs section', () => {
    expect(groupOf(page('apps/docs/content/2.learn/2.wide-events.md', 100))).toBe('2.learn')
    expect(groupOf(page('apps/docs/content/4.integrate/adapters/hybrid/01.loki.md', 100))).toBe('4.integrate')
  })

  it('falls back to the surface for a page sitting at the content root', () => {
    expect(groupOf(page('apps/docs/content/0.landing.md', 100, 0, 'landing'))).toBe('landing')
  })

  it('groups a skill by its own directory, not by the whole tree', () => {
    expect(groupOf(page('.agents/skills/create-adapter/references/test-template.md', 100, 0, 'skill')))
      .toBe('.agents/skills/create-adapter')
    expect(groupOf(page('skills/analyze-logs/SKILL.md', 100, 0, 'skill')))
      .toBe('skills/analyze-logs')
  })

  it('keeps the flat surfaces in one group each', () => {
    expect(groupOf(page('AGENTS.md', 100, 0, 'agents'))).toBe('agents')
    expect(groupOf(page('packages/evlog/README.md', 100, 0, 'readme'))).toBe('readme')
  })
})

describe('selectTargets', () => {
  it('leads with the page carrying criticals, not the lowest score', () => {
    const selection = selectTargets({
      pages: [page('apps/docs/content/2.learn/a.md', 40), page('apps/docs/content/2.learn/b.md', 75, 2)],
      recentlyTouched: [],
    })

    expect(selection.targets[0].path).toBe('apps/docs/content/2.learn/b.md')
  })

  it('holds a page changed inside the cooldown', () => {
    const selection = selectTargets({
      pages: [page('apps/docs/content/2.learn/a.md', 40)],
      recentlyTouched: ['apps/docs/content/2.learn/a.md'],
    })

    expect(selection.targets).toEqual([])
    expect(selection.held).toEqual([{ path: 'apps/docs/content/2.learn/a.md', reason: 'changed inside the cooldown window' }])
  })

  it('keeps the pass inside one section and says what it left', () => {
    const selection = selectTargets({
      pages: [
        page('apps/docs/content/2.learn/a.md', 40),
        page('apps/docs/content/2.learn/b.md', 50),
        page('apps/docs/content/7.extend/c.md', 45),
      ],
      recentlyTouched: [],
    })

    expect(selection.group).toBe('2.learn')
    expect(selection.targets.map(target => target.path)).toEqual([
      'apps/docs/content/2.learn/a.md',
      'apps/docs/content/2.learn/b.md',
    ])
    expect(selection.held[0].reason).toContain('outside')
  })

  it('caps the pass at the limit', () => {
    const pages = ['a', 'b', 'c', 'd'].map((name, index) => page(`apps/docs/content/2.learn/${name}.md`, 40 + index))
    const selection = selectTargets({ pages, recentlyTouched: [], limit: 2 })

    expect(selection.targets).toHaveLength(2)
  })

  it('reports on the landing page instead of rewriting it', () => {
    const selection = selectTargets({
      pages: [page('apps/docs/content/0.landing.md', 60, 0, 'landing')],
      recentlyTouched: [],
    })

    expect(selection.targets[0].mode).toBe('report')
  })

  it('rewrites the landing page when something is broken there', () => {
    const selection = selectTargets({
      pages: [page('apps/docs/content/0.landing.md', 60, 1, 'landing')],
      recentlyTouched: [],
    })

    expect(selection.targets[0].mode).toBe('rewrite')
  })

  it('fixes a house rule on a skill but only proposes anything else', () => {
    const punctuation = {
      path: '.agents/skills/create-adapter/SKILL.md',
      surface: 'skill',
      score: 95,
      findings: [{ id: 'U-14', severity: 'standard' as const, line: 3, message: 'em dash' }],
    }
    const procedure = {
      ...punctuation,
      findings: [...punctuation.findings, { id: 'T-14', severity: 'standard' as const, line: 9, message: 'unbacked' }],
    }

    expect(selectTargets({ pages: [punctuation], recentlyTouched: [] }).targets[0].mode).toBe('rewrite')
    expect(selectTargets({ pages: [procedure], recentlyTouched: [] }).targets[0].mode).toBe('report')
  })

  it('counts what it saw, so a pass cannot call a full ranking empty', () => {
    const selection = selectTargets({
      pages: [
        page('apps/docs/content/2.learn/a.md', 40),
        page('apps/docs/content/2.learn/b.md', 50),
        page('apps/docs/content/7.extend/c.md', 45),
        { path: 'apps/docs/content/2.learn/clean.md', surface: 'docs', score: 100, findings: [] },
      ],
      recentlyTouched: ['apps/docs/content/2.learn/a.md'],
    })

    expect(selection.candidates).toBe(3)
    expect(selection.eligible).toBe(2)
  })

  it('reports zero eligible when the cooldown holds everything', () => {
    const selection = selectTargets({
      pages: [page('apps/docs/content/2.learn/a.md', 40)],
      recentlyTouched: ['apps/docs/content/2.learn/a.md'],
    })

    expect(selection.candidates).toBe(1)
    expect(selection.eligible).toBe(0)
    expect(selection.targets).toEqual([])
  })

  it('ignores pages the scanner found nothing on', () => {
    const clean = { path: 'apps/docs/content/2.learn/a.md', surface: 'docs', score: 100, findings: [] }

    expect(selectTargets({ pages: [clean], recentlyTouched: [] }).targets).toEqual([])
  })
})

describe('touchedPaths', () => {
  it('keeps markdown anywhere in the corpus and drops everything else', () => {
    const log = ['apps/docs/content/2.learn/a.md', '', 'packages/evlog/src/index.ts', 'AGENTS.md', 'apps/docs/content/2.learn/a.md']

    expect(touchedPaths(log.join('\n'))).toEqual(['apps/docs/content/2.learn/a.md', 'AGENTS.md'])
  })
})

describe('cooldownCommand', () => {
  it('passes --min-parents=1, which is what skips a shallow boundary commit', () => {
    expect(cooldownCommand('/workspace/repo', 14)).toContain('--min-parents=1')
  })

  it('quotes the repository path', () => {
    expect(cooldownCommand('/tmp/a dir; rm -rf /', 14)).toContain(`'/tmp/a dir; rm -rf /'`)
  })

  it('asks for the window it was given', () => {
    expect(cooldownCommand('/workspace/repo', 30)).toContain('--since=\'30 days ago\'')
  })
})
