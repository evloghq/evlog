import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import init from '../src/commands/init'
import { findWorkspaceApps } from '../src/lib/init/workspace'

/* What Windows answers, on a file system this suite can read: `relative`
   returns backslashes and `sep` is one, while `join` and the rest stay real. */
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual, relative: actual.win32.relative, sep: actual.win32.sep }
})

const tempDirs: string[] = []

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-workspace-'))
  tempDirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    const target = join(dir, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return dir
}

const WORKSPACE = {
  'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
  'package.json': JSON.stringify({ name: 'mono', private: true }),
  'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { nuxt: '^4.0.0' } }),
  'apps/api/package.json': JSON.stringify({ type: 'module', dependencies: { hono: '^4.0.0' } }),
}

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('a workspace where the path separator is a backslash', () => {
  it('labels each app with forward slashes', async () => {
    const root = await workspace(WORKSPACE)

    const apps = findWorkspaceApps({
      cwd: root,
      packageDir: root,
      root,
      kind: 'pnpm',
      packageName: 'mono',
      packageJson: { name: 'mono' },
    })

    expect(apps.map(app => [app.name, app.label])).toEqual([['apps/api', 'apps/api'], ['web', 'apps/web']])
  })

  it.each(['apps/web', 'apps\\web'])('sets up the app --apps names as %s', async (value) => {
    const root = await workspace(WORKSPACE)
    const stdout: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write)

    await runCommand(init, { rawArgs: ['--cwd', root, '--no-header', '--json', '--yes', '--dry-run', '--no-agents', '--no-install', '--apps', value] })

    expect(JSON.parse(stdout.join('')).apps.map((app: { app: string }) => app.app)).toEqual(['apps/web'])
  })
})
