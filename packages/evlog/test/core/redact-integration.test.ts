import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redactEvent, resolveRedactConfig } from '../../src/redact'
import { createLogger, initLogger, log } from '../../src/logger'
import { createPipelineSpies, waitForDrainCalls } from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'


describe('initLogger + redact integration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    initLogger()
  })

  it('redacts paths in emitted wide events', () => {
    initLogger({
      pretty: false,
      redact: {
        paths: ['user.email'],
      },
    })

    const logger = createLogger({ user: { email: 'alice@example.com', id: '123' } })
    const event = defined(logger.emit(), 'emitted event')
    const user = event.user as Record<string, unknown>
    expect(user.email).toBe('[REDACTED]')
    expect(user.id).toBe('123')
  })

  it('redacts custom patterns with flat replacement', () => {
    initLogger({
      pretty: false,
      redact: {
        builtins: false,
        patterns: [/[\w.+-]+@[\w-]+\.[\w.]+/g],
      },
    })

    const logger = createLogger({ message: 'Contact alice@example.com' })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.message).toBe('Contact [REDACTED]')
  })

  it('redacts before console output', () => {
    const infoSpy = vi.spyOn(console, 'info')

    initLogger({
      pretty: false,
      redact: {
        paths: ['secret'],
      },
    })

    const logger = createLogger({ secret: 'super-secret-value' })
    logger.emit()

    const output = infoSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('[REDACTED]')
    expect(output).not.toContain('super-secret-value')
  })

  it('redacts before drain callback', async () => {
    const { drain } = createPipelineSpies()

    initLogger({
      pretty: false,
      silent: true,
      redact: {
        paths: ['user.email'],
      },
      drain,
    })

    const logger = createLogger({
      user: { email: 'alice@example.com' },
      note: 'Card 4111 1111 1111 1111',
    })
    logger.emit()

    await waitForDrainCalls(drain)
    const drained = getDrainCallArg(defined(drain.mock.calls[0], 'drain call')).event
    expect((drained.user as Record<string, unknown>).email).toBe('[REDACTED]')
    expect(drained.note).toBe('Card ****1111')
  })

  it('redact: true enables all built-in patterns', () => {
    initLogger({ pretty: false, redact: true })

    const logger = createLogger({
      message: 'User alice@example.com paid with 4111-1111-1111-1111 from 192.168.1.100',
    })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.message).not.toContain('alice@example.com')
    expect(event.message).not.toContain('4111-1111-1111-1111')
    expect(event.message).not.toContain('192.168.1.100')
  })

  it('redact: true with custom paths on top', () => {
    initLogger({
      pretty: false,
      redact: {
        paths: ['user.password'],
      },
    })

    const logger = createLogger({
      user: { password: 'secret123', email: 'alice@example.com' },
    })
    const event = defined(logger.emit(), 'emitted event')
    const user = event.user as Record<string, unknown>
    expect(user.password).toBe('[REDACTED]')
    expect(user.email).toBe('a***@***.com')
  })

  it('redact with builtins: false only applies custom config', () => {
    initLogger({
      pretty: false,
      redact: {
        builtins: false,
        paths: ['secret'],
      },
    })

    const logger = createLogger({
      secret: 'hidden',
      email: 'alice@example.com',
    })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.secret).toBe('[REDACTED]')
    expect(event.email).toBe('alice@example.com')
  })

  it('redact with selected builtins', () => {
    initLogger({
      pretty: false,
      redact: {
        builtins: ['email'],
      },
    })

    const logger = createLogger({
      contact: 'alice@example.com',
      card: '4111-1111-1111-1111',
    })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.contact).not.toContain('alice@example.com')
    expect(event.card).toBe('4111-1111-1111-1111')
  })

  it('does not mutate source arrays or objects passed to log.info', () => {
    initLogger({ pretty: false, redact: true })

    const array = ['1.2.3.4']
    const object = { redactedValue: '1.2.3.4' }
    const str = '1.2.3.4'

    log.info({ array })
    expect(array).toEqual(['1.2.3.4'])

    log.info({ object })
    expect(object).toEqual({ redactedValue: '1.2.3.4' })

    log.info({ str })
    expect(str).toBe('1.2.3.4')
  })

  it('does not mutate nested context when createLogger emits', () => {
    initLogger({ pretty: false, redact: true })

    const nested = { ip: '192.168.1.100' }
    const array = ['10.0.0.1']
    const logger = createLogger({ nested, array })
    const event = defined(logger.emit(), 'emitted event')

    expect(nested.ip).toBe('192.168.1.100')
    expect(array).toEqual(['10.0.0.1'])
    expect((event.nested as Record<string, unknown>).ip).toBe('***.***.***.100')
    expect(event.array).toEqual(['***.***.***.1'])
  })

  it('emits native error causes without mutating readonly properties', () => {
    initLogger({
      pretty: false,
      redact: {
        builtins: false,
        paths: ['*code'],
      },
    })

    const error = Object.assign(new Error('Upstream request failed'), {
      code: 'UPSTREAM_TIMEOUT',
      cause: new DOMException('Upstream request timed out', 'TimeoutError'),
    })
    const logger = createLogger()
    logger.error(error)
    const event = defined(logger.emit(), 'emitted event')

    expect(event.error).toMatchObject({
      code: '[REDACTED]',
      cause: { name: 'TimeoutError', message: 'Upstream request timed out', code: '[REDACTED]' },
    })
    expect(error.cause.code).toBe(DOMException.TIMEOUT_ERR)
  })

  it('applies a computed replacement to the console sink', () => {
    const infoSpy = vi.spyOn(console, 'info')

    initLogger({
      pretty: false,
      stringify: true,
      redact: {
        builtins: false,
        patterns: [/\/public\/claim\/([A-Za-z0-9._-]{12,})/g],
        replacement: (_match, ctx) => `/public/claim/[tok:${fingerprint(defined(ctx.groups?.[0], 'token'))}]`,
      },
    })

    const logger = createLogger({ path: '/public/claim/eyJhbGciOiJIUzI1NiJ9' })
    logger.emit()

    const output = defined(infoSpy.mock.calls[0]?.[0], 'console output') as string
    expect(output).toContain('/public/claim/[tok:')
    expect(output).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  it('runs transform before the console write', () => {
    const infoSpy = vi.spyOn(console, 'info')

    initLogger({
      pretty: false,
      stringify: true,
      redact: {
        builtins: false,
        transform: (event) => {
          if (event.tenant === 'regulated') delete event.query
        },
      },
    })

    const logger = createLogger({ tenant: 'regulated', query: 'name=alice' })
    const event = defined(logger.emit(), 'emitted event')

    expect(event).not.toHaveProperty('query')
    expect(defined(infoSpy.mock.calls[0]?.[0], 'console output') as string).not.toContain('name=alice')
  })

  it('keeps logging when a transform throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info')

    initLogger({
      pretty: false,
      stringify: true,
      redact: {
        paths: ['password'],
        transform: () => {
          throw new Error('bad hook')
        },
      },
    })

    const logger = createLogger({ password: 'hunter2', route: '/checkout' })
    const event = defined(logger.emit(), 'emitted event')

    expect(event.password).toBe('[REDACTED]')
    expect(event.route).toBe('/checkout')
    expect(errorSpy).toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalled()
  })
})

