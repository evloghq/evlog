import { describe, expect, it } from 'vitest'
import { approvalSummary, distTag, missingDependencies, plan, stagedTagOf, stageIdFrom, waitForApproval, workspaceDependencies } from './lib.mjs'

const evlog = { name: 'evlog', version: '2.35.0', dir: 'packages/evlog', workspaceDependencies: [] }
const telemetry = { name: '@evlog/telemetry', version: '0.4.0', dir: 'packages/telemetry', workspaceDependencies: [] }
const cli = { name: '@evlog/cli', version: '0.12.0', dir: 'packages/cli', workspaceDependencies: ['@evlog/telemetry'] }
const signals = { name: '@evlog/signals', version: '0.2.2', dir: 'packages/signals', workspaceDependencies: [] }

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
  const none = new Set()

  it('stages a version missing from npm that no run staged', () => {
    const result = plan([evlog, signals], {
      published: new Set(['@evlog/signals@0.2.2']),
      tagged: new Set(['@evlog/signals@0.2.2']),
      staged: none,
      manual: false,
    })
    expect(result).toEqual({ release: [], stage: [evlog], waiting: [] })
  })

  it('stages a version a later push sees unstaged, after the run that bumped it failed before staging', () => {
    const result = plan([evlog], { published: none, tagged: none, staged: none, manual: false })
    expect(result.stage).toEqual([evlog])
  })

  it('waits on a version an earlier run staged, instead of staging it again', () => {
    const result = plan([evlog], { published: none, tagged: none, staged: new Set(['evlog@2.35.0']), manual: false })
    expect(result).toEqual({ release: [], stage: [], waiting: [evlog] })
  })

  it('stages every version missing from npm when started by hand, a staged one included', () => {
    const result = plan([evlog, signals], {
      published: new Set(['@evlog/signals@0.2.2']),
      tagged: new Set(['@evlog/signals@0.2.2']),
      staged: new Set(['evlog@2.35.0']),
      manual: true,
    })
    expect(result.stage).toEqual([evlog])
  })

  it('releases a version that is on npm without a tag, and leaves a tagged one alone', () => {
    const result = plan([evlog, signals], {
      published: new Set(['evlog@2.35.0', '@evlog/signals@0.2.2']),
      tagged: new Set(['@evlog/signals@0.2.2']),
      staged: new Set(['evlog@2.35.0']),
      manual: false,
    })
    expect(result).toEqual({ release: [evlog], stage: [], waiting: [] })
  })
})

describe('stagedTagOf', () => {
  it('names the tag after the version, under staged/', () => {
    expect(stagedTagOf(cli)).toBe('staged/@evlog/cli@0.12.0')
  })
})

describe('workspaceDependencies', () => {
  it('lists the packages pinned with a workspace: range, across dependency kinds', () => {
    expect(workspaceDependencies({
      dependencies: { '@evlog/telemetry': 'workspace:*', 'citty': '^0.2.0' },
      peerDependencies: { evlog: 'workspace:^' },
      optionalDependencies: { '@evlog/signals': 'workspace:~' },
    })).toEqual(['@evlog/telemetry', '@evlog/signals', 'evlog'])
  })

  it('is empty for a manifest without dependencies', () => {
    expect(workspaceDependencies({})).toEqual([])
  })
})

