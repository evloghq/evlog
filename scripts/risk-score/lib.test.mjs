import { describe, expect, it } from 'vitest'
import { assessRisk, changesetBumps, classifyManifest, classifyWorkflow, clip, COMMENT_MARKER, releaseKind, renderComment, validateRiskScore } from './lib.mjs'

const SHA = '0123456789abcdef0123456789abcdef01234567'

const file = (filename, extra = {}) => ({ filename, status: 'modified', additions: 10, deletions: 2, ...extra })
const area = (assessment, name) => assessment.areas.find(a => a.name === name)
const changeset = bumps => file('.changeset/x.md', { status: 'added', patch: `@@ -0,0 +1,4 @@\n+---\n${bumps.map(b => `+${b}`).join('\n')}\n+---\n+\n+Text.` })

/** Pull the JSON out of the `linear:extension` block, the way Linear reads it. */
function extensionOf(body) {
  const match = body.match(/<!-- linear:extension (.+?) -->/s)
  return JSON.parse(match[1])
}

describe('assessRisk', () => {
  it('rates a docs-only change Low and lists only the docs', () => {
    const result = assessRisk({ title: 'docs: fix a typo', files: [file('apps/docs/content/1.getting-started/1.index.md')] })
    expect(result.level).toBe(1)
    expect(result.areas).toEqual([{ name: 'Docs and sites', level: 1, explanation: 'Changes pages, content or published skills: 1.getting-started/1.index.md' }])
    expect(result.explanations).toEqual(['On merge: deploys the docs and sites', '1 files changed (12 lines), 0 of them tests'])
  })

  it('rates an integration fix with a test and a changeset Typical', () => {
    const result = assessRisk({
      title: 'fix(hono): keep the request id on errors',
      files: [file('packages/evlog/src/hono/index.ts'), file('packages/evlog/test/frameworks/hono.test.ts'), changeset(['\'evlog\': patch'])],
    })
    expect(result.level).toBe(2)
    expect(result.areas).toHaveLength(1)
    expect(area(result, 'evlog integrations').explanation).toContain('hono/index.ts')
    expect(result.explanations[0]).toBe('On merge: ships evlog (patch) in the next release')
    expect(result.explanations.join('\n')).not.toMatch(/No changeset|No test changed/)
  })

  it('rates adapter changes High for delivery', () => {
    const result = assessRisk({
      title: 'fix(axiom): retry on 429',
      files: [file('packages/evlog/src/adapters/axiom.ts', { additions: 40 }), file('packages/evlog/test/adapters/axiom.test.ts')],
    })
    expect(area(result, 'evlog adapters')).toMatchObject({ level: 3, explanation: expect.stringMatching(/^Delivery: .*adapters\/axiom\.ts/) })
    expect(result.level).toBe(3)
  })

  it('flags redaction and added credential handling as privacy risks', () => {
    const result = assessRisk({
      title: 'feat(core): redact more headers',
      files: [
        file('packages/evlog/src/redact.ts', { additions: 40 }),
        file('packages/evlog/src/express/index.ts', { patch: '@@ -1 +1,2 @@\n const a = 1\n+const auth = req.headers.authorization' }),
        file('packages/evlog/test/redact.test.ts'),
      ],
    })
    expect(area(result, 'evlog core')).toMatchObject({ level: 3, explanation: expect.stringContaining('Privacy: touches redaction: src/redact.ts') })
    expect(area(result, 'evlog integrations')).toMatchObject({ level: 3, explanation: expect.stringContaining('Privacy: added lines mention credentials') })
  })

  it('ignores credential words on removed and context lines, and in comments', () => {
    const result = assessRisk({
      title: 'refactor(express): rename a variable',
      files: [
        file('packages/evlog/src/express/index.ts', { patch: '@@ -1,2 +1,3 @@\n const cookie = 1\n-const password = 2\n+const value = 2\n+// bearer tokens are dropped' }),
        file('packages/evlog/test/frameworks/express.test.ts'),
      ],
    })
    expect(area(result, 'evlog integrations').level).toBe(2)
  })

  it('rates the hot path High, and a small edit to it Typical', () => {
    const large = assessRisk({ title: 'perf(core): avoid a copy', files: [file('packages/evlog/src/logger.ts', { additions: 40 })] })
    expect(area(large, 'evlog core').explanation).toBe('Performance: changes the per-event hot path: src/logger.ts')
    const small = assessRisk({ title: 'refactor: x', files: [file('packages/evlog/src/logger.ts', { additions: 4, deletions: 10 })] })
    expect(area(small, 'evlog core')).toMatchObject({ level: 2, explanation: 'Performance: changes the per-event hot path (14 lines): src/logger.ts' })
  })

  it('rates a change that only edits comments or moves lines Low', () => {
    const patch = '@@ -1,6 +1,6 @@\n-/** Old doc. */\n+/** New doc. */\n+const a = 1\n const b = 2\n-const a = 1\n-const c = 3 // why\n+const c = 3'
    const result = assessRisk({ title: 'docs: x', files: [file('packages/evlog/src/logger.ts', { patch })] })
    expect(result.level).toBe(1)
    expect(area(result, 'evlog core').explanation).toBe('Comments or moved code only: src/logger.ts')
    expect(result.explanations[0]).toBe('On merge: nothing ships or deploys')
    const edited = assessRisk({ title: 'fix: x', files: [file('packages/evlog/src/logger.ts', { patch: `${patch}\n-const d = 4\n+const d = 5` })] })
    expect(edited.level).toBe(2)
  })

  it('rates a breaking title Very high on the package it touches', () => {
    const result = assessRisk({ title: 'feat(core)!: drop evlog/browser', files: [file('packages/evlog/src/browser.ts', { status: 'removed' })] })
    expect(result.level).toBe(4)
    expect(area(result, 'evlog core').explanation).toMatch(/^Compatibility: the title marks the change as breaking; Compatibility: removes or renames shipped modules: src\/browser\.ts/)
  })

  it('scores a module renamed out of shipped source by its original path', () => {
    const result = assessRisk({
      title: 'refactor: archive the redaction module',
      files: [file('archive/redact.ts', { status: 'renamed', previous_filename: 'packages/evlog/src/redact.ts' })],
    })
    expect(result.level).toBe(3)
    expect(area(result, 'evlog core').explanation).toContain('removes or renames shipped modules: src/redact.ts')
  })

  it('rates a major changeset Very high and a minor one Typical', () => {
    const src = file('packages/evlog/src/error.ts')
    expect(assessRisk({ title: 'feat: x', files: [changeset(['"evlog": major']), src] }).level).toBe(4)
    expect(assessRisk({ title: 'feat: x', files: [changeset(['"evlog": minor']), src] }).level).toBe(2)
  })

  it('rates the public API surface and an unread manifest High', () => {
    const result = assessRisk({
      title: 'feat: add evlog/foo',
      files: [file('packages/evlog/package.json'), file('packages/evlog/tsdown.config.ts'), file('packages/evlog/test/toolkit/__snapshots__/api-surface.test.ts.snap')],
    })
    expect(area(result, 'evlog core').level).toBe(3)
    expect(area(result, 'evlog core').explanation).toContain('changes a package manifest')
  })

  it('notes each component changed without a test, and each package without a changeset', () => {
    const result = assessRisk({
      title: 'fix: x',
      files: [file('packages/evlog/src/next/handler.ts'), file('packages/telemetry/src/types.ts'), file('packages/telemetry/test/types.test.ts'), changeset(['\'@evlog/cli\': patch'])],
    })
    expect(result.explanations).toContain('No test changed in evlog integrations: next/handler.ts')
    expect(result.explanations.join('\n')).not.toContain('No test changed in @evlog/telemetry')
    expect(result.explanations).toContain('No changeset names evlog and @evlog/telemetry, though its shipped source changed')
  })

  it('raises a large code change in any component to High, counting code only', () => {
    const result = assessRisk({
      title: 'feat(evi): new tool',
      files: [file('apps/evi/agent/lib/report.ts', { additions: 600 }), file('apps/evi/docs/report.md', { additions: 900 }), file('apps/evi/agent/lib/report.test.ts')],
    })
    expect(area(result, 'Evi agent')).toMatchObject({ level: 3, explanation: expect.stringContaining('Size: large change (602 lines)') })
  })

  it('rates the publish path Very high, other workflows by what they change', () => {
    const level = (path, patch) => area(assessRisk({ title: 'ci: x', files: [file(path, { patch })] }), 'CI and release').level
    expect(level('.github/workflows/release.yml')).toBe(4)
    expect(level('.github/workflows/ci.yml')).toBe(3)
    expect(level('.github/workflows/ci.yml', '@@ -1 +1 @@\n-        run: a\n+        run: b')).toBe(2)
    expect(area(assessRisk({ title: 'chore: x', files: [file('pnpm-lock.yaml')] }), 'Dependencies').level).toBe(2)
  })

  it('rates a workflow pin bump Typical, even in the publish workflow', () => {
    const pin = '@@ -1,2 +1,2 @@\n-      - uses: actions/checkout@aaa # v6.1.0\n+      - uses: actions/checkout@bbb # v7.0.1'
    const release = assessRisk({ title: 'chore(deps): x', files: [file('.github/workflows/release.yml', { patch: pin })] })
    expect(area(release, 'CI and release').level).toBe(2)
    expect(release.explanations[0]).toBe('On merge: changes CI workflows')
  })

  it('scores package manifests by the fields that changed', () => {
    const base = { exports: { '.': './a.mjs' }, dependencies: { a: '^1.0.0' }, devDependencies: { v: '^1.0.0' }, peerDependencies: { hono: '>=4.1.0' } }
    const level = head => area(assessRisk({ title: 'chore: x', files: [file('packages/evlog/package.json')], manifests: { 'packages/evlog/package.json': { base, head: { ...base, ...head } } } }), 'evlog core').level
    expect(level({ devDependencies: { v: '^2.0.0' } })).toBe(1)
    expect(level({ peerDependencies: { hono: '>=4.3.0' } })).toBe(2)
    expect(level({ peerDependencies: { hono: '^4.1.0 || ^5.0.0' } })).toBe(3)
    expect(level({ exports: { '.': './a.mjs', './b': './b.mjs' } })).toBe(2)
    expect(level({ exports: { '.': './b.mjs' } })).toBe(3)
    expect(level({ dependencies: { a: '^1.2.0' } })).toBe(2)
    expect(level({ dependencies: { a: '^1.0.0', b: '^1.0.0' } })).toBe(3)
  })

  it('says a published manifest change ships, and a dev-only one does not', () => {
    const merge = head => assessRisk({ title: 'chore: x', files: [file('packages/cli/package.json')], manifests: { 'packages/cli/package.json': { base: { name: '@evlog/cli', peerDependencies: { evlog: '>=2.0.0' } }, head: { name: '@evlog/cli', ...head } } } }).explanations[0]
    expect(merge({ peerDependencies: { evlog: '>=2.0.0 || >=3.0.0-0' } })).toBe('On merge: ships @evlog/cli in the next release')
    expect(merge({ peerDependencies: { evlog: '>=2.0.0' }, devDependencies: { vitest: '^4.0.0' } })).toBe('On merge: nothing ships or deploys')
  })

  it('rates a Version Packages pull request by its largest bump', () => {
    const release = (path, name, base, head) => [path, { base: { name, version: base }, head: { name, version: head } }]
    const score = (...entries) => assessRisk({ title: 'chore(repo): version packages', files: entries.map(([path]) => file(path, { additions: 1, deletions: 1 })), manifests: Object.fromEntries(entries) })
    const patch = score(release('packages/cli/package.json', '@evlog/cli', '0.11.2', '0.11.3'))
    expect(patch.level).toBe(2)
    expect(patch.explanations[0]).toBe('On merge: publishes @evlog/cli 0.11.3 (patch)')
    expect(area(patch, '@evlog/cli').explanation).toBe('Release: publishes 0.11.3 (patch): cli/package.json')
    expect(score(release('packages/cli/package.json', '@evlog/cli', '0.11.2', '0.11.3'), release('packages/evlog/package.json', 'evlog', '2.35.1', '2.36.0')).level).toBe(3)
    expect(score(release('packages/evlog/package.json', 'evlog', '3.0.0-beta.4', '3.0.0')).level).toBe(4)
    expect(score(release('packages/evlog/package.json', 'evlog', '3.0.0-beta.4', '3.0.0-beta.5')).level).toBe(2)
  })

  it('scores prerelease bookkeeping apart from entering pre mode', () => {
    const level = patch => area(assessRisk({ title: 'chore: x', files: [file('.changeset/pre.json', { patch })] }), 'CI and release').level
    expect(level('@@ -8,3 +8,4 @@\n   "changesets": [\n+    "new-one",\n     "old-one"')).toBe(2)
    expect(level('@@ -1,2 +1,2 @@\n {\n-  "mode": "pre",\n+  "mode": "exit",')).toBe(4)
  })

  it('rates Evi by what the change lets it do', () => {
    const evi = (...files) => area(assessRisk({ title: 'fix(evi): x', files }), 'Evi agent')
    expect(evi(file('apps/evi/agent/lib/trust.ts', { additions: 1, deletions: 1 })).level).toBe(4)
    expect(evi(file('apps/evi/agent/lib/github/push.ts')).explanation).toMatch(/^External writes: /)
    expect(evi(file('apps/evi/agent/schedules/digest.ts')).level).toBe(3)
    expect(evi(file('apps/evi/agent/instructions.md', { additions: 30, deletions: 20 }))).toMatchObject({ level: 2, explanation: 'Behavior: changes the always-on prompt (50 lines): agent/instructions.md' })
    expect(evi(file('apps/evi/agent/instructions.md', { additions: 30, deletions: 21 })).level).toBe(3)
    expect(evi(file('apps/evi/agent/ledgers/repo-health-sweep.md')).level).toBe(1)
  })

  it('rates dashboard migrations by whether they keep existing data', () => {
    const migration = sql => area(assessRisk({ title: 'feat(telemetry): x', files: [file('apps/telemetry/server/db/migrations/postgresql/0002_x.sql', { status: 'added', patch: `@@ -0,0 +1 @@\n+${sql}` })] }), 'Telemetry dashboard').level
    expect(migration('ALTER TABLE "runs" ADD COLUMN "agent" text;')).toBe(3)
    expect(migration('ALTER TABLE "runs" DROP COLUMN "agent";')).toBe(4)
  })

  it('rates any consent change in @evlog/telemetry Very high, however small', () => {
    const result = assessRisk({ title: 'fix(telemetry): x', files: [file('packages/telemetry/src/consent.ts', { additions: 1, deletions: 1 }), file('packages/telemetry/test/consent.test.ts')] })
    expect(result.level).toBe(4)
    expect(area(result, '@evlog/telemetry').explanation).toMatch(/^Privacy: changes consent/)
  })

  it('names a first-time contributor opening from a fork', () => {
    const result = assessRisk({ title: 'fix: x', author: { login: 'someone', fork: true, association: 'FIRST_TIME_CONTRIBUTOR' }, files: [file('apps/docs/content/a.md')] })
    expect(result.explanations).toContain('Opened from a fork by @someone, a first-time contributor')
    const own = assessRisk({ title: 'fix: x', author: { login: 'HugoRCD', fork: false, association: 'OWNER' }, files: [file('apps/docs/content/a.md')] })
    expect(own.explanations.join('\n')).not.toContain('fork')
  })

  it('stays within Linear limits on a huge pull request and keeps the totals line', () => {
    const files = Array.from({ length: 300 }, (_, i) => file(`packages/evlog/src/adapters/adapter-with-a-long-file-name-${i}.ts`, { status: 'removed' }))
    files.push(...['.github/workflows/release.yml', 'packages/evlog/src/logger.ts', 'packages/evlog/src/hono/index.ts', 'packages/cli/src/a.ts', 'packages/telemetry/src/b.ts', 'packages/signals/src/c.ts', 'packages/nuxthub/src/d.ts', 'apps/evi/agent/e.ts', 'apps/telemetry/server/f.ts', 'apps/docs/g.md'].map(p => file(p)))
    const result = assessRisk({ title: 'breaking: rewrite', files })
    expect(() => validateRiskScore({ plugin: 'riskScore', sha: SHA, ...result })).not.toThrow()
    expect(result.areas).toHaveLength(8)
    expect(result.areas.at(-1).name).toBe('Other')
    expect(result.explanations).toHaveLength(8)
    expect(result.explanations.at(-1)).toMatch(/^310 files changed/)
  })
})

