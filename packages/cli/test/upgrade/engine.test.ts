import { describe, expect, it } from 'vitest'
import { applyEdits, migrate } from '../../src/lib/upgrade/engine'
import type { MigrateInput } from '../../src/lib/upgrade/engine'
import { MIGRATIONS } from '../../src/lib/upgrade/migrations'
import { hunks } from '../../src/lib/upgrade/report'
import { moveModules } from '../../src/lib/upgrade/rename-modules'
import type { Codemod, Migration, UpgradeFinding } from '../../src/lib/upgrade/types'
import { majorOfRange, startingMajor } from '../../src/lib/upgrade/version'

function run(overrides: Partial<MigrateInput>) {
  return migrate({ files: new Map(), packageJson: null, migrations: MIGRATIONS, from: 2, prerelease: false, ...overrides })
}

const pkg = (body: object) => ({ file: 'package.json', source: `${JSON.stringify(body, null, 2)}\n` })

describe('migrate', () => {
  it('chains migrations, each reading the previous one\'s output', () => {
    const v4: Migration = { to: 4, codemods: [moveModules('v4/http-to-web', { 'evlog/http': { to: 'evlog/web', exports: { createHttpDrain: 'createWebDrain' } } })] }
    const result = run({
      files: new Map([['app.ts', `import { createBrowserDrain } from 'evlog/browser'\ncreateBrowserDrain({})\n`]]),
      packageJson: pkg({ dependencies: { evlog: '^2.33.1' } }),
      migrations: [...MIGRATIONS, v4],
    })

    expect(result.to).toBe(4)
    expect(result.files.get('app.ts')!.at(-1)!.after).toBe(`import { createWebDrain } from 'evlog/web'\ncreateWebDrain({})\n`)
    expect(JSON.parse(result.files.get('package.json')!.at(-1)!.after).dependencies.evlog).toBe('^4.0.0')
    expect(result.files.get('app.ts')!.map(step => step.to)).toEqual([3, 4])
  })

  it('skips migrations at or below the starting major', () => {
    const result = run({ files: new Map([['app.ts', `import evlog from 'evlog/nitro'\n`]]), from: 3 })
    expect(result.to).toBe(3)
    expect(result.findings).toEqual([])
  })

  it('never parses a file that contains no needle', () => {
    const codemod: Codemod = { id: 'v3/spy', needles: ['evlog/browser'], create: () => {
      throw new Error('parsed') 
    } }
    expect(run({ files: new Map([['app.ts', 'export const x = 1\n']]), migrations: [{ to: 3, codemods: [codemod] }] }).findings).toEqual([])
  })

  it('reports a file it cannot parse instead of editing it', () => {
    const [finding] = run({ files: new Map([['broken.ts', `import evlog from 'evlog/nitro'\nconst = \n`]]) }).findings
    expect(finding).toMatchObject({ id: 'v3/unparsed', file: 'broken.ts', mode: 'report' })
  })

  it('reports lines and columns in the .vue file, not in its script block', () => {
    const source = `<template>\n  <div />\n</template>\n<script setup>\nimport { useLogger } from 'evlog/nitro/v3'\n</script>\n`
    const [finding] = run({ files: new Map([['App.vue', source]]) }).findings
    expect(finding).toMatchObject({ line: 5, column: 0 })
  })
})

describe('applyEdits', () => {
  const finding = (id: string, start: number, end: number, text: string): UpgradeFinding =>
    ({ id, file: 'a.ts', line: 1, column: start, mode: 'auto', message: '', docsUrl: '', edits: [{ start, end, text }] })

  it('applies edits from several findings in one pass', () => {
    expect(applyEdits('a.ts', 'abcdef', [finding('v3/x', 4, 5, 'E'), finding('v3/y', 0, 1, 'A')])).toBe('AbcdEf')
  })

  it('throws when two codemods edit the same code', () => {
    expect(() => applyEdits('a.ts', 'abcdef', [finding('v3/x', 0, 3, 'X'), finding('v3/y', 2, 4, 'Y')]))
      .toThrow('upgrade: v3/x and v3/y both edit a.ts at offset 2')
  })
})

describe('package.json', () => {
  it('bumps every dependency field that declares evlog, and leaves a script named evlog alone', () => {
    const result = run({ packageJson: pkg({ scripts: { evlog: 'evlog map' }, dependencies: { evlog: '^2.33.1' }, peerDependencies: { evlog: '>=2.31.0' } }) })
    const after = JSON.parse(result.files.get('package.json')!.at(-1)!.after)
    expect(after).toMatchObject({ scripts: { evlog: 'evlog map' }, dependencies: { evlog: '^3.0.0' }, peerDependencies: { evlog: '^3.0.0' } })
  })

  it('writes a prerelease range from a prerelease CLI', () => {
    const result = run({ packageJson: pkg({ dependencies: { evlog: '~2.33.1' } }), prerelease: true })
    expect(JSON.parse(result.files.get('package.json')!.at(-1)!.after).dependencies.evlog).toBe('^3.0.0-0')
  })

  it('reports a range that names no version', () => {
    const [finding] = run({ packageJson: pkg({ dependencies: { evlog: 'catalog:' } }) }).findings
    expect(finding).toMatchObject({ id: 'v3/evlog-version', mode: 'report', line: 3 })
  })
})

describe('version', () => {
  it('reads the lowest major a range allows', () => {
    expect(majorOfRange('^2.33.1')).toBe(2)
    expect(majorOfRange('>=2.31.0 <4')).toBe(2)
    expect(majorOfRange('npm:evlog@3.0.0-beta.2')).toBe(3)
    expect(majorOfRange('workspace:*')).toBeNull()
    expect(majorOfRange('catalog:')).toBeNull()
  })

  it('prefers the declared range over the installed version, which an upgrade bumps before any reinstall', () => {
    expect(startingMajor({ dependencies: { evlog: '^3.0.0' } }, '2.33.1')).toBe(3)
    expect(startingMajor({ dependencies: { evlog: 'workspace:*' } }, '2.33.1')).toBe(2)
    expect(startingMajor({}, undefined)).toBeNull()
  })
})

describe('hunks', () => {
  it('shows each touched line once with all of its edits', () => {
    const source = `import { a } from 'x'\nconst b = a\n`
    expect(hunks(source, [{ start: 9, end: 10, text: 'c' }, { start: 19, end: 20, text: 'y' }])).toEqual([{ line: 1, before: [`import { a } from 'x'`], after: [`import { c } from 'y'`] },])
  })
})
