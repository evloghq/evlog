import 'next/dist/server/node-environment-baseline'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createWorkStore } from 'next/dist/server/async-storage/work-store'
import { createRequestStoreForRender } from 'next/dist/server/async-storage/request-store'
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external'
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external'
import { createInstrumentation } from '../../src/next/instrumentation-create'
import { createWithEvlog } from '../../src/next/handler'
import { log } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import type { DrainContext } from '../../src/types'
import { flushMicrotasks, withFakeTimers } from '../helpers/timers'

function createRequestLifecycle() {
  const onClose: Array<() => void> = []
  const pending: Promise<unknown>[] = []
  const onAfterTaskError = vi.fn()
  const workStore = createWorkStore({
    page: '/test/page',
    buildId: 'test',
    deploymentId: 'test',
    previouslyRevalidatedTags: [],
    renderOpts: {
      cacheLifeProfiles: { default: { stale: 300, revalidate: 900, expire: 3600 } },
      staticPageGenerationTimeout: 60,
      cacheComponents: true,
      validationLevel: 'warning',
      supportsDynamicResponse: true,
      isBuildTimePrerendering: false,
      isDraftMode: false,
      experimental: { isRoutePPREnabled: true, authInterrupts: false, useCacheTimeout: 50_000 },
      waitUntil: promise => {
        pending.push(promise)
      },
      onClose: callback => {
        onClose.push(callback)
      },
      onAfterTaskError,
    },
  })
  const requestStore = createRequestStoreForRender(
    new NextRequest('http://localhost/test'),
    undefined,
    { pathname: '/test' },
    {},
    { tags: [], expirationsByCacheKind: new Map() },
    undefined,
    undefined,
    false,
    undefined,
    null,
    null,
    undefined,
  )
  return {
    run: <T>(fn: () => T) => workAsyncStorage.run(workStore, () => workUnitAsyncStorage.run(requestStore, fn)),
    close: () => {
      for (const callback of onClose) callback()
    },
    pending,
    onAfterTaskError,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('instrumentation with the Next after runtime', () => {
  it('keeps Next waitUntil pending until a global drain finishes', async () => {
    const request = createRequestLifecycle()
    let completeSend = () => {}
    const send = new Promise<void>((resolve) => {
      completeSend = resolve
    })
    const drain = vi.fn(() => send)
    await createInstrumentation({ silent: true, drain }).register()

    request.run(() => log.info({ message: 'rendered' }))
    expect(drain).not.toHaveBeenCalled()
    expect(request.pending).toHaveLength(1)

    let completed = false
    const completion = Promise.all(request.pending).then(() => {
      completed = true
    })
    request.close()
    await flushMicrotasks(30)
    expect(drain).toHaveBeenCalledTimes(1)
    const completedBeforeSend = completed
    completeSend()
    await completion

    expect(completedBeforeSend).toBe(false)
    expect(completed).toBe(true)
    expect(request.onAfterTaskError).not.toHaveBeenCalled()
  })

  it('returns a wrapped route response before delivering its buffered global drain', async () => {
    const request = createRequestLifecycle()
    const send = vi.fn().mockResolvedValue(undefined)
    const drain = createDrainPipeline<DrainContext>({ batch: { size: 10, intervalMs: 1000 } })(send)
    await createInstrumentation({ silent: true, drain }).register()
    const handler = createWithEvlog({})(() => Response.json({ ok: true }))

    await withFakeTimers(async () => {
      const response = await request.run(() => handler())
      expect(await response.json()).toEqual({ ok: true })
      expect(drain.pending).toBe(0)
      expect(send).not.toHaveBeenCalled()
      expect(request.pending).toHaveLength(1)

      let completed = false
      const completion = Promise.all(request.pending).then(() => {
        completed = true
      })
      request.close()
      await flushMicrotasks(30)
      const completedBeforeFlush = completed
      expect(drain.pending).toBe(1)
      await vi.advanceTimersByTimeAsync(1000)
      await completion

      expect(completedBeforeFlush).toBe(false)
      expect(send).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ event: expect.objectContaining({ status: 200 }) }),])
      expect(completed).toBe(true)
      expect(request.onAfterTaskError).not.toHaveBeenCalled()
    })
  })
})