describe('releaseKind', () => {
  it.each([
    ['2.35.1', '2.35.1', null],
    ['2.35.1', '2.35.2', 'patch'],
    ['2.35.1', '2.36.0', 'minor'],
    ['2.35.1', '3.0.0-beta.0', 'major'],
    ['3.0.0-beta.4', '3.0.0-beta.5', 'prerelease'],
    ['3.0.0-beta.5', '3.0.0', 'stable'],
    [undefined, '0.1.0', 'first'],
  ])('reads %s to %s as %s', (base, head, kind) => {
    expect(releaseKind(base, head)).toBe(kind)
  })
})

describe('changesetBumps', () => {
  it('reads every bump in the frontmatter', () => {
    const patch = '@@ -0,0 +1,6 @@\n+---\n+\'evlog\': minor\n+"@evlog/cli": patch\n+---\n+\n+Text: major'
    expect(Object.fromEntries(changesetBumps(patch))).toEqual({ 'evlog': 'minor', '@evlog/cli': 'patch' })
  })

  it('reads context lines of an edited changeset', () => {
    expect([...new Set(changesetBumps('@@ -1,3 +1,3 @@\n ---\n "evlog": major\n ---').values())]).toEqual(['major'])
  })

  it('reads an edited changeset whose hunk starts below the opening fence', () => {
    expect([...new Set(changesetBumps('@@ -2,6 +2,6 @@\n \'evlog\': patch\n ---\n \n-old\n+new').values())]).toEqual(['patch'])
  })

  it('reads an edited changeset whose first hunk ends before the closing fence', () => {
    const patch = '@@ -1,5 +1,5 @@\n ---\n-\'evlog\': patch\n+\'evlog\': major\n \'@evlog/cli\': patch\n \'@evlog/signals\': patch\n \'@evlog/telemetry\': patch'
    expect([...new Set(changesetBumps(patch).values())].sort()).toEqual(['major', 'patch'])
  })

  it('reads an edited changeset whose first hunk shows neither fence', () => {
    const patch = '@@ -3,7 +3,7 @@\n \'@evlog/cli\': patch\n \'@evlog/nuxthub\': patch\n \'@evlog/signals\': patch\n-\'@evlog/telemetry\': patch\n+\'@evlog/telemetry\': minor\n \'@evlog/eve\': patch\n \'@evlog/hono\': patch\n \'@evlog/next\': patch'
    expect([...new Set(changesetBumps(patch).values())].sort()).toEqual(['minor', 'patch'])
  })
})