/** Stand-in for a real keyed hash — the point is that it is derived and stable. */
function fingerprint(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16).slice(0, 6)
}

describe('default redaction behavior', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    vi.restoreAllMocks()
    initLogger()
  })

  it('enables redaction by default in production', () => {
    process.env.NODE_ENV = 'production'
    initLogger({ pretty: false })

    const logger = createLogger({ email: 'alice@example.com' })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.email).toBe('a***@***.com')
  })

  it('disables redaction by default in development', () => {
    process.env.NODE_ENV = 'development'
    initLogger({ pretty: false })

    const logger = createLogger({ email: 'alice@example.com' })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.email).toBe('alice@example.com')
  })

  it('respects explicit redact: false in production', () => {
    process.env.NODE_ENV = 'production'
    initLogger({ pretty: false, redact: false })

    const logger = createLogger({ email: 'alice@example.com' })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.email).toBe('alice@example.com')
  })

  it('respects explicit redact: true in development', () => {
    process.env.NODE_ENV = 'development'
    initLogger({ pretty: false, redact: true })

    const logger = createLogger({ email: 'alice@example.com' })
    const event = defined(logger.emit(), 'emitted event')
    expect(event.email).toBe('a***@***.com')
  })
})

describe('built-in smart masking', () => {
  it('masks credit card numbers keeping last 4 digits', () => {
    let event: Record<string, unknown> = {
      a: '4111111111111111',
      b: '4111-1111-1111-1111',
      c: '4111 1111 1111 1111',
      safe: 'no card here',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['creditCard'] }), 'redact config'))
    expect(event.a).toBe('****1111')
    expect(event.b).toBe('****1111')
    expect(event.c).toBe('****1111')
    expect(event.safe).toBe('no card here')
  })

  it('masks email addresses keeping first char and TLD', () => {
    let event: Record<string, unknown> = {
      a: 'alice@example.com',
      b: 'Contact bob.smith+tag@company.co.uk',
      safe: 'no email here',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['email'] }), 'redact config'))
    expect(event.a).toBe('a***@***.com')
    expect(event.b).toBe('Contact b***@***.uk')
    expect(event.safe).toBe('no email here')
  })

  it('masks IPv4 addresses keeping last octet', () => {
    let event: Record<string, unknown> = {
      a: '192.168.1.1',
      b: 'Client 10.0.0.5 connected',
      localhost: '127.0.0.1',
      zero: '0.0.0.0',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['ipv4'] }), 'redact config'))
    expect(event.a).toBe('***.***.***.1')
    expect(event.b).toBe('Client ***.***.***.5 connected')
    expect(event.localhost).toBe('127.0.0.1')
    expect(event.zero).toBe('0.0.0.0')
  })

  it('masks international phone numbers keeping last 2 digits', () => {
    let event: Record<string, unknown> = {
      us: '+1 (555) 123-4567',
      fr: '+33 6 12 34 56 78',
      uk: '+44 7911 123456',
      de: '+49 170 1234567',
      parens: '(555) 123-4567',
      safe: 'no phone here',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['phone'] }), 'redact config'))
    expect(event.us).toContain('****')
    expect(event.us).not.toContain('555')
    expect(event.fr).not.toContain('12 34')
    expect(event.de).not.toContain('1234567')
    expect(event.parens).not.toContain('555')
    expect(event.safe).toBe('no phone here')
  })

  it('does not mask digit-rich identifiers (UUIDs, hex hashes, ids)', () => {
    let event: Record<string, unknown> = {
      uuid: '12345642-f647-42bb-9fda-742d2b4f41fa',
      requestId: '00000000-1111-2222-3333-444444444444',
      idempotencyKey: '961da3f34097bb096902b5457ae02687',
      orderId: 'ord_1234567890',
      bareDigits: '0612345678',
      localPhone: '06 12 34 56 78',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['phone'] }), 'redact config'))
    expect(event.uuid).toBe('12345642-f647-42bb-9fda-742d2b4f41fa')
    expect(event.requestId).toBe('00000000-1111-2222-3333-444444444444')
    expect(event.idempotencyKey).toBe('961da3f34097bb096902b5457ae02687')
    expect(event.orderId).toBe('ord_1234567890')
    expect(event.bareDigits).toBe('0612345678')
    expect(event.localPhone).toBe('06 12 34 56 78')
  })

  it('masks JWT tokens keeping prefix', () => {
    // Build the JWT-shape from fragments so secret scanners don't flag the
    // file as containing a real token. Same shape (header.payload.signature),
    // no semantic value.
    const tokenTail = 'X'.repeat(86)
    const token = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', tokenTail].join('.')
    let event: Record<string, unknown> = {
      auth: `Token: ${token}`,
      safe: 'no jwt here',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['jwt'] }), 'redact config'))
    expect(event.auth).toContain('eyJ***')
    expect(event.auth).not.toContain(tokenTail)
    expect(event.safe).toBe('no jwt here')
  })

  it('masks Bearer tokens keeping prefix', () => {
    // Stripe-shaped key built from fragments to avoid secret-scanner alarms.
    const fakeStripeKey = ['sk', 'live', 'abc123def456ghi789'].join('_')
    let event: Record<string, unknown> = {
      header: `Bearer ${fakeStripeKey}`,
      safe: 'no bearer here',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['bearer'] }), 'redact config'))
    expect(event.header).toContain('Bearer')
    expect(event.header).not.toContain(fakeStripeKey)
    expect(event.safe).toBe('no bearer here')
  })

  it('masks IBAN numbers keeping country code and last 3 digits', () => {
    let event: Record<string, unknown> = {
      fr: 'FR76 3000 6000 0112 3456 7890 189',
      de: 'DE89 3704 0044 0532 0130 00',
      safe: 'no iban here',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['iban'] }), 'redact config'))
    expect(event.fr).toContain('FR76')
    expect(event.fr).not.toContain('3000')
    expect(event.de).toContain('DE89')
    expect(event.de).not.toContain('3704')
    expect(event.safe).toBe('no iban here')
  })
})
