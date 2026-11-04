import { describe, expect, it } from 'vitest'
import { approvalSummary, distTag, plan, stageIdFrom } from './lib.mjs'

const evlog = { name: 'evlog', version: '2.35.0', dir: 'packages/evlog' }
const cli = { name: '@evlog/cli', version: '0.12.0', dir: 'packages/cli' }
const signals = { name: '@evlog/signals', version: '0.2.2', dir: 'packages/signals' }

describe('distTag', () => {
  const pre = { mode: 'pre', tag: 'beta' }

  it('uses latest outside pre mode', () => {
    expect(distTag(undefined, ['2.34.0'])).toBe('latest')
    expect(distTag({ mode: 'exit', tag: 'beta' }, ['2.34.0', '3.0.0-beta.1'])).toBe('latest')
  })

  it('uses the pre-mode tag for a package with a regular release', () => {
    expect(distTag(pre, ['2.34.0', '3.0.0-beta.1'])).toBe('beta')
  })

  it('uses latest for a package with only prereleases on that tag, or none at all', () => {
    expect(distTag(pre, ['1.0.0-beta.0', '1.0.0-beta.1'])).toBe('latest')
    expect(distTag(pre, [])).toBe('latest')
  })
})

describe('plan', () => {
  it('stages a version that changed in the push', () => {
    const result = plan([evlog, signals], {
      published: new Set(['@evlog/signals@0.2.2']),
      tagged: new Set(['@evlog/signals@0.2.2']),
      previousVersions: new Map([['evlog', '2.34.0'], ['@evlog/signals', '0.2.2']]),
    })
    expect(result).toEqual({ release: [], stage: [evlog], waiting: [] })
  })

  it('stages a package that did not exist before the push', () => {
    const result = plan([cli], { published: new Set(), tagged: new Set(), previousVersions: new Map([['@evlog/cli', undefined]]) })
    expect(result.stage).toEqual([cli])
  })

  it('waits on a version an earlier run staged, instead of staging it again', () => {
    const result = plan([evlog], { published: new Set(), tagged: new Set(), previousVersions: new Map([['evlog', '2.35.0']]) })
    expect(result).toEqual({ release: [], stage: [], waiting: [evlog] })
  })

  it('stages every version missing from npm when started by hand', () => {
    const result = plan([evlog, signals], {
      published: new Set(['@evlog/signals@0.2.2']),
      tagged: new Set(['@evlog/signals@0.2.2']),
      previousVersions: null,
    })
    expect(result.stage).toEqual([evlog])
  })

  it('releases a version that is on npm without a tag, and leaves a tagged one alone', () => {
    const result = plan([evlog, signals], {
      published: new Set(['evlog@2.35.0', '@evlog/signals@0.2.2']),
      tagged: new Set(['@evlog/signals@0.2.2']),
      previousVersions: new Map([['evlog', '2.35.0'], ['@evlog/signals', '0.2.2']]),
    })
    expect(result).toEqual({ release: [evlog], stage: [], waiting: [] })
  })
})

describe('stageIdFrom', () => {
  it('reads the stage id under the package name', () => {
    const stdout = JSON.stringify({ '@evlog/cli': { id: '@evlog/cli@0.12.0', stageId: '6f1c1b0e-6c1d-4b1f-9a51-0c1f3c0f9b2a' } })
    expect(stageIdFrom(stdout, '@evlog/cli')).toBe('6f1c1b0e-6c1d-4b1f-9a51-0c1f3c0f9b2a')
  })

  it('throws when npm printed no stage id', () => {
    expect(() => stageIdFrom(JSON.stringify({ '@evlog/cli': { id: '@evlog/cli@0.12.0' } }), '@evlog/cli')).toThrow('no stage id for @evlog/cli')
  })
})

describe('approvalSummary', () => {
  it('lists each staged version with its approve command', () => {
    const summary = approvalSummary({
      staged: [{ ...evlog, tag: 'latest', stageId: 'abc' }],
      waiting: [],
      branch: 'main',
      windowMinutes: 30,
    })
    expect(summary).toContain('| `evlog@2.35.0` | `latest` | `npm stage approve abc --registry=https://registry.npmjs.org/` |')
    expect(summary).toContain('waits 30 minutes')
    expect(summary).toContain('`gh workflow run release.yml --ref main`')
    expect(summary).not.toContain('Waiting for approval')
  })

  it('lists the versions an earlier run staged', () => {
    const summary = approvalSummary({ staged: [], waiting: [cli], branch: 'v3', windowMinutes: 30 })
    expect(summary).toContain('### Waiting for approval')
    expect(summary).toContain('- `@evlog/cli@0.12.0`')
    expect(summary).toContain('`gh workflow run release.yml --ref v3`')
    expect(summary).not.toContain('Staged on npm')
  })

  it('is empty when there is nothing to approve', () => {
    expect(approvalSummary({ staged: [], waiting: [], branch: 'main', windowMinutes: 30 })).toBe('')
  })
})
