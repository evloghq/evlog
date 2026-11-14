import { describe, expect, it } from 'vitest'
import { assessRisk, changesetBumps, clip, COMMENT_MARKER, renderComment, validateRiskScore } from './lib.mjs'

const SHA = '0123456789abcdef0123456789abcdef01234567'

const file = (filename, extra = {}) => ({ filename, status: 'modified', additions: 10, deletions: 2, ...extra })
const area = (assessment, name) => assessment.areas.find(a => a.name === name)

/** Pull the JSON out of the `linear:extension` block, the way Linear reads it. */
function extensionOf(body) {
  const match = body.match(/<!-- linear:extension (.+?) -->/s)
  return JSON.parse(match[1])
}

describe('assessRisk', () => {
  it('rates a docs-only change Low in every area', () => {
    const result = assessRisk({ title: 'docs: fix a typo', files: [file('apps/docs/content/1.getting-started/1.index.md')] })
    expect(result.level).toBe(1)
    expect(result.areas.map(a => a.level)).toEqual([1, 1, 1, 1, 1])
    expect(result.explanations).toEqual(['1 files changed, none in shipped package source'])
  })

  it('rates an integration fix with a test and a changeset Typical', () => {
    const result = assessRisk({
      title: 'fix(hono): keep the request id on errors',
      files: [
        file('packages/evlog/src/hono/index.ts'),
        file('packages/evlog/test/hono/hono.test.ts'),
        file('.changeset/hono-request-id.md', { status: 'added', patch: '@@ -0,0 +1,5 @@\n+---\n+\'evlog\': patch\n+---\n+\n+Fix the request id.' }),
      ],
    })
    expect(result.level).toBe(2)
    expect(area(result, 'Compatibility').level).toBe(2)
    expect(area(result, 'Delivery reliability').level).toBe(2)
    expect(area(result, 'Delivery reliability').explanation).toContain('hono/index.ts')
    expect(result.explanations).not.toContain('Shipped source changes without a changeset')
  })

  it('rates adapter changes High for delivery and Typical for sensitive data', () => {
    const result = assessRisk({
      title: 'fix(axiom): retry on 429',
      files: [file('packages/evlog/src/adapters/axiom.ts'), file('packages/evlog/test/adapters/axiom.test.ts')],
    })
    expect(area(result, 'Delivery reliability').level).toBe(3)
    expect(area(result, 'Sensitive data exposure').level).toBe(2)
    expect(result.level).toBe(3)
  })

  it('flags redaction and added credential handling as sensitive', () => {
    const result = assessRisk({
      title: 'feat(core): redact more headers',
      files: [
        file('packages/evlog/src/redact.ts'),
        file('packages/evlog/src/express/index.ts', { patch: '@@ -1 +1,2 @@\n const a = 1\n+const auth = req.headers.authorization' }),
        file('packages/evlog/test/redact.test.ts'),
      ],
    })
    const sensitive = area(result, 'Sensitive data exposure')
    expect(sensitive.level).toBe(3)
    expect(sensitive.explanation).toContain('redact.ts')
    expect(sensitive.explanation).toContain('express/index.ts')
    expect(area(result, 'Logging overhead').level).toBe(3)
  })

  it('ignores credential words on removed and context lines', () => {
    const result = assessRisk({
      title: 'refactor(express): rename a variable',
      files: [
        file('packages/evlog/src/express/index.ts', { patch: '@@ -1,2 +1,2 @@\n const cookie = 1\n-const password = 2\n+const value = 2' }),
        file('packages/evlog/test/express/express.test.ts'),
      ],
    })
    expect(area(result, 'Sensitive data exposure').level).toBe(1)
  })

  it('rates the per-event hot path High for overhead', () => {
    const result = assessRisk({
      title: 'perf(core): avoid a copy',
      files: [file('packages/evlog/src/logger.ts'), file('packages/evlog/test/logger.test.ts')],
    })
    expect(area(result, 'Logging overhead').level).toBe(3)
    expect(area(result, 'Logging overhead').explanation).toBe('Changes the per-event hot path: src/logger.ts')
  })

  it('rates a breaking title Very high', () => {
    const result = assessRisk({ title: 'feat(core)!: drop evlog/browser', files: [file('packages/evlog/src/browser.ts', { status: 'removed' })] })
    expect(result.level).toBe(4)
    expect(area(result, 'Compatibility').explanation).toMatch(/^The title marks the change as breaking/)
    expect(area(result, 'Compatibility').explanation).toContain('Removes or renames shipped modules: src/browser.ts')
  })

  it('rates a module renamed out of shipped source by its original path', () => {
    const result = assessRisk({
      title: 'refactor: archive the redaction module',
      files: [file('archive/redact.ts', { status: 'renamed', previous_filename: 'packages/evlog/src/redact.ts' })],
    })
    expect(result.level).toBe(3)
    expect(area(result, 'Compatibility').explanation).toContain('Removes or renames shipped modules: src/redact.ts')
    expect(area(result, 'Sensitive data exposure').explanation).toContain('src/redact.ts')
    expect(area(result, 'Logging overhead').level).toBe(3)
  })

  it('rates a major changeset Very high and a minor one High', () => {
    const changeset = bump => file('.changeset/x.md', { status: 'added', patch: `@@ -0,0 +1,3 @@\n+---\n+"evlog": ${bump}\n+---` })
    const test = file('packages/evlog/test/x.test.ts')
    expect(assessRisk({ title: 'feat: x', files: [changeset('major'), test] }).level).toBe(4)
    expect(assessRisk({ title: 'feat: x', files: [changeset('minor'), test] }).level).toBe(3)
  })

  it('rates the public API surface and manifests High for compatibility', () => {
    const result = assessRisk({
      title: 'feat: add evlog/foo',
      files: [
        file('packages/evlog/package.json'),
        file('packages/evlog/tsdown.config.ts'),
        file('packages/evlog/test/toolkit/__snapshots__/api-surface.test.ts.snap'),
      ],
    })
    expect(area(result, 'Compatibility').level).toBe(3)
    expect(area(result, 'Compatibility').explanation).toContain('package manifest')
  })

  it('notes shipped source without tests or a changeset', () => {
    const result = assessRisk({ title: 'fix(next): x', files: [file('packages/evlog/src/next/handler.ts')] })
    expect(result.level).toBe(2)
    expect(result.explanations).toContain('Shipped source changes without any test change')
    expect(result.explanations).toContain('Shipped source changes without a changeset')
  })

  it('raises a large shipped change to High', () => {
    const result = assessRisk({
      title: 'feat(cli): new command',
      files: [file('packages/cli/src/commands/new.ts', { additions: 600 }), file('packages/cli/test/new.test.ts')],
    })
    expect(result.level).toBe(3)
    expect(result.explanations).toContain('Large change to shipped source (602 lines)')
  })

  it('rates the publish path Very high and other workflows High', () => {
    expect(area(assessRisk({ title: 'ci: x', files: [file('.github/workflows/release.yml')] }), 'CI and release').level).toBe(4)
    expect(area(assessRisk({ title: 'ci: x', files: [file('.github/workflows/ci.yml')] }), 'CI and release').level).toBe(3)
    expect(area(assessRisk({ title: 'chore: x', files: [file('pnpm-lock.yaml')] }), 'CI and release').level).toBe(2)
  })

  it('stays within Linear limits on a huge pull request', () => {
    const files = Array.from({ length: 300 }, (_, i) => file(`packages/evlog/src/adapters/adapter-with-a-long-file-name-${i}.ts`, { status: 'removed' }))
    files.push(file('.github/workflows/release.yml'), file('packages/evlog/src/logger.ts'), file('packages/evlog/src/redact.ts'))
    const result = assessRisk({ title: 'breaking: rewrite', files })
    expect(() => validateRiskScore({ plugin: 'riskScore', sha: SHA, ...result })).not.toThrow()
    expect(result.explanations.length).toBeLessThanOrEqual(8)
  })
})

