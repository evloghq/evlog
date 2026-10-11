import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addServerPlugin } from '@nuxt/kit'
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

/** Runs the module's setup against a fake Nuxt and returns that Nuxt. */
async function setupModule(rootDir: string) {
  const moduleDefinition = (await import('../../src/nuxt/module')).default as unknown as {
    setup: (options: Record<string, unknown>, nuxt: unknown) => void
  }
  const nuxt = {
    hook: vi.fn(),
    options: { dev: false, rootDir, buildDir: join(rootDir, '.nuxt'), runtimeConfig: { public: {} as Record<string, unknown> } },
  }
  moduleDefinition.setup({}, nuxt)
  return nuxt
}

/** Runs the module's setup against a fake Nuxt and returns the handler it registered for `name`. */
async function registeredHook(name: string, rootDir: string): Promise<(...args: unknown[]) => void> {
  const { hook } = await setupModule(rootDir)
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

  it('registers the server plugin that hands the browser settings of the file to the client', async () => {
    await registeredHook('nitro:init', appWithConfig())

    expect(vi.mocked(addServerPlugin)).toHaveBeenCalledWith('../runtime/server/public-config')
  })

  it('leaves the browser settings nuxt.config.ts does not set for the file to fill', async () => {
    const nuxt = await setupModule(appWithConfig())

    expect(nuxt.options.runtimeConfig.public.evlog).toMatchObject({ enabled: undefined, pretty: undefined, minLevel: undefined })
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
