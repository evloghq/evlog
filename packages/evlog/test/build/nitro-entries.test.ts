import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }

const distDir = resolve(__dirname, '../../dist')
const distExists = existsSync(join(distDir, 'index.mjs'))

if (!distExists) {
  console.warn('[evlog test] Skipping Nitro dist layout: dist/ not found. Run `pnpm --filter evlog run build` first.')
}

function makeNitroStub() {
  return {
    options: {
      rootDir: mkdtempSync(join(tmpdir(), 'evlog-nitro-entries-')),
      virtual: {} as Record<string, string>,
      plugins: [] as string[],
      errorHandler: undefined as string | string[] | undefined,
      noExternals: undefined as undefined | true | string[],
      runtimeConfig: {} as Record<string, unknown>,
      replace: {} as Record<string, string>,
    },
  }
}

async function registeredFiles(entry: string): Promise<string[]> {
  const { default: evlog } = await import(pathToFileURL(join(distDir, entry)).href)
  const nitro = makeNitroStub()
  evlog({ silent: true }).setup(nitro)
  const plugin = nitro.options.plugins.at(-1)
  const [errorHandler] = [nitro.options.errorHandler].flat()
  return [plugin, errorHandler].map(path => `${path}.mjs`)
}

describe('Nitro entries', () => {
  it('maps evlog/nitro to Nitro v3 and evlog/nitro/v2 to nitropack, with no evlog/nitro/v3', () => {
    const exportsField = pkg.exports as Record<string, unknown>
    expect(exportsField['./nitro']).toEqual({
      types: './dist/nitro/index.d.mts',
      import: './dist/nitro/index.mjs',
      default: './dist/nitro/index.mjs',
    })
    expect(exportsField['./nitro/v2']).toEqual({
      types: './dist/nitro/v2/module.d.mts',
      import: './dist/nitro/v2/module.mjs',
      default: './dist/nitro/v2/module.mjs',
    })
    expect(exportsField).not.toHaveProperty('./nitro/v3')
  })

  it.skipIf(!distExists)('evlog/nitro registers the Nitro v3 plugin and error handler', async () => {
    for (const file of await registeredFiles('nitro/index.mjs')) {
      expect(file.startsWith(join(distDir, 'nitro/'))).toBe(true)
      expect(file.startsWith(join(distDir, 'nitro/v2/'))).toBe(false)
      expect(existsSync(file)).toBe(true)
    }
  })

  it.skipIf(!distExists)('evlog/nitro/v2 registers the nitropack plugin and error handler', async () => {
    for (const file of await registeredFiles('nitro/v2/module.mjs')) {
      expect(file.startsWith(join(distDir, 'nitro/v2/'))).toBe(true)
      expect(existsSync(file)).toBe(true)
    }
  })

  it.skipIf(!distExists)('the Nuxt module registers the nitropack plugin and error handler', () => {
    const source = readFileSync(join(distDir, 'nuxt/module.mjs'), 'utf8')
    const nitroPaths = [...source.matchAll(/resolve\(["'](\.\.\/nitro\/[^"']+)["']\)/g)].map(match => match[1])
    expect(nitroPaths.sort()).toEqual(['../nitro/v2/errorHandler', '../nitro/v2/plugin'])
    for (const path of nitroPaths) expect(existsSync(resolve(distDir, 'nuxt', `${path}.mjs`))).toBe(true)
  })
})