describe('classifyManifest', () => {
  it('treats a new manifest as a non-additive entrypoint change', () => {
    expect(classifyManifest(null, { name: 'x', exports: { '.': './a.mjs' } })).toEqual({ kind: 'entry', additive: false })
  })

  it('does not take a peer floor raised into a new major for a floor raise', () => {
    expect(classifyManifest({ peerDependencies: { a: '^4.9.0' } }, { peerDependencies: { a: '^5.0.0' } }).kind).toBe('install')
    expect(classifyManifest({ peerDependencies: { a: '>=4.9.0' } }, { peerDependencies: { a: '>=4.8.0' } }).kind).toBe('install')
  })
})

describe('classifyWorkflow', () => {
  it.each([
    ['a pinned action bump', '@@ -1 +1 @@\n-    - uses: a/b@111 # v1\n+    - uses: a/b@222 # v2', 'pins'],
    ['a pinned tool version', '@@ -1 +1 @@\n-          VERCEL_CLI_VERSION: 1.0.0\n+          VERCEL_CLI_VERSION: 1.1.0', 'pins'],
    ['a new write permission', '@@ -1 +1,2 @@\n     permissions:\n+      contents: write', 'credentials'],
    ['a new checked-out ref', '@@ -1 +1 @@\n-          ref: ${{ github.event.pull_request.base.sha }}\n+          ref: ${{ github.sha }}', 'credentials'],
    ['a changed step', '@@ -1 +1 @@\n-        run: pnpm test\n+        run: pnpm test --shard 1', 'other'],
    ['a file without a patch', undefined, 'credentials'],
  ])('classifies %s', (_, patch, kind) => {
    expect(classifyWorkflow(patch)).toBe(kind)
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
    files: [file('apps/docs/content/axiom.md'), file('packages/evlog/src/adapters/axiom.ts', { additions: 40 }), file('packages/evlog/test/adapters/axiom.test.ts')],
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
    expect(body.indexOf('| evlog adapters | High |')).toBeLessThan(body.indexOf('| Docs and sites | Low |'))
  })

  it('refuses to render an entry Linear would drop', () => {
    expect(() => renderComment({ sha: 'not-a-sha', assessment })).toThrow(/sha must be/)
  })
})
