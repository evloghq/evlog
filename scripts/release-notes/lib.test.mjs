import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  changelogSection,
  changesetEntries,
  headline,
  isExcluded,
  latestStableTag,
  parseReleaseConfig,
  renderNotes,
} from './lib.mjs'

// #816 ships two changesets from one PR, the case a PR-title list collapses into one line.
const changelog = `# evlog

## 2.31.0

### Minor Changes

- [#834](https://github.com/evloghq/evlog/pull/834) [\`b1880ab\`](https://github.com/evloghq/evlog/commit/b1880ab) Thanks [@HugoRCD](https://github.com/HugoRCD)! - \`log.fork()\` returns a promise that resolves once the child event has drained. Await it when a write must land.

### Patch Changes

- [#816](https://github.com/evloghq/evlog/pull/816) [\`db19fc2\`](https://github.com/evloghq/evlog/commit/db19fc2) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix \`captureOutput\` sending evlog's own events to drains a second time: in JSON mode, each event came back as \`log.info\`.

- [#816](https://github.com/evloghq/evlog/pull/816) [\`db19fc2\`](https://github.com/evloghq/evlog/commit/db19fc2) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix every route returning 500 with \`Cannot find package 'evlog'\` in a Next.js app built with Turbopack.

  The factory is now bundled.

- Updated dependencies [[\`f3613ee\`](https://github.com/evloghq/evlog/commit/f3613ee)]:
  - @evlog/telemetry@0.3.5

## 2.30.1

### Patch Changes

- [#773](https://github.com/evloghq/evlog/pull/773) [\`a053adb\`](https://github.com/evloghq/evlog/commit/a053adb) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Older fix.
`

const dependencyOnly = `## 0.3.4

### Patch Changes

- Updated dependencies [[\`302fd0e\`](https://github.com/evloghq/evlog/commit/302fd0e)]:
  - evlog@2.30.1
`

const config = parseReleaseConfig(readFileSync(resolve(import.meta.dirname, '../../.github/release.yml'), 'utf8'))

describe('parseReleaseConfig', () => {
  it('reads the categories in order and both exclusion lists', () => {
    expect(config.categories[0]).toEqual({ title: 'Breaking Changes 💥', labels: ['breaking'] })
    expect(config.categories.map(c => c.labels[0])).toContain('bug')
    expect(config.excludedLabels).toEqual(['ignore-for-release'])
    expect(config.excludedAuthors).toContain('github-actions[bot]')
  })
})

describe('isExcluded', () => {
  it('drops the release bot and ignore-for-release PRs', () => {
    expect(isExcluded({ author: 'github-actions[bot]', labels: [] }, config)).toBe(true)
    expect(isExcluded({ author: 'HugoRCD', labels: ['ignore-for-release'] }, config)).toBe(true)
    expect(isExcluded({ author: 'HugoRCD', labels: ['feature'] }, config)).toBe(false)
  })
})

describe('latestStableTag', () => {
  it('picks the highest stable version by number, not by string order', () => {
    const tags = ['evlog@2.9.0', 'evlog@2.32.0', 'evlog@2.4.1', '@evlog/cli@9.0.0', 'v2.0.0']
    expect(latestStableTag(tags, 'evlog')).toBe('evlog@2.32.0')
  })

  it('skips prereleases', () => {
    expect(latestStableTag(['evlog@2.32.0', 'evlog@3.0.0-beta.1'], 'evlog')).toBe('evlog@2.32.0')
  })

  it('returns null when the package has no stable tag', () => {
    expect(latestStableTag(['evlog@3.0.0-beta.0', ''], 'evlog')).toBeNull()
  })
})

