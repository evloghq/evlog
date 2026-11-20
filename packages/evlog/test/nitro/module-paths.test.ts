import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import nitroV2Module from '../../src/nitro/module'
import nitroV3Module from '../../src/nitro-v3/module'
import { EVLOG_CONFIG_PLUGIN_ID } from '../../src/shared/configPlugin'

// Nitro builds its #nitro/virtual/plugins and #nitro/virtual/error-handler
// virtual modules by raw-interpolating these paths into JS string literals:
//   import _abc from "${plugin}"
//   import errorHandler$0 from "${h}"
// On Windows, path.resolve() returns paths with backslashes (e.g. C:\…\plugin).
// Those backslashes would then be parsed as JS escape sequences (\n, \v, …),
// silently corrupting the specifier. Regression test for evlog#345.
describe('nitro modules avoid backslash paths', () => {
  function makeNitroStub() {
    return {
      options: {
        rootDir: mkdtempSync(join(tmpdir(), 'evlog-module-paths-')),
        virtual: {} as Record<string, string>,
        plugins: [] as string[],
        errorHandler: undefined as string | string[] | undefined,
        noExternals: undefined as undefined | true | string[],
        runtimeConfig: {} as Record<string, unknown>,
        replace: {} as Record<string, string>,
      },
    }
  }

  it('nitro v2 module pushes POSIX-style plugin and errorHandler paths', () => {
    const nitro = makeNitroStub()
    nitroV2Module({ env: { service: 'test' }, silent: true }).setup(nitro as never)

    expect(nitro.options.plugins).toEqual([EVLOG_CONFIG_PLUGIN_ID, expect.stringMatching(/\/nitro\/plugin$/)])
    expect(nitro.options.plugins[1]).not.toMatch(/\\/)

    expect(nitro.options.errorHandler).toBeTypeOf('string')
    expect(nitro.options.errorHandler).not.toMatch(/\\/)
    expect(nitro.options.errorHandler).toMatch(/\/nitro\/errorHandler$/)

    const { replace } = nitro.options as { replace?: Record<string, string> }
    expect(JSON.parse(replace!.__EVLOG_CONFIG__)).toEqual({ env: { service: 'test' }, silent: true, _suppressDrainWarning: true })
  })

  it('nitro v3 module pushes POSIX-style plugin and errorHandler paths', () => {
    const nitro = makeNitroStub()
    nitroV3Module({ env: { service: 'test' } }).setup(nitro as never)

    expect(nitro.options.plugins).toEqual([EVLOG_CONFIG_PLUGIN_ID, expect.stringMatching(/\/nitro-v3\/plugin$/)])
    expect(nitro.options.plugins[1]).not.toMatch(/\\/)

    expect(Array.isArray(nitro.options.errorHandler)).toBe(true)
    const handlers = nitro.options.errorHandler as string[]
    expect(handlers).toHaveLength(1)
    expect(handlers[0]).not.toMatch(/\\/)
    expect(handlers[0]).toMatch(/\/nitro-v3\/errorHandler$/)
  })
})

describe('nitro modules with errorHandler: false', () => {
  function makeNitroStub(errorHandler: string | string[]) {
    return {
      options: {
        rootDir: mkdtempSync(join(tmpdir(), 'evlog-error-handler-')),
        virtual: {} as Record<string, string>,
        plugins: [] as string[],
        errorHandler,
        noExternals: undefined as undefined | true | string[],
        runtimeConfig: {} as Record<string, unknown>,
        replace: {} as Record<string, string>,
      },
    }
  }

  it('nitro v2 module leaves the app error handler alone and still registers the plugin', () => {
    const nitro = makeNitroStub('~/error')
    nitroV2Module({ errorHandler: false }).setup(nitro as never)

    expect(nitro.options.errorHandler).toBe('~/error')
    expect(nitro.options.plugins).toContainEqual(expect.stringMatching(/\/nitro\/plugin$/))
  })

  it('nitro v3 module leaves the app error handlers alone and still registers the plugin', () => {
    const nitro = makeNitroStub(['~/error'])
    nitroV3Module({ errorHandler: false }).setup(nitro as never)

    expect(nitro.options.errorHandler).toEqual(['~/error'])
    expect(nitro.options.plugins).toContainEqual(expect.stringMatching(/\/nitro-v3\/plugin$/))
  })
})
