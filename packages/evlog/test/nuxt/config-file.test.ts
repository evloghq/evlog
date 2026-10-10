import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EVLOG_CONFIG_PLUGIN_ID } from '../../src/shared/configPlugin'

vi.mock('@nuxt/kit', () => ({
  addImports: vi.fn(),
  addPlugin: vi.fn(),
  addServerHandler: vi.fn(),
  addServerImports: vi.fn(),
  addServerPlugin: vi.fn(),
  addTypeTemplate: vi.fn(),
  addVitePlugin: vi.fn(),
  createResolver: vi.fn(() => ({ resolve: (path: string) => path })),
  defineNuxtModule: (definition: { setup: (options: unknown, nuxt: unknown) => unknown }) => definition,
}))

/** Runs the module's setup against a fake Nuxt and returns the handler it registered for `name`. */
async function registeredHook(name: string, rootDir: string): Promise<(...args: unknown[]) => void> {
  const moduleDefinition = (await import('../../src/nuxt/module')).default as unknown as {
    setup: (options: Record<string, unknown>, nuxt: unknown) => void
  }
  const hook = vi.fn()
  moduleDefinition.setup({}, {
    hook,
    options: { dev: false, rootDir, buildDir: join(rootDir, '.nuxt'), runtimeConfig: { public: {} } },
  })
  const call = hook.mock.calls.find(([hookName]) => hookName === name)
  if (!call) throw new Error(`the module registers no ${name} hook`)
  return call[1]
}

function appWithConfig(): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'evlog-nuxt-config-'))
  writeFileSync(join(rootDir, 'evlog.config.ts'), 'export default {}\n')
  return rootDir
}

describe('nuxt module and evlog.config.ts', () => {
  it('loads the file into the server once Nitro options are resolved', async () => {
    const rootDir = appWithConfig()
    const nitroInit = await registeredHook('nitro:init', rootDir)

    const nitro = { options: { rootDir, plugins: ['/evlog/nitro/plugin'], virtual: {} as Record<string, string> } }
    nitroInit(nitro)

    expect(nitro.options.plugins).toEqual([EVLOG_CONFIG_PLUGIN_ID, '/evlog/nitro/plugin'])
    expect(nitro.options.virtual[EVLOG_CONFIG_PLUGIN_ID]).toContain(join(rootDir, 'evlog.config.ts'))
  })

  it('adds the file to the tsconfig nuxt.config.ts is checked with', async () => {
    const prepareTypes = await registeredHook('prepare:types', appWithConfig())

    const nodeTsConfig: { include?: string[] } = { include: ['../nuxt.config.*'] }
    prepareTypes({ nodeTsConfig })

    expect(nodeTsConfig.include).toEqual(['../nuxt.config.*', '../evlog.config.ts'])
  })

  it('leaves the tsconfig alone when the app has no config file', async () => {
    const prepareTypes = await registeredHook('prepare:types', mkdtempSync(join(tmpdir(), 'evlog-nuxt-config-')))

    const nodeTsConfig: { include?: string[] } = { include: ['../nuxt.config.*'] }
    prepareTypes({ nodeTsConfig })

    expect(nodeTsConfig.include).toEqual(['../nuxt.config.*'])
  })
})
