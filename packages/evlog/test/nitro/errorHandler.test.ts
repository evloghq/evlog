import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { defined } from '../helpers/defined'

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  var __EVLOG_CONFIG__: unknown
}

const mockSetResponseStatus = vi.fn<(event: H3Event, status: number) => void>()
const mockSetResponseHeader = vi.fn<(event: H3Event, name: string, value: string) => void>()
const mockGetRequestURL = vi.fn<(event: H3Event, options?: { xForwardedHost?: boolean }) => { pathname: string }>(() => ({ pathname: '/api/test' }))
const mockGetRequestHeader = vi.fn<(event: H3Event, name: string) => string | undefined>((event, name) => {
  const headers = (event as typeof mockEvent).node.req.headers as Record<string, string> | undefined
  return headers?.[name.toLowerCase()] ?? headers?.[name]
})
const mockResponseEnd = vi.fn<(body?: string) => void>()

vi.mock('h3', () => ({
  setResponseStatus: (event: H3Event, status: number) => mockSetResponseStatus(event, status),
  setResponseHeader: (event: H3Event, name: string, value: string) => mockSetResponseHeader(event, name, value),
  getRequestURL: (event: H3Event, options?: { xForwardedHost?: boolean }) => mockGetRequestURL(event, options),
  getRequestHeader: (event: H3Event, name: string) => mockGetRequestHeader(event, name),
}))

import { createError } from '../../src/error'
import errorHandler from '../../src/nitro/errorHandler'
import { resetNitroDevOverlayCache, shouldSuppressNitroDevOverlay } from '../../src/nitro'

const mockEvent = {
  node: { req: { headers: {} as Record<string, string> }, res: { writableEnded: false, end: mockResponseEnd } },
  _handled: false,
} as unknown as H3Event & { _handled: boolean; node: { req: { headers: Record<string, string> }; res: { writableEnded: boolean; end: typeof mockResponseEnd } } }

const defaultHandlerMock = vi.fn().mockResolvedValue(undefined)

// Relaxed signature: production code is typed against nitropack's
// NitroErrorHandler (H3Error, full H3Event, required ctx); tests exercise the
// runtime behavior with plain errors, a partial event and an optional ctx.
type TestErrorHandler = (
  error: Error,
  event: typeof mockEvent,
  ctx?: { defaultHandler: (error: Error, event: typeof mockEvent, opts?: { silent?: boolean; json?: boolean }) => unknown },
) => Promise<void> | void

const testErrorHandler = errorHandler as unknown as TestErrorHandler

function invokeErrorHandler(error: Error) {
  return testErrorHandler(error, mockEvent, { defaultHandler: defaultHandlerMock })
}

