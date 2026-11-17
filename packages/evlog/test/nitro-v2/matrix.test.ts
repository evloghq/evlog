import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { build, createDevServer, createNitro, prepare } from 'nitropack'
import { toNodeListener } from 'h3'
import { resolve } from 'pathe'
import evlog from '../../src/nitro/module'
import type { WideEvent } from '../../src/types'
import { DRAINED_PATH, describeBuiltAppMatrix } from '../helpers/frameworkMatrix'

describeBuiltAppMatrix({
  name: 'nitro/v2',
  async start(options) {
    // Passed here rather than imported by nitro.config.ts: c12 would load the
    // module through jiti, and that second copy of src breaks v8 coverage.
    const nitro = await createNitro({
      dev: true,
      rootDir: resolve(__dirname, './matrix-fixture'),
      modules: [evlog({ ...options, silent: true })],
    })
    const devServer = createDevServer(nitro)
    const server = createServer(toNodeListener(devServer.app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await prepare(nitro)
    const ready = new Promise<void>(resolve => nitro.hooks.hook('dev:reload', () => resolve()))
    await build(nitro)
    await ready
    return {
      async fire({ method, path, headers }) {
        const res = await fetch(new URL(path, baseURL), { method, headers })
        await res.arrayBuffer()
        return { status: res.status }
      },
      drained: async () => await (await fetch(new URL(DRAINED_PATH, baseURL))).json() as WideEvent[],
      async cleanup() {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        await devServer.close()
        await nitro.close()
      },
    }
  },
})
