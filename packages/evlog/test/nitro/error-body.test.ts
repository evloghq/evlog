import { createError as h3CreateError } from 'h3'
import { describe, expect, it } from 'vitest'
import { createError } from '../../src/error'
import { buildPlainNitroErrorBody, serializeEvlogErrorResponse } from '../../src/nitro'

describe('Nitro HTTP error body', () => {
  it('sends an EvlogError as status and message, with the guidance under data', () => {
    const error = createError({ message: 'Payment failed', status: 402, why: 'Card declined', fix: 'Use another card' })

    expect(serializeEvlogErrorResponse(error, '/api/checkout')).toEqual({
      url: '/api/checkout',
      status: 402,
      message: 'Payment failed',
      error: true,
      data: { why: 'Card declined', fix: 'Use another card' },
    })
  })

  it('sends a plain h3 error as status and message', () => {
    const error = h3CreateError({ statusCode: 404, statusMessage: 'Not Found', message: 'No such order' })

    expect(buildPlainNitroErrorBody(error, '/api/orders/1', { isDev: false })).toEqual({
      url: '/api/orders/1',
      status: 404,
      message: 'No such order',
      error: true,
    })
  })

  it('falls back to the h3 status message when the error has no message', () => {
    const error = h3CreateError({ statusCode: 400, statusMessage: 'Bad Request' })
    error.message = ''

    expect(buildPlainNitroErrorBody(error, '/api/x', { isDev: false })).toMatchObject({ status: 400, message: 'Bad Request' })
  })

  it('withholds the message of a sensitive error in production', () => {
    expect(buildPlainNitroErrorBody(new Error('db password leaked'), '/api/x', { isDev: false })).toEqual({
      url: '/api/x',
      status: 500,
      message: 'Internal Server Error',
      error: true,
    })
  })
})
