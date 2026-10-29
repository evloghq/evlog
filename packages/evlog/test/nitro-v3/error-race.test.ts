import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  build,
  createDevServer,
  createNitro,
  prepare,
} from 'nitro/builder'
import { resolve } from 'pathe'
import { consola } from 'consola'

// Regression for EVL-731: an async `error` hook registered before evlog's delays evlog's
// error listener. Nitro fires `response` without waiting for `error`, so the response hook
// must not emit the request event before the error has been recorded.
const rootDir = resolve(__dirname, './error-race')

describe.sequential('Nitro v3 error hook ordering', () => {
  let nitro: Awaited<ReturnType<typeof createNitro>>
  let devServer: ReturnType<typeof createDevServer>
  let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
  let prevEvlogTestLog: string | undefined

  beforeAll(async () => {
    prevEvlogTestLog = process.env.EVLOG_TEST_LOG
    process.env.EVLOG_TEST_LOG = '1'
    nitro = await createNitro({
      dev: true,
      rootDir,
    })
    devServer = createDevServer(nitro)
    server = devServer.listen({ port: 0 })
    await prepare(nitro)
    const reloaded = new Promise<void>((resolve) => {
      nitro.hooks.hook('dev:reload', () => resolve())
    })
    await build(nitro)
    await reloaded
    await server.ready()
  })

  afterAll(async () => {
    if (prevEvlogTestLog === undefined) delete process.env.EVLOG_TEST_LOG
    else process.env.EVLOG_TEST_LOG = prevEvlogTestLog
    await devServer?.close()
    await nitro?.close()
  })

  it.sequential('emits one request event that keeps the error and status when an earlier error hook is slow', async () => {
    const logs: string[] = []
    const mockFn = vi.fn((context) => {
      logs.push(String(context))
    })

    consola.mockTypes(() => mockFn)
    consola.wrapAll()

    try {
      const res = await server.fetch(new Request(new URL('/conflict', server.url)))
      expect(res.status).toBe(409)

      await new Promise(resolve => setTimeout(resolve, 200))

      const logOutput = logs.join('\n')
      const drained = [...logOutput.matchAll(/\[TEST:DRAIN\] (.+)/g)]
        .map(match => JSON.parse(match[1]))
        .filter(entry => entry.requestPath === '/conflict')

      expect(drained).toHaveLength(1)
      expect(drained[0].eventLevel).toBe('error')
      expect(drained[0].eventStatus).toBe(409)
      expect(drained[0].hasError).toBe(true)

      expect(logOutput).not.toContain('called after the wide event was emitted')
    } finally {
      consola.restoreAll()
    }
  })
})
