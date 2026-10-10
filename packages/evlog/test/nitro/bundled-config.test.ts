import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'
import nitroV2Module from '../../src/nitro/module'
import nitroV3Module from '../../src/nitro-v3/module'

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

const SILENT_WARNING = 'silent mode is enabled but no drain is configured'

function nitroStub() {
  return {
    options: {
      rootDir: mkdtempSync(join(tmpdir(), 'evlog-bundled-config-')),
      virtual: {} as Record<string, string>,
      plugins: [] as string[],
      errorHandler: undefined as string | string[] | undefined,
      runtimeConfig: {} as Record<string, unknown>,
      replace: {} as Record<string, string>,
    },
  }
}

async function nuxtBundledConfig(options: Record<string, unknown>): Promise<string> {
  const moduleDefinition = (await import('../../src/nuxt/module')).default as unknown as {
    setup: (options: Record<string, unknown>, nuxt: unknown) => void
  }
  const rootDir = mkdtempSync(join(tmpdir(), 'evlog-bundled-config-'))
  const hook = vi.fn()
  moduleDefinition.setup(options, {
    hook,
    options: { dev: false, rootDir, buildDir: join(rootDir, '.nuxt'), runtimeConfig: { public: {} } },
  })
  const [, nitroConfigHook] = hook.mock.calls.find(([name]) => name === 'nitro:config')!
  const nitroConfig: { replace?: Record<string, string> } = {}
  nitroConfigHook(nitroConfig)
  return nitroConfig.replace!.__EVLOG_CONFIG__
}

// The logger initializes itself from the literal the modules bake into the
// bundle as soon as it is imported, before the plugin wires any drain.
function warnsWhenLoggerStartsFrom(literal: string): boolean {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  initLogger(JSON.parse(literal))
  return warn.mock.calls.some(([message]) => String(message).includes(SILENT_WARNING))
}

describe('config baked into a nitro bundle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('nitro v2: a silent app does not warn about a drain before the plugin runs', () => {
    const nitro = nitroStub()
    nitroV2Module({ silent: true }).setup(nitro as never)

    expect(warnsWhenLoggerStartsFrom(nitro.options.replace.__EVLOG_CONFIG__)).toBe(false)
  })

  it('nitro v3: a silent app does not warn about a drain before the plugin runs', () => {
    const nitro = nitroStub()
    nitroV3Module({ silent: true }).setup(nitro as never)

    expect(warnsWhenLoggerStartsFrom(nitro.options.replace.__EVLOG_CONFIG__)).toBe(false)
  })

  it('nuxt: a silent app does not warn about a drain before the plugin runs', async () => {
    const literal = await nuxtBundledConfig({ silent: true })

    expect(warnsWhenLoggerStartsFrom(literal)).toBe(false)
  })

  it('keeps the module options in the literal', () => {
    const nitro = nitroStub()
    nitroV2Module({ env: { service: 'shop' }, silent: true }).setup(nitro as never)

    expect(JSON.parse(nitro.options.replace.__EVLOG_CONFIG__)).toMatchObject({ env: { service: 'shop' }, silent: true })
  })

  it('still warns when an app calls initLogger silent and without a drain', () => {
    expect(warnsWhenLoggerStartsFrom(JSON.stringify({ silent: true }))).toBe(true)
  })
})