describe('changesetBumps', () => {
  it('reads every bump in the frontmatter', () => {
    const patch = '@@ -0,0 +1,6 @@\n+---\n+\'evlog\': minor\n+"@evlog/cli": patch\n+---\n+\n+Text: major'
    expect([...changesetBumps(patch)].sort()).toEqual(['minor', 'patch'])
  })

  it('reads context lines of an edited changeset', () => {
    expect([...changesetBumps('@@ -1,3 +1,3 @@\n ---\n "evlog": major\n ---')]).toEqual(['major'])
  })
})

describe('validateRiskScore', () => {
  const valid = { plugin: 'riskScore', sha: SHA, level: 2, explanations: ['ok'], areas: [{ name: 'A', level: 1, explanation: 'ok' }] }

  it('accepts a valid entry', () => {
    expect(validateRiskScore(valid)).toBe(valid)
  })

  it.each([
    ['an unknown field', { ...valid, visible: true }],
    ['a level out of range', { ...valid, level: 5 }],
    ['a fractional level', { ...valid, level: 2.5 }],
    ['a short sha', { ...valid, sha: 'abc1234' }],
    ['nine explanations', { ...valid, explanations: Array.from({ length: 9 }, () => 'x') }],
    ['an empty explanation', { ...valid, explanations: ['  '] }],
    ['an explanation over 200 characters', { ...valid, explanations: ['x'.repeat(201)] }],
    ['an unknown area field', { ...valid, areas: [{ name: 'A', level: 1, weight: 2 }] }],
    ['a multi-line area name', { ...valid, areas: [{ name: 'A\nB', level: 1 }] }],
    ['an area name over 60 characters', { ...valid, areas: [{ name: 'x'.repeat(61), level: 1 }] }],
    ['an area level out of range', { ...valid, areas: [{ name: 'A', level: 0 }] }],
  ])('rejects %s', (_, entry) => {
    expect(() => validateRiskScore(entry)).toThrow(/invalid riskScore entry/)
  })
})

describe('clip', () => {
  it('keeps short text and cuts long text to 200 characters', () => {
    expect(clip('  short  ')).toBe('short')
    expect(clip('x'.repeat(250))).toHaveLength(200)
  })
})

describe('renderComment', () => {
  const assessment = assessRisk({
    title: 'fix(axiom): retry | backoff',
    files: [file('packages/evlog/src/adapters/axiom.ts'), file('packages/evlog/test/adapters/axiom.test.ts')],
  })
  const body = renderComment({ sha: SHA, assessment })

  it('starts with the marker the workflow looks for', () => {
    expect(body.startsWith(COMMENT_MARKER)).toBe(true)
  })

  it('embeds a version 1 riskScore bound to the head sha', () => {
    expect(extensionOf(body)).toEqual({ version: 1, plugins: [{ plugin: 'riskScore', sha: SHA, ...assessment }] })
  })

  it('lists the areas highest first for GitHub readers', () => {
    expect(body).toContain('### Risk score: High (3/4)')
    expect(body.indexOf('| Delivery reliability | High |')).toBeLessThan(body.indexOf('| Compatibility | Typical |'))
  })

  it('refuses to render an entry Linear would drop', () => {
    expect(() => renderComment({ sha: 'not-a-sha', assessment })).toThrow(/sha must be/)
  })
})
