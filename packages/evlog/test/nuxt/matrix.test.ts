import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, vi } from 'vitest'
import { buildNuxt, loadNuxt } from '@nuxt/kit'
import { resolve } from 'pathe'
import type { WideEvent } from '../../src/types'
import { DRAINED_PATH, describeBuiltAppMatrix } from '../helpers/frameworkMatrix'

// The module resolves its Nitro plugin next to itself, which only exists in dist/.
const moduleEntry = resolve(__dirname, '../../dist/nuxt/module.mjs')

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise(resolve => server.close(resolve))
  return port
}

if (!existsSync(moduleEntry)) {
  describe.skip('shared http matrix (nuxt)', () => {
    it('needs dist/: run `pnpm --filter evlog run build`', () => {})
  })
} else {
  describeBuiltAppMatrix({
    name: 'nuxt',
    async start(options) {
      const outDir = mkdtempSync(join(tmpdir(), 'evlog-nuxt-matrix-'))
      const nuxt = await loadNuxt({
        cwd: resolve(__dirname, './matrix-fixture'),
        dev: false,
        overrides: {
          modules: [moduleEntry],
          evlog: { ...options, silent: true },
          buildDir: join(outDir, '.nuxt'),
          nitro: { output: { dir: join(outDir, '.output') } },
        },
      })
      await buildNuxt(nuxt)
      await nuxt.close()

      const port = await freePort()
      const baseURL = `http://127.0.0.1:${port}`
      const server = spawn(process.execPath, [join(outDir, '.output/server/index.mjs')], {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
        stdio: 'ignore',
      })
      await vi.waitFor(() => fetch(new URL(DRAINED_PATH, baseURL)), { timeout: 15_000, interval: 100 })

      return {
        async fire({ method, path, headers }) {
          const res = await fetch(new URL(path, baseURL), { method, headers })
          await res.arrayBuffer()
          return { status: res.status }
        },
        drained: async () => await (await fetch(new URL(DRAINED_PATH, baseURL))).json() as WideEvent[],
        async cleanup() {
          const exited = new Promise(resolve => server.once('exit', resolve))
          server.kill()
          await exited
          rmSync(outDir, { recursive: true, force: true })
        },
      }
    },
  })
}
