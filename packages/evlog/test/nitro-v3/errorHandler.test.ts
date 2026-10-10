import { beforeEach, describe, expect, it, vi } from 'vitest'

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  var __EVLOG_CONFIG__: unknown
}

vi.mock('nitro', () => ({
  defineErrorHandler: <T>(handler: T) => handler,
}))

import { createError } from '../../src/error'
import errorHandler from '../../src/nitro-v3/errorHandler'
import { resetNitroDevOverlayCache, shouldSuppressNitroDevOverlay } from '../../src/nitro'

const defaultHandlerMock = vi.fn().mockResolvedValue(undefined)

const mockEvent = {
  req: {
    url: 'http://localhost/api/test',
    headers: new Headers(),
  },
  _handled: false,
} as { req: { url: string; headers: Headers }; _handled: boolean }

function setMockHeaders(headers: Record<string, string>) {
  mockEvent.req.headers = new Headers(headers)
}

function setMockPath(pathname: string) {
  mockEvent.req.url = `http://localhost${pathname}`
}

function invokeErrorHandler(error: Error, event = mockEvent) {
  return errorHandler(error, event, { defaultHandler: defaultHandlerMock })
}

async function readJson(response: Response) {
  return JSON.parse(await response.text())
}

describe('nitro-v3 errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('__EVLOG_CONFIG', JSON.stringify({ pretty: true }))
    delete globalThis.__EVLOG_CONFIG__
    resetNitroDevOverlayCache()
    mockEvent._handled = false
    setMockPath('/api/test')
    mockEvent.req.headers = new Headers()
  })

  it('marks the h3 event handled so Nitro dev handler does not run', async () => {
    await invokeErrorHandler(new Error('boom'))
    expect(mockEvent._handled).toBe(true)
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

    await errorHandler(error, mockEvent, { defaultHandler })

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

      const response = await invokeErrorHandler(evlogError)

      expect(response.status).toBe(402)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = await readJson(response)
      expect(body.statusCode).toBe(402)
      expect(body.message).toBe('Payment failed')
      expect(body.url).toBe('/api/test')
      expect(body.error).toBe(true)
      expect(body.data).toEqual({
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

      const response = await invokeErrorHandler(wrapperError)

      expect(response.status).toBe(404)

      const body = await readJson(response)
      expect(body.statusCode).toBe(404)
      expect(body.data).toEqual({ why: 'Resource does not exist' })
    })

    it('defaults to 500 when no status on evlogError', async () => {
      const evlogError = Object.assign(new Error('Unknown error'), { name: 'EvlogError' })

      const response = await invokeErrorHandler(evlogError)

      expect(response.status).toBe(500)
    })

    it('does not expose internal context on EvlogError responses', async () => {
      const err = createError({
        message: 'Not allowed',
        status: 403,
        why: 'Insufficient role',
        internal: { userId: 'u-internal', rawPolicy: 'deny:admin' },
      })

      const response = await invokeErrorHandler(err)

      const body = await readJson(response)
      expect(body.internal).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain('u-internal')
      expect(JSON.stringify(body)).not.toContain('rawPolicy')
      expect(body.data).toEqual({
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

      const response = await invokeErrorHandler(error)

      expect(response.status).toBe(400)

      const body = await readJson(response)
      expect(body.statusCode).toBe(400)
      expect(body.statusMessage).toBe('Something went wrong')
      expect(body.message).toBe('Something went wrong')
      expect(body.url).toBe('/api/test')
      expect(body.error).toBe(true)
      expect(body.data).toBeUndefined()
    })

    it('defaults to 500 for errors without status', async () => {
      const response = await invokeErrorHandler(new Error('Generic error'))
      expect(response.status).toBe(500)
    })

    it('uses "Internal Server Error" when no message', async () => {
      const response = await invokeErrorHandler(new Error(''))

      const body = await readJson(response)
      expect(body.message).toBe('Internal Server Error')
      expect(body.statusMessage).toBe('Internal Server Error')
    })

    it('preserves data from createError, like Nitro does', async () => {
      const error = Object.assign(new Error('Payment provider rejected the charge'), {
        statusCode: 500,
        data: { orderId: 'ord_1', retryable: true },
      })

      const body = await readJson(await invokeErrorHandler(error))
      expect(body.data).toEqual({ orderId: 'ord_1', retryable: true })
    })

    it('sanitizes unhandled error messages in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const error = Object.assign(new Error('Database connection failed: password invalid'), {
        statusCode: 500,
        unhandled: true,
        data: { query: 'select * from users' },
      })

      const body = await readJson(await invokeErrorHandler(error))
      expect(body.message).toBe('Internal Server Error')
      expect(body.statusMessage).toBe('Internal Server Error')
      expect(body.data).toBeUndefined()
    })

    it('sanitizes statusless error messages in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const body = await readJson(await invokeErrorHandler(new Error('Database connection failed: password invalid')))
      expect(body.message).toBe('Internal Server Error')
    })

    it('preserves a deliberate 5xx message and data in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const error = Object.assign(new Error('Payment provider rejected the charge'), {
        statusCode: 500,
        data: { orderId: 'ord_1' },
      })

      const body = await readJson(await invokeErrorHandler(error))
      expect(body.message).toBe('Payment provider rejected the charge')
      expect(body.data).toEqual({ orderId: 'ord_1' })
    })

    it('preserves 4xx error messages in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const error = Object.assign(new Error('Invalid email format'), {
        statusCode: 400,
      })

      const body = await readJson(await invokeErrorHandler(error))
      expect(body.message).toBe('Invalid email format')
      expect(body.statusMessage).toBe('Invalid email format')
    })

    it('skips Nitro default logging for an expected 4xx EvlogError in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const evlogError = Object.assign(new Error('Payment failed'), {
        name: 'EvlogError',
        status: 402,
        data: { why: 'Card declined', fix: 'Use another card' },
      })

      const response = await invokeErrorHandler(evlogError)

      expect(defaultHandlerMock).not.toHaveBeenCalled()
      expect(response?.status).toBe(402)
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
    it('returns undefined for plain errors on document navigation', async () => {
      setMockPath('/user/does-not-exist')
      setMockHeaders({
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-dest': 'document',
      })

      const error = Object.assign(new Error('nope'), { statusCode: 404 })
      const response = await invokeErrorHandler(error)

      expect(response).toBeUndefined()
      expect(mockEvent._handled).toBe(false)
      expect(defaultHandlerMock).not.toHaveBeenCalled()
    })

    it('still serializes EvlogError on document navigation', async () => {
      setMockPath('/checkout')
      setMockHeaders({
        accept: 'text/html',
        'sec-fetch-dest': 'document',
      })

      const evlogError = Object.assign(new Error('Payment failed'), {
        name: 'EvlogError',
        status: 402,
        statusCode: 402,
        data: { why: 'Card declined' },
      })

      const response = await invokeErrorHandler(evlogError)

      expect(response?.status).toBe(402)
      expect(await readJson(response!)).toMatchObject({ statusCode: 402, data: { why: 'Card declined' } })
    })
  })
})
