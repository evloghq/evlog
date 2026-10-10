import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import nitroV2Module from '../../src/nitro/module'
import nitroV3Module from '../../src/nitro-v3/module'
import {
  EVLOG_CONFIG_PLUGIN_ID,
  evlogConfigPluginSource,
  findEvlogConfigFile,
  registerEvlogConfigPlugin,
} from '../../src/shared/configPlugin'

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'evlog-config-plugin-'))
}

function touch(file: string, content = 'export default {}\n'): string {
  writeFileSync(file, content)
  return file
}

/** A pnpm workspace with one app at `apps/web`. */
function makeWorkspace(): { root: string, app: string } {
  const root = makeDir()
  touch(join(root, 'package.json'), '{"private":true}')
  touch(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
  const app = join(root, 'apps', 'web')
  mkdirSync(app, { recursive: true })
  touch(join(app, 'package.json'), '{"name":"web"}')
  return { root, app }
}

function makeNitroStub(rootDir: string) {
  return {
    options: {
      rootDir,
      virtual: {} as Record<string, string>,
      plugins: [] as string[],
      errorHandler: undefined as string | string[] | undefined,
      noExternals: undefined as undefined | true | string[],
      runtimeConfig: {} as Record<string, unknown>,
      replace: {} as Record<string, string>,
    },
  }
}

describe('findEvlogConfigFile', () => {
  it('finds the file in the app directory', () => {
    const dir = makeDir()
    const file = touch(join(dir, 'evlog.config.ts'))
    expect(findEvlogConfigFile(dir)).toBe(file)
  })

  it('looks the names up in the same order as the CLI', () => {
    const dir = makeDir()
    touch(join(dir, 'evlog.config.mjs'))
    const ts = touch(join(dir, 'evlog.config.ts'))
    expect(findEvlogConfigFile(dir)).toBe(ts)
  })

  it('falls back to the workspace root config', () => {
    const { root, app } = makeWorkspace()
    const file = touch(join(root, 'evlog.config.ts'))
    expect(findEvlogConfigFile(app)).toBe(file)
  })

  it('prefers the nearest config over the workspace root one', () => {
    const { root, app } = makeWorkspace()
    touch(join(root, 'evlog.config.ts'))
    const own = touch(join(app, 'evlog.config.ts'))
    expect(findEvlogConfigFile(app)).toBe(own)
  })

  it('treats a package.json with a workspaces field as the workspace root', () => {
    const root = makeDir()
    touch(join(root, 'package.json'), '{"workspaces":["apps/*"]}')
    const app = join(root, 'apps', 'web')
    mkdirSync(app, { recursive: true })
    const file = touch(join(root, 'evlog.config.mjs'))
    expect(findEvlogConfigFile(app)).toBe(file)
  })

  it('does not look above the workspace root', () => {
    const outer = makeDir()
    touch(join(outer, 'evlog.config.ts'))
    const root = join(outer, 'repo')
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })
    touch(join(root, 'package.json'), '{"private":true}')
    touch(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    expect(findEvlogConfigFile(join(root, 'apps', 'web'))).toBeUndefined()
  })

  it('only searches the app directory outside a workspace', () => {
    const outer = makeDir()
    touch(join(outer, 'evlog.config.ts'))
    const app = join(outer, 'app')
    mkdirSync(app)
    expect(findEvlogConfigFile(app)).toBeUndefined()
  })
})

describe('evlogConfigPluginSource', () => {
  it('imports the file and hands its default export over through the global slot', () => {
    expect(evlogConfigPluginSource('/app/evlog.config.ts')).toBe([
      'import config from "/app/evlog.config.ts"',
      'globalThis[Symbol.for("evlog.config.file")] = config',
      'export default function evlogConfig() {}',
      '',
    ].join('\n'))
  })

  it('writes Windows paths with forward slashes', () => {
    const source = evlogConfigPluginSource('C:\\app\\evlog.config.ts')
    expect(source).toContain('"C:/app/evlog.config.ts"')
    expect(source).not.toMatch(/\\/)
  })
})

describe('registerEvlogConfigPlugin', () => {
  it('leaves Nitro untouched when the app has no config', () => {
    const nitro = makeNitroStub(makeDir())
    expect(registerEvlogConfigPlugin(nitro)).toBeUndefined()
    expect(nitro.options.plugins).toEqual([])
    expect(nitro.options.virtual).toEqual({})
  })

  it('registers the virtual plugin first, before plugins already registered', () => {
    const dir = makeDir()
    const file = touch(join(dir, 'evlog.config.ts'))
    const nitro = makeNitroStub(dir)
    nitro.options.plugins.push('/evlog/nitro/plugin')

    expect(registerEvlogConfigPlugin(nitro)).toBe(file)
    expect(nitro.options.plugins).toEqual([EVLOG_CONFIG_PLUGIN_ID, '/evlog/nitro/plugin'])
    expect(nitro.options.virtual[EVLOG_CONFIG_PLUGIN_ID]).toBe(evlogConfigPluginSource(file))
  })

  it.each([
    ['nitro v2', nitroV2Module],
    ['nitro v3', nitroV3Module],
  ])('is called by the %s module', (_name, module) => {
    const dir = makeDir()
    touch(join(dir, 'evlog.config.ts'))
    const nitro = makeNitroStub(dir)
    module({}).setup(nitro as never)

    expect(nitro.options.plugins[0]).toBe(EVLOG_CONFIG_PLUGIN_ID)
    expect(nitro.options.plugins[1]).toMatch(/\/plugin$/)
  })
})
