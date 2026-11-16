import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression test for https://github.com/evloghq/evlog/issues/435
//
// `nuxt typecheck` (vue-tsc -b) type-checks the app tsconfig project *and*
// the server one. `$fetch`'s return-type inference does
// `typeof import('../../server/api/...')`, which pulls every server route
// (and therefore the auto-imported server globals it uses) into the app
// project's typecheck too. `useLogger` and `createEvlogError` must
// therefore be declared on both the `nitro` context (server tsconfig) and
// the `nuxt` context (app tsconfig) — declaring them on `nitro` alone
// leaves the app project unable to resolve them, causing a
// `TS2304: Cannot find name` failure.
//
// `log` is the one exception: it is declared globally by *both* the
// client type template (`typeof import('evlog/client').log`) and the
// server one (`typeof import('evlog').log`) — two different types sharing
// one global name. The app tsconfig project already declares the client
// `log` (evlog-client.d.ts, nuxt-only). If the server `log` were also
// exposed there, the two ambient declarations would collide. Because
// Nuxt's generated tsconfigs set `skipLibCheck: true`, TypeScript doesn't
// error on that collision — it silently keeps whichever declaration it
// resolves first, so the server `log` template must stay nitro-only.

const addTypeTemplate = vi.fn()
const addImports = vi.fn()
const addServerImports = vi.fn()
const addServerHandler = vi.fn()
const addServerPlugin = vi.fn()
const addPlugin = vi.fn()
const addVitePlugin = vi.fn()
const createResolver = vi.fn(() => ({ resolve: (path: string) => path }))

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
  getNitroVersion: vi.fn(),
}))

function makeFakeNuxt() {
  return {
    hook: vi.fn(),
    options: {
      dev: false,
      runtimeConfig: {
        public: {},
      },
    },
  }
}

function findTemplateCall(filename: string) {
  return addTypeTemplate.mock.calls.find(([template]) => template?.filename === filename)
}

describe('nuxt module server type templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers useLogger/createEvlogError for both the nitro and the app (nuxt) tsconfig projects', async () => {
    const moduleDefinition = (await import('../../src/nuxt/module')).default as unknown as {
      setup: (options: Record<string, unknown>, nuxt: ReturnType<typeof makeFakeNuxt>) => void
    }

    moduleDefinition.setup({}, makeFakeNuxt())

    const serverTemplateCall = findTemplateCall('types/evlog-server.d.ts')
    expect(serverTemplateCall).toBeDefined()

    const [template, context] = serverTemplateCall!
    // `nitro: true` alone only reaches `.nuxt/tsconfig.server.json` — the app
    // project (`.nuxt/tsconfig.app.json`) never sees the declaration and
    // `useLogger`/`createEvlogError` resolve to TS2304 there.
    expect(context).toEqual({ nitro: true, nuxt: true })

    const contents = template.getContents()
    expect(contents).toContain('const useLogger: typeof import(\'evlog\').useLogger')
    expect(contents).toContain('const createEvlogError: typeof import(\'evlog\').createEvlogError')
    // `log` must NOT be declared here — see module comment above.
    expect(contents).not.toContain('const log:')
  })

  it('keeps the server-scoped `log` global nitro-only, separate from the client `log`', async () => {
    const moduleDefinition = (await import('../../src/nuxt/module')).default as unknown as {
      setup: (options: Record<string, unknown>, nuxt: ReturnType<typeof makeFakeNuxt>) => void
    }

    moduleDefinition.setup({}, makeFakeNuxt())

    const serverLogTemplateCall = findTemplateCall('types/evlog-server-log.d.ts')
    expect(serverLogTemplateCall).toBeDefined()

    const [template, context] = serverLogTemplateCall!
    // Must stay nitro-only: adding `nuxt: true` would make this collide
    // with the client `log` declared in evlog-client.d.ts (already
    // registered nuxt-only, by default) in the app tsconfig project.
    expect(context).toEqual({ nitro: true })
    expect(template.getContents()).toContain('const log: typeof import(\'evlog\').log')

    const clientTemplateCall = findTemplateCall('types/evlog-client.d.ts')
    expect(clientTemplateCall).toBeDefined()
    const [clientTemplate, clientContext] = clientTemplateCall!
    // No explicit context passed → nuxt-only by @nuxt/kit's default.
    expect(clientContext).toBeUndefined()
    expect(clientTemplate.getContents()).toContain('const log: typeof import(\'evlog/client\').log')
  })
})
