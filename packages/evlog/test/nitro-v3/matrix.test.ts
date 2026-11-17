import { build, createDevServer, createNitro, prepare } from 'nitro/builder'
import { resolve } from 'pathe'
import evlog from '../../src/nitro-v3/module'
import type { WideEvent } from '../../src/types'
import { DRAINED_PATH, describeBuiltAppMatrix } from '../helpers/frameworkMatrix'

describeBuiltAppMatrix({
  name: 'nitro/v3',
  async start(options) {
    const nitro = await createNitro({
      dev: true,
      rootDir: resolve(__dirname, './matrix-fixture'),
      modules: [evlog({ ...options, silent: true })],
    })
    const devServer = createDevServer(nitro)
    const server = devServer.listen({})
    await prepare(nitro)
    const reloaded = new Promise<void>(resolve => nitro.hooks.hook('dev:reload', () => resolve()))
    await build(nitro)
    await reloaded
    await server.ready()
    const fetchPath = (path: string, headers?: Record<string, string>) =>
      server.fetch(new Request(new URL(path, server.url), { headers }))
    return {
      async fire({ method, path, headers }) {
        const res = await server.fetch(new Request(new URL(path, server.url), { method, headers }))
        await res.arrayBuffer()
        return { status: res.status }
      },
      drained: async () => await (await fetchPath(DRAINED_PATH)).json() as WideEvent[],
      async cleanup() {
        await devServer.close()
        await nitro.close()
      },
    }
  },
})
