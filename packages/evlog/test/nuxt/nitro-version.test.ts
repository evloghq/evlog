import { beforeEach, describe, expect, it, vi } from 'vitest'

const addImports = vi.fn()
const addPlugin = vi.fn()
const addServerHandler = vi.fn()
const addServerImports = vi.fn()
const addServerPlugin = vi.fn()
const addTypeTemplate = vi.fn()
const addVitePlugin = vi.fn()
const createResolver = vi.fn(() => ({ resolve: (path: string) => path }))
const getNitroVersion = vi.fn()

vi.mock('@nuxt/kit', () => ({
  addImports,
  addPlugin,
  addServerHandler,
  addServerImports,
  addServerPlugin,
  addTypeTemplate,
  addVitePlugin,
  createResolver,
  defineNuxtModule: (definition: { setup: (options: unknown, nuxt: unknown) => unknown }) => definition,
  getNitroVersion,
}))

function makeFakeNuxt() {
  return {
    hook: vi.fn(),
    options: {
      dev: false,
      rootDir: process.cwd(),
      buildDir: process.cwd(),
      runtimeConfig: {
        public: {},
      },
    },
  }
}

async function setupModule() {
  const moduleDefinition = (await import('../../src/nuxt/module')).default as unknown as {
    setup: (options: Record<string, unknown>, nuxt: ReturnType<typeof makeFakeNuxt>) => void
  }
  const nuxt = makeFakeNuxt()
  moduleDefinition.setup({}, nuxt)
  return nuxt
}

async function nitroConfigHook() {
  const nuxt = await setupModule()
  const call = nuxt.hook.mock.calls.find(([hookName]) => hookName === 'nitro:config')
  if (!call) throw new Error('the module registers no nitro:config hook')
  return call[1] as (nitroConfig: { errorHandler?: string | string[] }) => void
}

describe('nuxt module nitro version selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the Nitro v3 error handler and plugin on Nitro 3', async () => {
    getNitroVersion.mockReturnValue(3)
    const hook = await nitroConfigHook()

    const nitroConfig: { errorHandler?: string | string[] } = {}
    hook(nitroConfig)

    expect(nitroConfig.errorHandler).toBe('../nitro/v3/errorHandler')
    expect(addServerPlugin).toHaveBeenCalledWith('../nitro/v3/plugin')
  })

  it('registers the Nitro v2 error handler and plugin on Nitro 2', async () => {
    getNitroVersion.mockReturnValue(2)
    const hook = await nitroConfigHook()

    const nitroConfig: { errorHandler?: string | string[] } = {}
    hook(nitroConfig)

    expect(nitroConfig.errorHandler).toBe('../nitro/errorHandler')
    expect(addServerPlugin).toHaveBeenCalledWith('../nitro/plugin')
  })

  it('falls back to the Nitro v2 paths when the Nitro version is undetectable', async () => {
    getNitroVersion.mockReturnValue(undefined)
    const hook = await nitroConfigHook()

    const nitroConfig: { errorHandler?: string | string[] } = {}
    hook(nitroConfig)

    expect(nitroConfig.errorHandler).toBe('../nitro/errorHandler')
    expect(addServerPlugin).toHaveBeenCalledWith('../nitro/plugin')
  })
})
