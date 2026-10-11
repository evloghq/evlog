import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../bin/evlog.mjs', import.meta.url))
const run = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-bin-'))
  tempDirs.push(dir)
  return dir
}

/* A stand-in @evlog/cli: its entry prints which copy ran and the arguments it got. */
async function fakeCli(root: string, label: string): Promise<void> {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'cli.mjs'), `console.log(${JSON.stringify(label)}, process.argv.slice(2).join(' '))\n`)
  await writeFile(join(root, 'dist', 'index.mjs'), 'export {}\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: '@evlog/cli',
    version: '0.0.0',
    type: 'module',
    exports: { '.': { types: './dist/index.d.mts', import: './dist/index.mjs', default: './dist/index.mjs' } },
    bin: { evlog: './bin/evlog.mjs' },
  }))
  await mkdir(join(root, 'bin'), { recursive: true })
  await cp(bin, join(root, 'bin', 'evlog.mjs'))
}

/* The global copy: this file's bin, with its own dist, somewhere no project resolves from. */
async function globalCopy(parent: string): Promise<string> {
  const root = join(parent, 'global', 'lib', '@evlog', 'cli')
  await fakeCli(root, 'GLOBAL')
  return join(root, 'bin', 'evlog.mjs')
}

async function evlog(shim: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await run(process.execPath, [shim, ...args], { cwd })
  return stdout.trim()
}

describe('evlog cli bin', () => {
  it('runs the global copy when the project has no install', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent)
    const project = join(parent, 'project')
    await mkdir(project)
    await writeFile(join(project, 'package.json'), '{"name":"app"}')

    expect(await evlog(shim, ['map', '--json'], project)).toBe('GLOBAL map --json')
  })

  it('hands off to the copy installed in the project', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent)
    const project = join(parent, 'project')
    await mkdir(project)
    await writeFile(join(project, 'package.json'), '{"name":"app"}')
    await fakeCli(join(project, 'node_modules', '@evlog', 'cli'), 'LOCAL')

    expect(await evlog(shim, ['doctor'], project)).toBe('LOCAL doctor')
  })

  it('finds the install from a workspace package through hoisting', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent)
    const workspace = join(parent, 'workspace')
    const app = join(workspace, 'packages', 'app')
    await mkdir(app, { recursive: true })
    await writeFile(join(app, 'package.json'), '{"name":"app"}')
    await fakeCli(join(workspace, 'node_modules', '@evlog', 'cli'), 'HOISTED')

    expect(await evlog(shim, ['map'], app)).toBe('HOISTED map')
  })

  it('runs its own copy once when the project install is that same copy', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent)
    const project = join(parent, 'project')
    await mkdir(join(project, 'node_modules', '@evlog'), { recursive: true })
    await writeFile(join(project, 'package.json'), '{"name":"app"}')
    await symlink(join(parent, 'global', 'lib', '@evlog', 'cli'), join(project, 'node_modules', '@evlog', 'cli'))

    expect(await evlog(shim, ['--version'], project)).toBe('GLOBAL --version')
  })

  it('runs the project copy once when that copy is also the new bin', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent)
    const project = join(parent, 'project')
    await mkdir(project)
    await writeFile(join(project, 'package.json'), '{"name":"app"}')
    await fakeCli(join(project, 'node_modules', '@evlog', 'cli'), 'LOCAL')

    expect(await evlog(join(project, 'node_modules', '@evlog', 'cli', 'bin', 'evlog.mjs'), ['init'], project)).toBe('LOCAL init')
    expect(await evlog(shim, ['init'], project)).toBe('LOCAL init')
  })
})
