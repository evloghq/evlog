import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { version as evlogVersion } from '../../evlog/package.json'
import pkg from '../package.json'

const bin = fileURLToPath(new URL('../bin/evlog.mjs', import.meta.url))
const run = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  /* Resolved, so a path the bin prints can be compared where the temp directory is a link. */
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'evlog-cli-bin-')))
  tempDirs.push(dir)
  return dir
}

interface FakeOptions {
  /** `engines.node` of the stand-in. */
  node?: string
  /** The evlog installed next to the stand-in, or `null` for none. */
  evlog?: string | null
}

/* A stand-in @evlog/cli: its entry prints which copy ran and the arguments it
   got. It declares the ranges the real package does, next to an evlog that
   meets them. */
async function fakeCli(root: string, label: string, options: FakeOptions = {}): Promise<void> {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'cli.mjs'), `console.log(${JSON.stringify(label)}, process.argv.slice(2).join(' '))\n`)
  await writeFile(join(root, 'dist', 'index.mjs'), 'export {}\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: '@evlog/cli',
    version: '0.0.0',
    type: 'module',
    exports: { '.': { types: './dist/index.d.mts', import: './dist/index.mjs', default: './dist/index.mjs' } },
    bin: { evlog: './bin/evlog.mjs' },
    engines: { node: options.node ?? pkg.engines.node },
    peerDependencies: pkg.peerDependencies,
  }))
  await mkdir(join(root, 'bin'), { recursive: true })
  await cp(bin, join(root, 'bin', 'evlog.mjs'))
  if (options.evlog === null) return
  /* Laid out like the published package, whose older versions export no `./package.json`. */
  const evlog = join(root, 'node_modules', 'evlog')
  await mkdir(join(evlog, 'dist'), { recursive: true })
  await writeFile(join(evlog, 'dist', 'index.mjs'), 'export {}\n')
  await writeFile(join(evlog, 'package.json'), JSON.stringify({
    name: 'evlog',
    version: options.evlog ?? evlogVersion,
    type: 'module',
    exports: { '.': { import: './dist/index.mjs', default: './dist/index.mjs' } },
  }))
}

/* The global copy: this file's bin, with its own dist, somewhere no project resolves from. */
async function globalCopy(parent: string, options: FakeOptions = {}): Promise<string> {
  const root = join(parent, 'global', 'lib', '@evlog', 'cli')
  await fakeCli(root, 'GLOBAL', options)
  return join(root, 'bin', 'evlog.mjs')
}

async function evlog(shim: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await run(process.execPath, [shim, ...args], { cwd })
  return stdout.trim()
}

/* A run that is expected to stop: what it wrote and the code it exited with. */
async function refused(shim: string, args: string[], cwd: string): Promise<{ code: number, stdout: string, stderr: string }> {
  const result = await run(process.execPath, [shim, ...args], { cwd }).then(
    ok => ({ code: 0, ...ok }),
    (error: { code: number, stdout: string, stderr: string }) => error,
  )
  return { code: result.code, stdout: result.stdout, stderr: result.stderr }
}

async function emptyProject(parent: string): Promise<string> {
  const project = join(parent, 'project')
  await mkdir(project)
  await writeFile(join(project, 'package.json'), '{"name":"app"}')
  return project
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

  it('runs its own copy in a project whose package.json does not parse', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent)
    const project = join(parent, 'project')
    await mkdir(project)
    await writeFile(join(project, 'package.json'), '{ "name": "app", ')

    expect(await evlog(shim, ['doctor'], project)).toBe('GLOBAL doctor')
  })

  it('stops with one line on a Node.js older than the one it needs', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent, { node: '>=99.1.0' })

    const result = await refused(shim, ['map', '--json'], await emptyProject(parent))

    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: `@evlog/cli needs Node.js 99.1.0 or later, and this is Node.js ${process.versions.node}\n`,
    })
  })

  it('stops with one line when the evlog next to it is older than the one it needs', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent, { evlog: '2.9.0' })
    const needed = pkg.peerDependencies.evlog.slice(2)

    const result = await refused(shim, ['doctor'], await emptyProject(parent))

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.split('\n')).toEqual([
      `@evlog/cli 0.0.0 needs evlog ${needed} or later, and the one it loads is evlog 2.9.0 (${join(parent, 'global', 'lib', '@evlog', 'cli', 'node_modules', 'evlog')})`,
      '→ Update it, then run the command again',
      '',
    ])
  })

  it('stops with one line when no evlog is installed next to it', async () => {
    const parent = await tempDir()
    const shim = await globalCopy(parent, { evlog: null })

    const result = await refused(shim, ['doctor'], await emptyProject(parent))

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.split('\n')).toEqual([
      `@evlog/cli 0.0.0 needs evlog ${pkg.peerDependencies.evlog.slice(2)} or later, and none is installed next to it`,
      '→ Install evlog where @evlog/cli is installed, then run the command again',
      '',
    ])
  })

  /* A later minor with more digits and a prerelease of a later major: text
     order and a missing prerelease rule would both refuse them. */
  it.each(['2.100.0', '99.0.0-beta.2'])('runs next to evlog %s', async (version) => {
    const parent = await tempDir()
    const shim = await globalCopy(parent, { evlog: version })

    expect(await evlog(shim, ['doctor'], await emptyProject(parent))).toBe('GLOBAL doctor')
  })
})
