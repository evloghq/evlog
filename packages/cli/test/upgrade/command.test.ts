import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import upgrade from '../../src/commands/upgrade'
import { runUpgrade, UPGRADE_SCHEMA_VERSION } from '../../src/lib/upgrade/run'

const tempDirs: string[] = []

/** A 2.x app with one file for each v3 codemod. */
const EVLOG_2_APP = {
  'package.json': `${JSON.stringify({ name: 'shop', dependencies: { evlog: '^2.33.1', nitro: '^3.0.0' } }, null, 2)}\n`,
  'nitro.config.ts': `import { defineConfig } from 'nitro'\nimport evlog from 'evlog/nitro/v3'\n\nexport default defineConfig({ modules: [evlog()] })\n`,
  'app/drain.ts': `import { createBrowserDrain } from 'evlog/browser'\n\nexport const drain = createBrowserDrain({ endpoint: '/_evlog' })\n`,
  'app/legacy.ts': `export const plugin = 'evlog/nitro'\n`,
}

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-upgrade-'))
  tempDirs.push(dir)
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(join(dir, file)), { recursive: true })
    await writeFile(join(dir, file), contents)
  }
  return dir
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' })
}

function silence(): { stdout: () => string, stderr: () => string } {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  return {
    stdout: () => stdout.mock.calls.map(([chunk]) => String(chunk)).join(''),
    stderr: () => stderr.mock.calls.map(([chunk]) => String(chunk)).join(''),
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('runUpgrade', () => {
  it('changes nothing on a dry run and lists every finding', async () => {
    const cwd = await project(EVLOG_2_APP)
    const { report } = await runUpgrade({ cwd, write: false, force: false, prerelease: false })

    expect(report).toMatchObject({ schemaVersion: UPGRADE_SCHEMA_VERSION, from: 2, to: 3, write: false, summary: { auto: 3, report: 1 } })
    expect(report.files.sort()).toEqual(['app/drain.ts', 'nitro.config.ts', 'package.json'])
    expect(report.findings.find(finding => finding.file === 'app/legacy.ts')).toMatchObject({
      id: 'v3/nitro-subpaths',
      mode: 'report',
      fixed: false,
      line: 1,
      docsUrl: 'https://evlog.dev/migrate/v3#nitro-subpaths',
    })
    expect(await readFile(join(cwd, 'nitro.config.ts'), 'utf8')).toBe(EVLOG_2_APP['nitro.config.ts'])
  })

  it('writes the fixes, and a second run finds nothing to do', async () => {
    const cwd = await project(EVLOG_2_APP)
    await runUpgrade({ cwd, write: true, force: false, prerelease: false })

    expect(await readFile(join(cwd, 'nitro.config.ts'), 'utf8')).toContain(`import evlog from 'evlog/nitro'\n`)
    expect(await readFile(join(cwd, 'app/drain.ts'), 'utf8')).toBe(`import { createHttpDrain } from 'evlog/http'\n\nexport const drain = createHttpDrain({ endpoint: '/_evlog' })\n`)
    expect(JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')).dependencies.evlog).toBe('^3.0.0')

    const again = await runUpgrade({ cwd, write: true, force: false, prerelease: false })
    expect(again.report).toMatchObject({ from: 3, to: 3, findings: [], files: [] })
    expect(await readFile(join(cwd, 'nitro.config.ts'), 'utf8')).toContain(`import evlog from 'evlog/nitro'\n`)
  })

  it('refuses to write over uncommitted changes unless forced', async () => {
    const cwd = await project(EVLOG_2_APP)
    git(cwd, 'init', '-q')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-qm', 'init')
    await writeFile(join(cwd, 'app/new.ts'), 'export {}\n')

    await expect(runUpgrade({ cwd, write: true, force: false })).rejects.toMatchObject({ code: 'cli.UPGRADE_DIRTY_TREE' })
    await expect(runUpgrade({ cwd, write: false, force: false })).resolves.toBeDefined()
    await expect(runUpgrade({ cwd, write: true, force: true })).resolves.toBeDefined()
  })

  it('needs an evlog version to start from', async () => {
    const cwd = await project({ 'package.json': JSON.stringify({ name: 'shop' }) })
    await expect(runUpgrade({ cwd, write: false, force: false })).rejects.toMatchObject({ code: 'cli.UPGRADE_NO_EVLOG' })
  })
})

describe('evlog upgrade', () => {
  it('prints each fix with its lines and exits 1 on a dry run with findings', async () => {
    const cwd = await project(EVLOG_2_APP)
    const out = silence()

    await runCommand(upgrade, { rawArgs: ['--cwd', cwd, '--no-header'] })

    expect(process.exitCode).toBe(1)
    expect(out.stderr()).toContain(`2 - import evlog from 'evlog/nitro/v3'\n    2 + import evlog from 'evlog/nitro'`)
    expect(out.stderr()).toContain('Run with --write to apply.')
  })

  it('exits 1 after --write while report-only findings remain, and 0 once there is nothing to do', async () => {
    const cwd = await project(EVLOG_2_APP)
    silence()

    await runCommand(upgrade, { rawArgs: ['--cwd', cwd, '--no-header', '--write', '--json'] })
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    await runCommand(upgrade, { rawArgs: ['--cwd', cwd, '--no-header', '--write'] })
    expect(process.exitCode).toBe(0)
  })

  it('prints the report as JSON on stdout', async () => {
    const cwd = await project(EVLOG_2_APP)
    const out = silence()

    await runCommand(upgrade, { rawArgs: ['--cwd', cwd, '--no-header', '--json'] })

    const json = JSON.parse(out.stdout())
    expect(json).toMatchObject({ schemaVersion: 1, from: 2, to: 3, write: false })
    expect(json.findings[0]).not.toHaveProperty('edits')
  })
})