describe('changelogSection', () => {
  it('stops at the next version heading', () => {
    const section = changelogSection(changelog, '2.31.0')
    expect(section).toMatch(/^### Minor Changes/)
    expect(section).toContain('#816')
    expect(section).not.toContain('#773')
  })

  it('returns null for a version that is not in the file', () => {
    expect(changelogSection(changelog, '2.32.0')).toBeNull()
  })
})

describe('changesetEntries', () => {
  it('gives one entry per changeset, two for a PR that ships two, without the dependency bumps', () => {
    const entries = changesetEntries(changelogSection(changelog, '2.31.0'))
    expect(entries.map(e => [e.pr, e.bump])).toEqual([[834, 'minor'], [816, 'patch'], [816, 'patch']])
    expect(entries[2].summary).toBe('Fix every route returning 500 with `Cannot find package \'evlog\'` in a Next.js app built with Turbopack.\n\nThe factory is now bundled.')
  })

  it('is empty for a dependency-only bump', () => {
    expect(changesetEntries(changelogSection(dependencyOnly, '0.3.4'))).toEqual([])
  })

  it('keeps a changeset that has no PR link', () => {
    const section = '### Patch Changes\n\n- [`abc1234`](https://github.com/evloghq/evlog/commit/abc1234) Thanks [@a](https://github.com/a)! - Fix it.'
    expect(changesetEntries(section)).toEqual([{ pr: null, bump: 'patch', summary: 'Fix it.' }])
  })
})

describe('headline', () => {
  it('ends at the first sentence or the colon before the detail', () => {
    expect(headline('Redact secrets by key name. A new `secrets` built-in replaces them.')).toBe('Redact secrets by key name')
    expect(headline('Fix `captureOutput` sending events twice: in JSON mode, each came back.')).toBe('Fix `captureOutput` sending events twice')
  })

  it('does not stop inside a code span, at e.g., or at a leading label', () => {
    expect(headline('Read `evlog.config.ts` (or `.mjs`), e.g. in a workspace. More.')).toBe('Read `evlog.config.ts` (or `.mjs`), e.g. in a workspace')
    expect(headline('Format `{ a: 1 }` in messages.')).toBe('Format `{ a: 1 }` in messages')
    expect(headline('Breaking: `--global` is removed. Use `--local`.')).toBe('Breaking: `--global` is removed')
  })

  it('uses only the first paragraph and drops a heading marker', () => {
    expect(headline('# fix(elysia): support Workers without enterWith\n\nCloudflare omits it.')).toBe('fix(elysia): support Workers without enterWith')
    expect(headline('Add `fatal`\nand `trace` levels\n\nDetails.')).toBe('Add `fatal` and `trace` levels')
  })
})

describe('renderNotes', () => {
  const repo = 'evloghq/evlog'
  const entries = changesetEntries(changelogSection(changelog, '2.31.0'))
  const pulls = [
    { number: 834, title: 'fix(core): return the child lifetime from log.fork()', author: 'HugoRCD', labels: ['bug'] },
    { number: 816, title: 'feat(next): bundle the instrumentation factory', author: 'HugoRCD', labels: ['feature'] },
    { number: 832, title: 'test: check entrypoint registrations', author: 'evlogai[bot]', labels: ['test'] },
    { number: 3, title: 'chore: c', author: 'a', labels: [] },
  ]
  const changelogRef = { path: 'packages/evlog/CHANGELOG.md', version: '2.31.0' }

  it('lists each changeset in its own words under its bump, and other PRs by title under their label', () => {
    const body = renderNotes({ repo, pulls, entries, previous: 'evlog@2.30.1', tag: 'evlog@2.31.0', config, changelog: changelogRef })
    expect(body).toBe([
      '## What\'s Changed',
      '### Features 🚀',
      '* `log.fork()` returns a promise that resolves once the child event has drained by @HugoRCD in https://github.com/evloghq/evlog/pull/834',
      '### Bug Fixes 🐞',
      '* Fix `captureOutput` sending evlog\'s own events to drains a second time by @HugoRCD in https://github.com/evloghq/evlog/pull/816',
      '* Fix every route returning 500 with `Cannot find package \'evlog\'` in a Next.js app built with Turbopack by @HugoRCD in https://github.com/evloghq/evlog/pull/816',
      '### Tests 🧪',
      '* test: check entrypoint registrations by @evlogai[bot] in https://github.com/evloghq/evlog/pull/832',
      '### Other Changes 🔨',
      '* chore: c by @a in https://github.com/evloghq/evlog/pull/3',
      '',
      '**Changelog**: https://github.com/evloghq/evlog/blob/evlog@2.31.0/packages/evlog/CHANGELOG.md#2310',
      '**Full Changelog**: https://github.com/evloghq/evlog/compare/evlog@2.30.1...evlog@2.31.0',
    ].join('\n'))
  })

  it('files a patch changeset under its PR label when that is narrower than a fix', () => {
    const perf = [{ number: 9, title: 'perf: x', author: 'a', labels: ['performance'] }]
    const body = renderNotes({ repo, pulls: perf, entries: [{ pr: 9, bump: 'patch', summary: 'Speed up set().' }], previous: null, tag: 'evlog@1.0.0', config })
    expect(body).toContain('### Performance Improvements ⚡️\n* Speed up set() by @a')
  })

  it('keeps a patch changeset under Bug Fixes when its PR carries a label that is not a category', () => {
    const pr = [{ number: 9, title: 'fix: x', author: 'a', labels: ['needs-backport', 'bug'] }]
    const body = renderNotes({ repo, pulls: pr, entries: [{ pr: 9, bump: 'patch', summary: 'Fix x.' }], previous: null, tag: 'evlog@1.0.0', config })
    expect(body).toBe('## What\'s Changed\n### Bug Fixes 🐞\n* Fix x by @a in https://github.com/evloghq/evlog/pull/9')
  })

  it('lists a changeset without a PR, unlinked', () => {
    const body = renderNotes({ repo, pulls: [], entries: [{ pr: null, bump: 'minor', summary: 'Add it.' }], previous: null, tag: 'evlog@1.0.0', config })
    expect(body).toBe('## What\'s Changed\n### Features 🚀\n* Add it')
  })

  it('says so when nothing touched the package', () => {
    const body = renderNotes({ repo, pulls: [], previous: null, tag: 'evlog@1.0.0', config })
    expect(body).toBe('## What\'s Changed\n_No pull requests touched this package in this release._')
  })
})
