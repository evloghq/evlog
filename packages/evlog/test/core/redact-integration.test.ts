import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinPatterns, redactEvent, resolveRedactConfig } from '../../src/redact'
import type { BuiltinPatternName } from '../../src/redact'
import { createLogger, initLogger, log } from '../../src/logger'
import { createPipelineSpies, waitForDrainCalls } from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'
import { expectLinearTime } from '../helpers/timers'


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

  it('masks a credential by value in emitted wide events when its built-in is listed', () => {
    const token = ['npm', 'aZ9'.repeat(12)].join('_')
    initLogger({ pretty: false, redact: { builtins: ['apiKeys'] } })

    const event = defined(createLogger({ note: `publish with ${token}` }).emit(), 'emitted event')
    expect(event.note).toBe('publish with npm_***')
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

  it('leaves pnpm name@version store paths in stack traces untouched', () => {
    let event: Record<string, unknown> = {
      stack: [
        'file:///app/node_modules/.pnpm/h3@1.15.11/node_modules/h3/dist/index.mjs:2007:9',
        'node_modules/.pnpm/unctx@2.5.0/node_modules/unctx/dist/index.mjs:10:3',
        'node_modules/.pnpm/react-dom@18.2.0_react@18.2.0/node_modules/react-dom/index.js:1:1',
      ].join('\n'),
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['email'] }), 'redact config'))
    expect(event.stack).toBe([
      'file:///app/node_modules/.pnpm/h3@1.15.11/node_modules/h3/dist/index.mjs:2007:9',
      'node_modules/.pnpm/unctx@2.5.0/node_modules/unctx/dist/index.mjs:10:3',
      'node_modules/.pnpm/react-dom@18.2.0_react@18.2.0/node_modules/react-dom/index.js:1:1',
    ].join('\n'))
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

  it('masks email addresses with subdomains, uppercase letters, or joined to another address', () => {
    let event: Record<string, unknown> = {
      upper: 'UPPER@EXAMPLE.COM',
      subdomain: 'x@sub.domain.example.museum end',
      list: 'two: a@b.io, c.d@e-f.org.',
      joined: 'alice@example.com-bob@example.org',
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['email'] }), 'redact config'))
    expect(event.upper).toBe('U***@***.COM')
    expect(event.subdomain).toBe('x***@***.museum end')
    expect(event.list).toBe('two: a***@***.io, c***@***.org.')
    expect(event.joined).toBe('a***@***.com-***@***.org')
  })

  it('masks a JWT after a hyphen and one whose header embeds a jwk', () => {
    const signature = 'X'.repeat(43)
    const token = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', signature].join('.')
    // DPoP proof header: the nested `{"kty"` encodes to a second `eyJ` inside the segment.
    const dpopHeader = 'eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiayI6IiIsImp3ayI6eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2In19'
    let event: Record<string, unknown> = {
      key: `jwt-${token}`,
      dpop: `DPoP ${dpopHeader}.eyJodG0iOiJQT1NUIn0.${signature}`,
    }
    event = redactEvent(event, defined(resolveRedactConfig({ builtins: ['jwt'] }), 'redact config'))
    expect(event.key).toBe('jwt-eyJ***.***')
    expect(event.dpop).toBe('DPoP eyJ***.***')
  })

  it('masks long attacker-controlled strings in linear time', () => {
    const config = defined(resolveRedactConfig(true), 'redact config')
    const inputs = [
      'A'.repeat(65_536),
      `a@${'a.'.repeat(32_768)}`,
      'eyJ-'.repeat(16_384),
      'eyJ.'.repeat(16_384),
      `${'x'.repeat(64)}@${`${'a'.repeat(63)}.`.repeat(1_024)}`,
      `${'a'.repeat(32_768)}@${'a.'.repeat(16_384)}`,
      '1.2.3-'.repeat(10_923),
      `eyJa.${'-eyJ.'.repeat(13_107)}`,
    ]
    for (const input of inputs) {
      expectLinearTime(value => redactEvent({ input: value }, config), input, input.slice(0, 16))
    }
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

  it.each([
    ['all built-ins', true],
    ['creditCard listed first', { builtins: ['creditCard', 'iban'] }],
    ['iban listed first', { builtins: ['iban', 'creditCard'] }],
  ] as const)('masks a spaced IBAN whole when card masking is on too (%s)', (_label, input) => {
    const event = redactEvent({ iban: 'FR76 3000 6000 0112 3456 7890 189', card: '4111 1111 1111 1111' }, defined(resolveRedactConfig(input), 'redact config'))
    expect(event).toEqual({ iban: 'FR76****189', card: '****1111' })
  })

  it.each([
    ['all built-ins', true],
    ['iban listed first', { builtins: ['iban', 'creditCard', 'bearer'] }],
  ] as const)('masks a Bearer token whole when it looks like an IBAN or a card (%s)', (_label, input) => {
    const event = redactEvent({ iban: 'Bearer FR76ABCD123456789012', card: 'Bearer 4111111111111111' }, defined(resolveRedactConfig(input), 'redact config'))
    expect(event).toEqual({ iban: 'Bearer ***', card: 'Bearer ***' })
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

describe('credentials detected by value', () => {
  const everyBuiltin = Object.keys(builtinPatterns) as BuiltinPatternName[]
  const config = defined(resolveRedactConfig({ builtins: everyBuiltin }), 'redact config')
  const redact = (event: Record<string, unknown>) => redactEvent(event, config)
  // Fake credentials built from fragments, so no literal token-shaped string sits in the source.
  const body = (n: number) => 'aZ9'.repeat(Math.ceil(n / 3)).slice(0, n)
  const pem = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun',
    'VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n')

  it('leaves credentials as they are with redact: true or a config that does not list them', () => {
    const event = { value: ['ghp', body(36)].join('_'), key: pem, url: 'postgres://user:hunter2@db:5432/app' }
    expect(redactEvent(event, defined(resolveRedactConfig(true), 'redact config'))).toEqual(event)
    expect(redactEvent(event, defined(resolveRedactConfig({ paths: ['user.ssn'] }), 'redact config'))).toEqual(event)
  })

  it.each([
    ['GitHub classic token', ['ghp', body(36)].join('_'), 'ghp_***'],
    ['GitHub OAuth token', ['gho', body(36)].join('_'), 'gho_***'],
    ['GitHub user-to-server token', ['ghu', body(36)].join('_'), 'ghu_***'],
    ['GitHub server-to-server token', ['ghs', body(36)].join('_'), 'ghs_***'],
    ['GitHub refresh token', ['ghr', body(36)].join('_'), 'ghr_***'],
    ['GitHub fine-grained token', ['github', 'pat', body(22), body(59)].join('_'), 'github_pat_***'],
    ['npm token', ['npm', body(36)].join('_'), 'npm_***'],
    ['Anthropic key', ['sk', 'ant', 'api03', body(95)].join('-'), 'sk-ant-***'],
    ['OpenAI project key', ['sk', 'proj', body(40)].join('-'), 'sk-proj-***'],
    ['Stripe secret key', ['sk', 'live', body(24)].join('_'), 'sk_live_***'],
    ['Stripe restricted key', ['rk', 'live', body(24)].join('_'), 'rk_live_***'],
    ['Slack bot token', ['xoxb', '1234567890', 'abcdefghij'].join('-'), 'xoxb-***'],
    ['Slack user token', ['xoxp', '1234567890', 'abcdefghij'].join('-'), 'xoxp-***'],
    ['Slack app token', ['xapp', '1', 'A0', '1234567890', 'abcdef'].join('-'), 'xapp-***'],
    ['AWS access key ID', ['AKIA', 'IOSFODNN7EXAMPLE'].join(''), 'AKIA***'],
    ['AWS session key ID', ['ASIA', 'IOSFODNN7EXAMPLE'].join(''), 'ASIA***'],
  ])('masks a %s by its prefix, keeping the prefix', (_label, token, masked) => {
    expect(redact({ value: token })).toEqual({ value: masked })
  })

  it('masks a token inside a longer string', () => {
    const token = ['ghp', body(36)].join('_')
    expect(redact({ message: `pushed with ${token} from ci` })).toEqual({ message: 'pushed with ghp_*** from ci' })
  })

  it('masks a token logged under a key that is not a secret word', () => {
    const token = ['npm', body(36)].join('_')
    expect(redact({ note: token, log: `npm config set ${token}` })).toEqual({ note: 'npm_***', log: 'npm config set npm_***' })
  })

  it('leaves a token-shaped word that is not a complete credential alone', () => {
    expect(redact({ short: 'ghp_abc', word: 'github_pat' })).toEqual({ short: 'ghp_abc', word: 'github_pat' })
  })

  it('masks a PEM private key block whole, keeping its header', () => {
    expect(redact({ key: pem, after: 'done' })).toEqual({ key: '-----BEGIN RSA PRIVATE KEY-----***', after: 'done' })
  })

  it('masks an unterminated PEM block to the end of the string, so nothing after the header leaks', () => {
    expect(redact({ key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEF\nrest of the value' })).toEqual({ key: '-----BEGIN PRIVATE KEY-----***' })
  })

  it('masks the password in a URL and keeps the user and host', () => {
    expect(redact({ url: 'postgres://user:hunter2@db.internal:5432/app' })).toEqual({ url: 'postgres://user:***@db.internal:5432/app' })
  })

  it('masks a URL password with no user name', () => {
    expect(redact({ url: 'redis://:s3cret@cache:6379' })).toEqual({ url: 'redis://:***@cache:6379' })
  })

  it.each([
    ['email listed first', ['email', 'urlPassword']],
    ['urlPassword listed first', ['urlPassword', 'email']],
  ] as const)('keeps the host of a URL when email masking is on too (%s)', (_label, builtins) => {
    const event = redactEvent({ url: 'postgres://user:hunter2@db.internal:5432/app' }, defined(resolveRedactConfig({ builtins: [...builtins] }), 'redact config'))
    expect(event).toEqual({ url: 'postgres://user:***@db.internal:5432/app' })
  })

  it('does not treat a host with a port or a path as a URL password', () => {
    expect(redact({ url: 'https://example.com:8080/a@b' })).toEqual({ url: 'https://example.com:8080/a@b' })
  })

  it('masks a URL password longer than 256 characters', () => {
    expect(redact({ url: `redis://:${'x'.repeat(300)}@cache:6379` })).toEqual({ url: 'redis://:***@cache:6379' })
  })

  it.each([
    ['redis://:p@ssword@cache:6379', 'redis://:***@cache:6379'],
    ['postgres://app:p@ss@db.internal:5432/app', 'postgres://app:***@db.internal:5432/app'],
  ])('masks a URL password that contains @ up to the last @ before the host (%s)', (url, masked) => {
    expect(redact({ url })).toEqual({ url: masked })
  })

  it.each([
    'postgres://user:pa?ss@host',
    'postgres://user:pa#ss@host',
  ])('masks a URL password that contains ? or # (%s)', (url) => {
    expect(redact({ url })).toEqual({ url: 'postgres://user:***@host' })
  })

  it.each([
    'https://example.com:8080?contact=a@b',
    'https://example.com:8080#to=a@b',
    'https://example.com?time=12:30&to=a@b',
  ])('does not read a query or fragment as a URL password (%s)', (url) => {
    expect(redact({ url })).toEqual({ url })
  })

  it('keeps the host and query when the query after the password holds an @', () => {
    expect(redact({ url: 'http://user:pass@host:8080?x=a@b' })).toEqual({ url: 'http://user:***@host:8080?x=a@b' })
  })

  it('masks tokens in linear time on long attacker-controlled input', () => {
    const inputs = [
      'ghp_'.repeat(13_107),
      'github_pat_'.repeat(5_958),
      'AKIA'.repeat(16_384),
      'sk-ant-'.repeat(9_362),
      'xoxb-1-'.repeat(9_362),
      '-----BEGIN PRIVATE KEY-----'.repeat(2_340),
      '-----BEGIN PRIVATE KEY-----\n'.repeat(2_200),
      'a://a:'.repeat(10_923),
      'a://:'.repeat(13_107),
      `a://${'a:'.repeat(16_384)}`,
      `${'a'.repeat(32)}://${'a'.repeat(256)}:${'a'.repeat(65_000)}`,
      `${'a.'.repeat(16)}a://u:${'a'.repeat(65_000)}`,
      `a://u:${'?'.repeat(65_000)}`,
      `a://u:a${'@?'.repeat(32_000)}`,
      `a://u:a${'@a'.repeat(32_000)}/`,
      `a://u:${'1?'.repeat(32_000)}`,
    ]
    for (const input of inputs) {
      expectLinearTime(value => redactEvent({ input: value }, config), input, input.slice(0, 16))
    }
  })
})
