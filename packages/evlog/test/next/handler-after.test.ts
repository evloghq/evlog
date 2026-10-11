import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWithEvlog } from '../../src/next/handler'
import { createDeferredStream } from '../helpers/stream'

const { after, requestScope, afterTasks } = vi.hoisted(() => {
  const requestScope = { active: false }
  const afterTasks: Array<() => unknown> = []
  const after = vi.fn((task: () => unknown) => {
    if (!requestScope.active) throw new Error('`after` was called outside a request scope.')
    afterTasks.push(task)
  })
  return { after, requestScope, afterTasks }
})

vi.mock('next/server', () => ({ after }))

async function serve(handler: (request: Request) => Promise<Response>, request: Request): Promise<Response> {
  requestScope.active = true
  try {
    return await handler(request)
  } finally {
    requestScope.active = false
  }
}

function runAfterTasks(): Promise<unknown[]> {
  return Promise.all(afterTasks.splice(0).map(task => task()))
}

describe('withEvlog with Next after()', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    after.mockClear()
    afterTasks.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the drain of a completed stream while the request is in scope', async () => {
    let releaseDrain!: () => void
    let drainDone = false
    const drain = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseDrain = resolve
      })
      drainDone = true
    })
    const withEvlog = createWithEvlog({ pretty: false, drain })

    let closeStream!: () => void
    const handler = withEvlog((_request: Request) => {
      const { stream, close } = createDeferredStream()
      closeStream = close
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    })

    const response = await serve(handler, new Request('http://localhost/api/stream'))
    expect(after).toHaveBeenCalledOnce()

    closeStream()
    await expect(response.text()).resolves.toBe('hello world')

    const afterWork = runAfterTasks()
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce())
    expect(drainDone).toBe(false)

    releaseDrain()
    await afterWork
    expect(drainDone).toBe(true)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('registers the drain of a cancelled stream while the request is in scope', async () => {
    const drain = vi.fn()
    const withEvlog = createWithEvlog({ pretty: false, drain })

    const handler = withEvlog((_request: Request) => {
      const { stream } = createDeferredStream()
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    })

    const response = await serve(handler, new Request('http://localhost/api/stream'))
    await response.body?.cancel()
    await runAfterTasks()

    expect(after).toHaveBeenCalledOnce()
    expect(drain).toHaveBeenCalledOnce()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
