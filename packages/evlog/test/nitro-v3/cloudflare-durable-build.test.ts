import { existsSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { build, createNitro } from 'nitro/builder'
import { resolve } from 'pathe'

const distEntry = resolve(__dirname, '../../dist/index.mjs')
const distExists = existsSync(distEntry)

if (!distExists) {
  console.warn('[evlog test] Skipping cloudflare-durable build: dist/ not found. Run `pnpm --filter evlog run build` first.')
}

/**
 * Regression: strict Worker presets bundle evlog into the server output.
 * Static or Rollup-resolvable `import("nitro/runtime-config")` from published
 * dist used to fail with "Cannot resolve ... externals are not allowed".
 */
describe.skipIf(!distExists).sequential('Nitro cloudflare-durable build with evlog dist', () => {
  let nitro: Awaited<ReturnType<typeof createNitro>>

  afterAll(async () => {
    await nitro?.close()
  })

  it('production build succeeds when the plugin is loaded from dist', async () => {
    const fixtureDir = resolve(__dirname, './fixture')
    const evlogDist = resolve(__dirname, '../../dist')

    nitro = await createNitro({
      rootDir: fixtureDir,
      preset: 'cloudflare-durable',
      dev: false,
      compatibilityDate: '2024-01-16',
      serverDir: './',
      plugins: [resolve(evlogDist, 'nitro/plugin.mjs')],
      alias: {
        evlog: resolve(evlogDist, 'index.mjs'),
      },
    })

    await expect(build(nitro)).resolves.toBeUndefined()
  }, 120_000)
})
