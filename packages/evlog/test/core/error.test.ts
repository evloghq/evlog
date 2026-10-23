import { describe, expect, it } from 'vitest'
import { createError, createEvlogError, EvlogError } from '../../src/error'
import { serializeEvlogErrorResponse } from '../../src/nitro'
import { parseError } from '../../src/runtime/utils/parseError'

describe('EvlogError', () => {
  it('creates error with message only', () => {
    const error = new EvlogError('Something went wrong')

    expect(error.message).toBe('Something went wrong')
    expect(error.name).toBe('EvlogError')
    expect(error.status).toBeUndefined()
    expect(error.why).toBeUndefined()
    expect(error.fix).toBeUndefined()
    expect(error.link).toBeUndefined()
  })

  it('creates error with full options', () => {
    const error = new EvlogError({
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      status: 402,
      why: 'Card declined by issuer',
      fix: 'Try a different payment method',
      link: 'https://docs.example.com/payments',
    })

    expect(error.code).toBe('PAYMENT_DECLINED')
    expect(error.message).toBe('Payment failed')
    expect(error.status).toBe(402)
    expect(error.why).toBe('Card declined by issuer')
    expect(error.fix).toBe('Try a different payment method')
    expect(error.link).toBe('https://docs.example.com/payments')
  })

  it('leaves code undefined when not provided', () => {
    const error = new EvlogError({ message: 'No code here' })
    expect(error.code).toBeUndefined()
  })

  it('leaves status unset when not provided', () => {
    const error = new EvlogError({ message: 'Server error' })

    expect(error.status).toBeUndefined()
    expect(error.toJSON()).not.toHaveProperty('status')
  })

  describe('HTTP compatibility', () => {
    it('carries the status as status and the text as message only', () => {
      const error = new EvlogError({ message: 'Not found', status: 404 })

      expect(error.status).toBe(404)
      expect(error.message).toBe('Not found')
      expect('statusCode' in error).toBe(false)
      expect('statusText' in error).toBe(false)
      expect('statusMessage' in error).toBe(false)
    })

    it('provides data getter with structured info', () => {
      const error = new EvlogError({
        message: 'Payment failed',
        status: 402,
        why: 'Card declined',
        fix: 'Use another card',
        link: 'https://example.com',
      })

      expect(error.data).toEqual({
        why: 'Card declined',
        fix: 'Use another card',
        link: 'https://example.com',
      })
    })

    it('returns undefined data when no extra fields', () => {
      const error = new EvlogError('Simple error')

      expect(error.data).toBeUndefined()
    })

    it('includes code in data getter', () => {
      const error = new EvlogError({
        code: 'PAYMENT_DECLINED',
        message: 'Payment failed',
        why: 'Card declined',
      })

      expect(error.data).toEqual({
        code: 'PAYMENT_DECLINED',
        why: 'Card declined',
        fix: undefined,
        link: undefined,
      })
    })

    it('returns data when only code is set', () => {
      const error = new EvlogError({ code: 'NO_CONTEXT', message: 'x' })
      expect(error.data).toEqual({ code: 'NO_CONTEXT', why: undefined, fix: undefined, link: undefined })
    })
  })

  it('preserves cause error', () => {
    const cause = new Error('Original error')
    const error = new EvlogError({
      message: 'Wrapped error',
      cause,
    })

    expect(error.cause).toBe(cause)
  })

  it('extends Error', () => {
    const error = new EvlogError('Test')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(EvlogError)
  })

  it('has stack trace', () => {
    const error = new EvlogError('Test')
    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('EvlogError')
  })

  describe('toString()', () => {
    it('formats error with all fields', () => {
      const error = new EvlogError({
        message: 'Payment failed',
        why: 'Card declined',
        fix: 'Use another card',
        link: 'https://example.com',
        cause: new Error('Network error'),
      })

      const str = error.toString()
      expect(str).toContain('Payment failed')
      expect(str).toContain('Card declined')
      expect(str).toContain('Use another card')
      expect(str).toContain('https://example.com')
      expect(str).toContain('Network error')
    })

    it('formats error with message only', () => {
      const error = new EvlogError('Simple error')
      const str = error.toString()
      expect(str).toContain('Simple error')
    })

    it('renders code line when set', () => {
      const error = new EvlogError({
        code: 'PAYMENT_DECLINED',
        message: 'Payment failed',
      })
      const str = error.toString()
      expect(str).toContain('Payment failed')
      expect(str).toContain('Code:')
      expect(str).toContain('PAYMENT_DECLINED')
    })
  })

  describe('toJSON()', () => {
    it('serializes error to plain object without duplication', () => {
      const cause = new Error('Original')
      const error = new EvlogError({
        message: 'Test error',
        status: 400,
        why: 'Because',
        fix: 'Do this',
        link: 'https://example.com',
        cause,
      })

      const json = error.toJSON()

      expect(json.name).toBe('EvlogError')
      expect(json.message).toBe('Test error')
      expect(json.status).toBe(400)
      expect(json.data).toEqual({
        why: 'Because',
        fix: 'Do this',
        link: 'https://example.com',
      })
      expect(json.cause).toEqual({ name: 'Error', message: 'Original' })
      // Should NOT include duplicate fields
      expect(json.statusCode).toBeUndefined()
      expect(json.statusMessage).toBeUndefined()
      expect(json.statusText).toBeUndefined()
    })

    it('omits data when no extra fields', () => {
      const error = new EvlogError('Simple error')
      const json = error.toJSON()
      expect(json.data).toBeUndefined()
    })

    it('omits cause when not present', () => {
      const error = new EvlogError('No cause')
      const json = error.toJSON()
      expect(json.cause).toBeUndefined()
    })

    it('includes code under data', () => {
      const error = new EvlogError({
        code: 'PAYMENT_DECLINED',
        message: 'Payment failed',
        status: 402,
      })
      const json = error.toJSON()
      expect((json.data as { code?: string }).code).toBe('PAYMENT_DECLINED')
    })

    it('never includes internal (client-safe JSON)', () => {
      const error = new EvlogError({
        message: 'Public message',
        status: 403,
        why: 'User facing why',
        internal: { correlationId: 'corr-1', riskyDetail: 'issuer raw response' },
      })

      const json = error.toJSON()
      expect(json.internal).toBeUndefined()
      expect((JSON.stringify(error) as string).includes('corr-1')).toBe(false)
      expect((JSON.stringify(error) as string).includes('riskyDetail')).toBe(false)
    })
  })

  describe('data (client payload)', () => {
    it('merges the payload into the data getter', () => {
      const error = createError({
        message: 'Payment failed',
        status: 402,
        why: 'Card declined',
        data: { orderId: 'ord_1', retryable: true },
      })

      expect(error.data).toEqual({ orderId: 'ord_1', retryable: true, why: 'Card declined' })
    })

    it('returns the payload when no guidance field is set', () => {
      expect(createError({ message: 'x', data: { key: 'value' } }).data).toEqual({ key: 'value' })
    })

    it('lets the guidance fields win on a key collision', () => {
      const error = createError({
        message: 'x',
        code: 'PAYMENT_DECLINED',
        data: { code: 'from-payload' },
      })

      expect(error.data?.code).toBe('PAYMENT_DECLINED')
    })

    it('serializes the payload to the client', () => {
      const error = createError({ message: 'x', status: 402, data: { orderId: 'ord_1' } })

      expect(error.toJSON().data).toEqual({ orderId: 'ord_1' })
      expect(serializeEvlogErrorResponse(error, '/api/x').data).toEqual({ orderId: 'ord_1' })
    })

    it('does not duplicate the payload in JSON.stringify(error)', () => {
      const error = createError({ message: 'x', data: { orderId: 'ord_1' } })

      expect(JSON.parse(JSON.stringify(error)).data).toEqual({ orderId: 'ord_1' })
    })
  })

  describe('internal (backend-only)', () => {
    it('exposes internal via getter when provided', () => {
      const error = createError({
        message: 'x',
        internal: { orderId: 'o1', supportRef: 's2' },
      })
      expect(error.internal).toEqual({ orderId: 'o1', supportRef: 's2' })
    })

    it('omits internal from toString()', () => {
      const error = createError({
        message: 'Payment failed',
        why: 'Card declined',
        internal: { gatewayCode: '05', raw: 'do not print' },
      })
      const str = error.toString()
      expect(str).toContain('Payment failed')
      expect(str).toContain('Card declined')
      expect(str).not.toContain('gatewayCode')
      expect(str).not.toContain('do not print')
    })

    it('omits internal from serializeEvlogErrorResponse', () => {
      const error = createError({
        message: 'Bad',
        status: 400,
        why: 'Reason',
        internal: { secret: 'nope' },
      })
      const body = serializeEvlogErrorResponse(error, '/api/x')
      expect(body.internal).toBeUndefined()
      expect(body.data).toEqual({ why: 'Reason' })
    })
  })
})