describe('missingDependencies', () => {
  const packages = [evlog, telemetry, cli]

  it('names a pinned workspace version that is not on npm', () => {
    expect(missingDependencies(cli, packages, new Set(['evlog@2.35.0']))).toEqual([telemetry])
  })

  it('is empty once the pinned version is on npm', () => {
    expect(missingDependencies(cli, packages, new Set(['@evlog/telemetry@0.4.0']))).toEqual([])
  })

  it('ignores workspace packages the package does not pin', () => {
    expect(missingDependencies(evlog, packages, new Set())).toEqual([])
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

describe('waitForApproval', () => {
  const noWait = async () => {}
  const nothingUnblocked = () => []

  it('reports each version on the poll that first sees it on npm', async () => {
    let poll = 0
    const seen = []
    const pending = await waitForApproval([evlog, cli], {
      isLive: async pkg => pkg === evlog || poll >= 2,
      onApproved: pkg => seen.push([pkg.name, poll]),
      stageUnblocked: nothingUnblocked,
      sleep: async () => { poll += 1 },
      deadline: Number.POSITIVE_INFINITY,
    })
    expect(seen).toEqual([['evlog', 1], ['@evlog/cli', 2]])
    expect(pending).toEqual([])
  })

  it('waits for a version staged once the poll found its dependency on npm', async () => {
    let poll = 0
    const seen = []
    const live = new Set()
    let held = [cli]
    const pending = await waitForApproval([telemetry], {
      isLive: async pkg => live.has(pkg.name) || (pkg === telemetry && poll >= 1) || (pkg === cli && poll >= 3),
      onApproved: (pkg) => {
        seen.push([pkg.name, poll])
        live.add(pkg.name)
      },
      stageUnblocked: () => {
        const ready = held.filter(() => live.has('@evlog/telemetry'))
        held = held.filter(pkg => !ready.includes(pkg))
        return ready
      },
      sleep: async () => { poll += 1 },
      deadline: Number.POSITIVE_INFINITY,
    })
    expect(seen).toEqual([['@evlog/telemetry', 1], ['@evlog/cli', 3]])
    expect(pending).toEqual([])
  })

  it('reports the versions a failed poll found before it throws', async () => {
    const approved = []
    const failure = waitForApproval([cli, evlog], {
      isLive: async (pkg) => {
        if (pkg.name === '@evlog/cli') throw new Error('GET @evlog/cli from npm failed: 503')
        return true
      },
      onApproved: pkg => approved.push(pkg),
      stageUnblocked: nothingUnblocked,
      sleep: noWait,
      deadline: Number.POSITIVE_INFINITY,
    })
    await expect(failure).rejects.toThrow('GET @evlog/cli from npm failed: 503')
    expect(approved).toEqual([evlog])
  })

  it('returns what is still pending at the deadline', async () => {
    let clock = 0
    const pending = await waitForApproval([evlog], {
      isLive: async () => false,
      onApproved: () => { throw new Error('nothing is approved') },
      stageUnblocked: nothingUnblocked,
      sleep: async () => { clock += 1 },
      deadline: 3,
      now: () => clock,
    })
    expect(pending).toEqual([evlog])
    expect(clock).toBe(3)
  })
})

describe('approvalSummary', () => {
  it('lists each staged version with its approve command', () => {
    const summary = approvalSummary({
      staged: [{ ...evlog, tag: 'latest', stageId: 'abc' }],
      waiting: [],
      blocked: [],
      branch: 'main',
      windowMinutes: 30,
    })
    expect(summary).toContain('| `evlog@2.35.0` | `latest` | `npm stage approve abc --registry=https://registry.npmjs.org/` |')
    expect(summary).toContain('waits up to 30 minutes and tags each version once it is approved')
    expect(summary).toContain('`gh workflow run release.yml --ref main`')
    expect(summary).toContain('Approve only the newest stage of a package')
    expect(summary).toContain('`npm stage reject <id> --registry=https://registry.npmjs.org/`')
    expect(summary).not.toContain('Waiting for approval')
  })

  it('lists the versions an earlier run staged', () => {
    const summary = approvalSummary({ staged: [], waiting: [cli], blocked: [], branch: 'v3', windowMinutes: 30 })
    expect(summary).toContain('### Waiting for approval')
    expect(summary).toContain('- `@evlog/cli@0.12.0`')
    expect(summary).toContain('`gh workflow run release.yml --ref v3`')
    expect(summary).not.toContain('Staged on npm')
  })

  it('lists each held version with the versions it pins', () => {
    const summary = approvalSummary({
      staged: [{ ...telemetry, tag: 'latest', stageId: 'def' }],
      waiting: [],
      blocked: [{ pkg: cli, missing: [telemetry] }],
      branch: 'main',
      windowMinutes: 30,
    })
    expect(summary).toContain('### Held until a dependency is on npm')
    expect(summary).toContain('- `@evlog/cli@0.12.0` pins `@evlog/telemetry@0.4.0`')
    expect(summary).toContain('as soon as the versions it pins are on npm')
  })

  it('is empty when there is nothing to approve', () => {
    expect(approvalSummary({ staged: [], waiting: [], blocked: [], branch: 'main', windowMinutes: 30 })).toBe('')
  })
})