function readResponseBody(): Record<string, unknown> {
  return JSON.parse(defined(mockResponseEnd.mock.calls[0]?.[0], 'response body'))
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('__EVLOG_CONFIG', JSON.stringify({ pretty: true }))
    delete globalThis.__EVLOG_CONFIG__
    resetNitroDevOverlayCache()
    mockEvent._handled = false
    mockEvent.node.res.writableEnded = false
    mockEvent.node.req.headers = {}
    mockGetRequestURL.mockReturnValue({ pathname: '/api/test' })
  })

  it('marks the h3 event handled so Nitro dev handler does not run', async () => {
    await invokeErrorHandler(new Error('boom'))
    expect(mockEvent._handled).toBe(true)
  })

  it('ends the Node response directly so h3 v1 cannot skip the flush (#374)', async () => {
    await invokeErrorHandler(new Error('boom'))
    expect(mockResponseEnd).toHaveBeenCalledWith(expect.stringContaining('"statusCode":500'))
  })

  it('flushes the response even when invoked without a handler context', async () => {
    await testErrorHandler(new Error('boom'), mockEvent)
    expect(mockResponseEnd).toHaveBeenCalledWith(expect.stringContaining('"statusCode":500'))
  })

  it('does not end the response twice when already ended', async () => {
    mockEvent.node.res.writableEnded = true
    await invokeErrorHandler(new Error('boom'))
    expect(mockResponseEnd).not.toHaveBeenCalled()
  })

  it('clears unhandled flag in dev pretty mode', async () => {
    vi.stubEnv('__EVLOG_CONFIG', JSON.stringify({ pretty: true }))
    const error = Object.assign(new Error('boom'), { unhandled: true, fatal: true })
    await invokeErrorHandler(error)
    expect(error.unhandled).toBe(false)
    expect(error.fatal).toBe(false)
  })

  it('calls defaultHandler when dev preset is nitro', async () => {
    vi.stubEnv('__EVLOG_CONFIG', JSON.stringify({ pretty: true, dev: 'nitro' }))
    resetNitroDevOverlayCache()
    const defaultHandler = vi.fn().mockResolvedValue(undefined)
    const error = new Error('boom')
    await testErrorHandler(error, mockEvent, { defaultHandler })
    expect(defaultHandler).toHaveBeenCalledWith(error, mockEvent, { silent: false })
  })

  it('reads inlined __EVLOG_CONFIG__ for overlay suppression', () => {
    vi.stubEnv('__EVLOG_CONFIG', undefined)
    globalThis.__EVLOG_CONFIG__ = { pretty: true, dev: 'nitro' }
    resetNitroDevOverlayCache()
    expect(shouldSuppressNitroDevOverlay()).toBe(false)
  })

  describe('EvlogError handling', () => {
    it('serializes EvlogError with all data fields', async () => {
      const evlogError = Object.assign(new Error('Payment failed'), {
        name: 'EvlogError',
        status: 402,
        statusText: 'Payment failed',
        statusCode: 402,
        statusMessage: 'Payment failed',
        data: {
          why: 'Card declined',
          fix: 'Try another card',
          link: 'https://docs.example.com',
        },
      })

      await invokeErrorHandler(evlogError)

      expect(mockSetResponseStatus).toHaveBeenCalledWith(mockEvent, 402)
      expect(mockSetResponseHeader).toHaveBeenCalledWith(mockEvent, 'Content-Type', 'application/json')

      const sentBody = readResponseBody()
      expect(sentBody.statusCode).toBe(402)
      expect(sentBody.message).toBe('Payment failed')
      expect(sentBody.url).toBe('/api/test')
      expect(sentBody.error).toBe(true)
      expect(sentBody.data).toEqual({
        why: 'Card declined',
        fix: 'Try another card',
        link: 'https://docs.example.com',
      })
    })

    it('derives HTTP status from evlogError when in error.cause', async () => {
      const evlogError = Object.assign(new Error('Not found'), {
        name: 'EvlogError',
        status: 404,
        statusText: 'Not found',
        statusCode: 404,
        statusMessage: 'Not found',
        data: { why: 'Resource does not exist' },
      })

      const wrapperError = Object.assign(new Error('Wrapper error'), { cause: evlogError })

      await invokeErrorHandler(wrapperError)

      expect(mockSetResponseStatus).toHaveBeenCalledWith(mockEvent, 404)

      const sentBody = readResponseBody()
      expect(sentBody.statusCode).toBe(404)
      expect(sentBody.data).toEqual({ why: 'Resource does not exist' })
    })

    it('defaults to 500 when no status on evlogError', async () => {
      const evlogError = Object.assign(new Error('Unknown error'), { name: 'EvlogError' })

      await invokeErrorHandler(evlogError)

      expect(mockSetResponseStatus).toHaveBeenCalledWith(mockEvent, 500)
    })

    it('does not expose internal context on EvlogError responses', async () => {
      const err = createError({
        message: 'Not allowed',
        status: 403,
        why: 'Insufficient role',
        internal: { userId: 'u-internal', rawPolicy: 'deny:admin' },
      })

      await invokeErrorHandler(err)

      const sentBody = readResponseBody()
      expect(sentBody.internal).toBeUndefined()
      expect(JSON.stringify(sentBody)).not.toContain('u-internal')
      expect(JSON.stringify(sentBody)).not.toContain('rawPolicy')
      expect(sentBody.data).toEqual({
        why: 'Insufficient role',
        fix: undefined,
        link: undefined,
      })
    })
  })

  describe('non-EvlogError handling', () => {
    it('uses Nitro-compatible format for standard errors', async () => {
      const error = Object.assign(new Error('Something went wrong'), {
        statusCode: 400,
      })

      await invokeErrorHandler(error)

      expect(mockSetResponseStatus).toHaveBeenCalledWith(mockEvent, 400)

      const sentBody = readResponseBody()
      expect(sentBody.statusCode).toBe(400)
      expect(sentBody.statusMessage).toBe('Something went wrong')
      expect(sentBody.message).toBe('Something went wrong')
      expect(sentBody.url).toBe('/api/test')
      expect(sentBody.error).toBe(true)
      expect(sentBody.data).toBeUndefined()
    })

    it('defaults to 500 for errors without status', async () => {
      const error = new Error('Generic error')

      await invokeErrorHandler(error)

      expect(mockSetResponseStatus).toHaveBeenCalledWith(mockEvent, 500)
    })

    it('uses "Internal Server Error" when no message', async () => {
      const error = new Error('')

      await invokeErrorHandler(error)

      const sentBody = readResponseBody()
      expect(sentBody.message).toBe('Internal Server Error')
      expect(sentBody.statusMessage).toBe('Internal Server Error')
    })

    it('preserves data from createError, like Nitro does', async () => {
      const error = Object.assign(new Error('Payment provider rejected the charge'), {
        statusCode: 500,
        data: { orderId: 'ord_1', retryable: true },
      })

      await invokeErrorHandler(error)

      expect(readResponseBody().data).toEqual({ orderId: 'ord_1', retryable: true })
    })

    it('sanitizes unhandled error messages in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const error = Object.assign(new Error('Database connection failed: password invalid'), {
        statusCode: 500,
        unhandled: true,
        data: { query: 'select * from users' },
      })

      await invokeErrorHandler(error)

      const sentBody = readResponseBody()
      expect(sentBody.message).toBe('Internal Server Error')
      expect(sentBody.statusMessage).toBe('Internal Server Error')
      expect(sentBody.data).toBeUndefined()
    })

    it('sanitizes statusless error messages in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      await invokeErrorHandler(new Error('Database connection failed: password invalid'))

      expect(readResponseBody().message).toBe('Internal Server Error')
    })

    it('preserves a deliberate 5xx message and data in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const error = Object.assign(new Error('Payment provider rejected the charge'), {
        statusCode: 500,
        data: { orderId: 'ord_1' },
      })

      await invokeErrorHandler(error)

      const sentBody = readResponseBody()
      expect(sentBody.message).toBe('Payment provider rejected the charge')
      expect(sentBody.data).toEqual({ orderId: 'ord_1' })
    })

    it('keeps unhandled error details in development', async () => {
      const error = Object.assign(new Error('Database connection failed: password invalid'), {
        statusCode: 500,
        unhandled: true,
      })

      await invokeErrorHandler(error)

      expect(readResponseBody().message).toBe('Database connection failed: password invalid')
    })

    it('preserves 4xx error messages in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const error = Object.assign(new Error('Invalid email format'), {
        statusCode: 400,
      })

      await invokeErrorHandler(error)

      const sentBody = readResponseBody()
      expect(sentBody.message).toBe('Invalid email format')
      expect(sentBody.statusMessage).toBe('Invalid email format')
    })

    it('skips Nitro default logging for an expected 4xx EvlogError in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const evlogError = Object.assign(new Error('Payment failed'), {
        name: 'EvlogError',
        status: 402,
        data: { why: 'Card declined', fix: 'Use another card' },
      })

      await invokeErrorHandler(evlogError)

      expect(defaultHandlerMock).not.toHaveBeenCalled()
      expect(readResponseBody().statusCode).toBe(402)
    })

    it('keeps Nitro default logging for an EvlogError with a 5xx status in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const evlogError = Object.assign(new Error('Payment provider unavailable'), {
        name: 'EvlogError',
        status: 503,
      })

      await invokeErrorHandler(evlogError)

      expect(defaultHandlerMock).toHaveBeenCalledWith(evlogError, mockEvent, { silent: false })
    })
  })

  describe('HTML page delegation (#390)', () => {
    it('does not flush JSON for plain errors on document navigation', async () => {
      mockGetRequestURL.mockReturnValue({ pathname: '/user/does-not-exist' })
      mockEvent.node.req.headers = {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-dest': 'document',
      }

      const error = Object.assign(new Error('nope'), { statusCode: 404, statusMessage: 'nope' })
      await invokeErrorHandler(error)

      expect(mockResponseEnd).not.toHaveBeenCalled()
      expect(mockEvent._handled).toBe(false)
      expect(defaultHandlerMock).not.toHaveBeenCalled()
    })

    it('still serializes EvlogError on document navigation', async () => {
      mockGetRequestURL.mockReturnValue({ pathname: '/checkout' })
      mockEvent.node.req.headers = {
        accept: 'text/html',
        'sec-fetch-dest': 'document',
      }

      const evlogError = Object.assign(new Error('Payment failed'), {
        name: 'EvlogError',
        status: 402,
        statusCode: 402,
        data: { why: 'Card declined' },
      })

      await invokeErrorHandler(evlogError)

      expect(mockResponseEnd).toHaveBeenCalled()
      expect(readResponseBody().statusCode).toBe(402)
    })
  })

  describe('chained Nitro error handlers (#390)', () => {
    it('passes HTML page errors to the next handler in the chain', async () => {
      const frameworkHandler = vi.fn().mockResolvedValue(
        new Response('<html>error page</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
      )

      mockGetRequestURL.mockReturnValue({ pathname: '/missing-page' })
      mockEvent.node.req.headers = {
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
      }

      const error = Object.assign(new Error('Not Found'), { statusCode: 404 })
      const handlers = [testErrorHandler, frameworkHandler]

      let response: Response | undefined
      for (const handler of handlers) {
        const result = await handler(error, mockEvent, { defaultHandler: defaultHandlerMock })
        if (result) {
          response = result as Response
          break
        }
      }

      expect(mockResponseEnd).not.toHaveBeenCalled()
      expect(frameworkHandler).toHaveBeenCalledOnce()
      expect(response?.status).toBe(404)
      expect(await response?.text()).toContain('error page')
    })
  })
})