describe('createError', () => {
  it('creates EvlogError with string', () => {
    const error = createError('Quick error')
    expect(error).toBeInstanceOf(EvlogError)
    expect(error.message).toBe('Quick error')
    expect(error.status).toBeUndefined()
  })

  it('creates EvlogError with options', () => {
    const error = createError({
      message: 'Detailed error',
      status: 422,
      why: 'Reason',
      fix: 'Solution',
    })

    expect(error).toBeInstanceOf(EvlogError)
    expect(error.message).toBe('Detailed error')
    expect(error.status).toBe(422)
    expect(error.why).toBe('Reason')
    expect(error.fix).toBe('Solution')
  })
})

describe('createEvlogError', () => {
  it('is an alias for createError', () => {
    expect(createEvlogError).toBe(createError)
  })

  it('creates EvlogError', () => {
    const error = createEvlogError({
      message: 'Alias test',
      status: 401,
    })

    expect(error).toBeInstanceOf(EvlogError)
    expect(error.status).toBe(401)
  })
})

describe('parseError', () => {
  describe('status/statusText format', () => {
    it('parses status and statusText', () => {
      const fetchError = {
        data: {
          status: 422,
          statusText: 'Validation failed',
          data: { why: 'Invalid input' },
        },
        message: 'Fetch error',
        statusCode: 500,
      }

      const parsed = parseError(fetchError)

      expect(parsed.status).toBe(422)
      expect(parsed.message).toBe('Validation failed')
      expect(parsed.why).toBe('Invalid input')
    })

    it('extracts evlog data (why, fix, link)', () => {
      const fetchError = {
        data: {
          status: 400,
          statusText: 'Bad request',
          data: {
            why: 'Missing required field',
            fix: 'Add the email field',
            link: 'https://docs.example.com',
          },
        },
      }

      const parsed = parseError(fetchError)

      expect(parsed.why).toBe('Missing required field')
      expect(parsed.fix).toBe('Add the email field')
      expect(parsed.link).toBe('https://docs.example.com')
    })
  })

  describe('statusCode/statusMessage format', () => {
    it('parses statusCode and statusMessage', () => {
      const fetchError = {
        data: {
          statusCode: 404,
          statusMessage: 'Not found',
          data: { why: 'Resource does not exist' },
        },
        message: 'Fetch error',
      }

      const parsed = parseError(fetchError)

      expect(parsed.status).toBe(404)
      expect(parsed.message).toBe('Not found')
      expect(parsed.why).toBe('Resource does not exist')
    })
  })

  describe('fallback behavior', () => {
    it('falls back to fetchError status when data.status is missing', () => {
      const fetchError = {
        data: { message: 'Error' },
        status: 503,
        statusCode: 502,
      }

      const parsed = parseError(fetchError)

      expect(parsed.status).toBe(503)
    })

    it('falls back to fetchError message', () => {
      const fetchError = {
        data: {},
        message: 'Network error',
      }

      const parsed = parseError(fetchError)

      expect(parsed.message).toBe('Network error')
    })

    it('defaults to 500 and generic message', () => {
      const fetchError = { data: {} }

      const parsed = parseError(fetchError)

      expect(parsed.status).toBe(500)
      expect(parsed.message).toBe('An error occurred')
    })
  })

  describe('non-fetch errors', () => {
    it('parses standard Error', () => {
      const error = new Error('Something broke')

      const parsed = parseError(error)

      expect(parsed.message).toBe('Something broke')
      expect(parsed.status).toBe(500)
      expect(parsed.raw).toBe(error)
    })

    it('parses unknown values', () => {
      const parsed = parseError('string error')

      expect(parsed.message).toBe('string error')
      expect(parsed.status).toBe(500)
    })
  })

  describe('Error instances with status properties', () => {
    it('respects .status on Error', () => {
      const error = Object.assign(new Error('Bad Request'), { status: 400 })

      const parsed = parseError(error)

      expect(parsed.status).toBe(400)
      expect(parsed.message).toBe('Bad Request')
    })

    it('respects .statusCode on Error', () => {
      const error = Object.assign(new Error('Not Found'), { statusCode: 404 })

      const parsed = parseError(error)

      expect(parsed.status).toBe(404)
    })

    it('prefers .status over .statusCode', () => {
      const error = Object.assign(new Error('Conflict'), { status: 409, statusCode: 500 })

      const parsed = parseError(error)

      expect(parsed.status).toBe(409)
    })

    it('defaults to 500 for plain Error without status', () => {
      const error = new Error('Something broke')

      const parsed = parseError(error)

      expect(parsed.status).toBe(500)
    })

    it('defaults to 500 when status is not a valid number', () => {
      const error = Object.assign(new Error('Weird'), { status: 'bad' })

      const parsed = parseError(error)

      expect(parsed.status).toBe(500)
    })
  })

  describe('data payload', () => {
    it('reads the payload from an EvlogError', () => {
      const error = createError({ message: 'x', why: 'Card declined', data: { orderId: 'ord_1' } })

      expect(parseError(error).data).toEqual({ orderId: 'ord_1', why: 'Card declined' })
    })

    it('reads the payload from a response body', () => {
      const body = { statusCode: 402, message: 'Payment failed', data: { orderId: 'ord_1' } }

      expect(parseError({ data: body }).data).toEqual({ orderId: 'ord_1' })
    })

    it('leaves data undefined when the response body carries none', () => {
      expect(parseError({ data: { statusCode: 500, message: 'Boom' } }).data).toBeUndefined()
    })

    it('reads every field from the error when the payload mimics a response body', () => {
      const error = createError({
        message: 'Payment failed',
        status: 402,
        why: 'Card declined',
        data: {
          statusCode: 'upstream-500',
          statusMessage: 'payload-message',
          data: { value: 1 },
        },
      })

      const parsed = parseError(error)

      expect(parsed.message).toBe('Payment failed')
      expect(parsed.status).toBe(402)
      expect(parsed.why).toBe('Card declined')
      expect(parsed.data).toMatchObject({ statusCode: 'upstream-500', data: { value: 1 } })
    })

    it('leaves data undefined for a serialized error that carries no payload', () => {
      const body = JSON.parse(JSON.stringify(createError({ message: 'Boom', status: 500 })))

      expect(parseError({ data: body }).data).toBeUndefined()
    })

    it('reads the nested payload of a serialized error', () => {
      const body = JSON.parse(JSON.stringify(
        createError({ message: 'Payment failed', status: 402, why: 'Card declined', data: { orderId: 'ord_1' } }),
      ))

      const parsed = parseError({ data: body })

      expect(parsed.why).toBe('Card declined')
      expect(parsed.data).toMatchObject({ orderId: 'ord_1' })
    })

    it('keeps response metadata out of a flat body payload', () => {
      const parsed = parseError({ data: { message: 'Payment failed', status: 402, why: 'Card declined' } })

      expect(parsed.data).toEqual({ why: 'Card declined' })
    })

    it('reads the payload an h3 error holds directly', () => {
      const h3Error = { message: 'Boom', statusCode: 402, data: { orderId: 'ord_1', why: 'Card declined' } }

      const parsed = parseError(h3Error)

      expect(parsed.message).toBe('Boom')
      expect(parsed.status).toBe(402)
      expect(parsed.why).toBe('Card declined')
      expect(parsed.data).toEqual({ orderId: 'ord_1', why: 'Card declined' })
    })

    it('reads a flat body that carries the guidance at the top level', () => {
      const parsed = parseError({ data: { message: 'Payment failed', why: 'Card declined', orderId: 'ord_1' } })

      expect(parsed.message).toBe('Payment failed')
      expect(parsed.why).toBe('Card declined')
      expect(parsed.data).toMatchObject({ orderId: 'ord_1' })
    })

    it('reads a payload whose keys collide with the response body shape', () => {
      const statusCode = createError({ message: 'x', data: { statusCode: 'upstream-500' } })
      expect(parseError(statusCode).data).toEqual({ statusCode: 'upstream-500' })

      const flag = createError({ message: 'x', data: { error: true, field: 'email' } })
      expect(parseError(flag).data).toEqual({ error: true, field: 'email' })
    })
  })

  describe('code extraction', () => {
    it('extracts code from EvlogError JSON shape (nested data.data.code)', () => {
      const fetchError = {
        data: {
          status: 402,
          statusText: 'Payment failed',
          data: { code: 'PAYMENT_DECLINED', why: 'Card declined' },
        },
      }

      const parsed = parseError(fetchError)

      expect(parsed.code).toBe('PAYMENT_DECLINED')
    })

    it('extracts code from h3-style top-level data.code', () => {
      const fetchError = {
        data: {
          status: 400,
          statusText: 'Bad request',
          code: 'VALIDATION_FAILED',
        },
      }

      const parsed = parseError(fetchError)

      expect(parsed.code).toBe('VALIDATION_FAILED')
    })

    it('extracts code from a Node-style Error.code (e.g. ENOENT)', () => {
      const error = Object.assign(new Error('No such file'), { code: 'ENOENT' })

      const parsed = parseError(error)

      expect(parsed.code).toBe('ENOENT')
    })

    it('leaves code undefined for plain Error', () => {
      const parsed = parseError(new Error('boom'))
      expect(parsed.code).toBeUndefined()
    })

    it('ignores non-string code values', () => {
      const error = Object.assign(new Error('boom'), { code: 42 })
      const parsed = parseError(error)
      expect(parsed.code).toBeUndefined()
    })

    it('round-trips code through createError → toJSON → parseError', () => {
      const thrown = createError({
        code: 'PAYMENT_DECLINED',
        message: 'Payment failed',
        status: 402,
        why: 'Card declined',
      })

      const fetchError = { data: thrown.toJSON(), message: thrown.message, statusCode: thrown.status }
      const parsed = parseError(fetchError)

      expect(parsed.code).toBe('PAYMENT_DECLINED')
      expect(parsed.status).toBe(402)
      expect(parsed.why).toBe('Card declined')
    })
  })
})
