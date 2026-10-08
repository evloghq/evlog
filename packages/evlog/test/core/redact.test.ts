import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redactEvent, normalizeRedactConfig, resolveRedactConfig, builtinPatterns, hasFunctionRedactPolicy, FUNCTION_REDACT_POLICY_WARNING, prepareRedactForBridge, compileRedactPathMatchers, redactPathsInTree } from '../../src/redact'
import type { RedactConfig } from '../../src/types'
import { createLogger, initLogger } from '../../src/logger'
import { defined } from '../helpers/defined'

describe('redactEvent - path-based', () => {
  it('redacts a top-level field', () => {
    const source: Record<string, unknown> = { email: 'alice@example.com', name: 'Alice' }
    const event = redactEvent(source, { paths: ['email'] })
    expect(event.email).toBe('[REDACTED]')
    expect(event.name).toBe('Alice')
    expect(source.email).toBe('alice@example.com')
  })

  it('redacts a nested field', () => {
    let event: Record<string, unknown> = {
      user: { id: '123', email: 'alice@example.com', plan: 'pro' },
    }
    event = redactEvent(event, { paths: ['user.email'] })
    const user = event.user as Record<string, unknown>
    expect(user.email).toBe('[REDACTED]')
    expect(user.id).toBe('123')
    expect(user.plan).toBe('pro')
  })

  it('redacts deeply nested fields', () => {
    let event: Record<string, unknown> = {
      payment: { card: { number: '4111111111111111', expiry: '12/26' } },
    }
    event = redactEvent(event, { paths: ['payment.card.number'] })
    const card = (event.payment as Record<string, unknown>).card as Record<string, unknown>
    expect(card.number).toBe('[REDACTED]')
    expect(card.expiry).toBe('12/26')
  })

  it('silently skips missing paths', () => {
    let event: Record<string, unknown> = { name: 'Alice' }
    event = redactEvent(event, { paths: ['user.email', 'nonexistent'] })
    expect(event.name).toBe('Alice')
    expect(event).not.toHaveProperty('user')
  })

  it('redacts multiple paths', () => {
    let event: Record<string, unknown> = {
      user: { email: 'alice@example.com', ip: '192.168.1.1' },
      token: 'secret-jwt-token',
    }
    event = redactEvent(event, { paths: ['user.email', 'user.ip', 'token'] })
    const user = event.user as Record<string, unknown>
    expect(user.email).toBe('[REDACTED]')
    expect(user.ip).toBe('[REDACTED]')
    expect(event.token).toBe('[REDACTED]')
  })

  it('uses custom replacement string', () => {
    let event: Record<string, unknown> = { user: { email: 'alice@example.com' } }
    event = redactEvent(event, { paths: ['user.email'], replacement: '***' })
    expect((event.user as Record<string, unknown>).email).toBe('***')
  })

  it('redacts non-string values at path', () => {
    let event: Record<string, unknown> = {
      user: { age: 25, settings: { notifications: true } },
    }
    event = redactEvent(event, { paths: ['user.age', 'user.settings'] })
    const user = event.user as Record<string, unknown>
    expect(user.age).toBe('[REDACTED]')
    expect(user.settings).toBe('[REDACTED]')
  })

  it('does not redact nested email when exact path is user.email only', () => {
    const event = redactEvent(
      { user: { email: 'a@b.com' }, other: { email: 'c@d.com' } },
      { paths: ['user.email'] },
    )
    expect((event.user as Record<string, unknown>).email).toBe('[REDACTED]')
    expect((event.other as Record<string, unknown>).email).toBe('c@d.com')
  })
})

describe('redactEvent - path globs', () => {
  it('redacts password at any nesting depth via shorthand', () => {
    const source: Record<string, unknown> = {
      password: 'top',
      user: { name: 'Alice', password: 'secret' },
      data: { a: { b: { password: 'deep' } } },
    }
    const event = redactEvent(source, { paths: ['password'] })
    expect(event.password).toBe('[REDACTED]')
    expect((event.user as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((event.user as Record<string, unknown>).name).toBe('Alice')
    const deep = (event.data as Record<string, unknown>).a as Record<string, unknown>
    expect((deep.b as Record<string, unknown>).password).toBe('[REDACTED]')
    expect(source.user).toEqual({ name: 'Alice', password: 'secret' })
  })

  it('treats password and **.password as equivalent', () => {
    const data = {
      user: { password: 'secret' },
      password: 'top',
    }
    const shorthand = redactEvent(data, { paths: ['password'] })
    const explicit = redactEvent(data, { paths: ['**.password'] })
    expect(shorthand).toEqual(explicit)
  })

  it('replaces the entire matched value without recursing into children', () => {
    const event = redactEvent(
      { password: { nested: 'still-here' } },
      { paths: ['password'] },
    )
    expect(event.password).toBe('[REDACTED]')
  })

  it('redacts multiple shorthand segments', () => {
    const event = redactEvent(
      {
        password: 'p',
        token: 't',
        user: { apiKey: 'k', name: 'Alice' },
      },
      { paths: ['password', 'token', 'apiKey'] },
    )
    expect(event.password).toBe('[REDACTED]')
    expect(event.token).toBe('[REDACTED]')
    expect((event.user as Record<string, unknown>).apiKey).toBe('[REDACTED]')
    expect((event.user as Record<string, unknown>).name).toBe('Alice')
  })

  it('matches key-name globs without dots', () => {
    const event = redactEvent(
      {
        access_token: 'a',
        refresh_token: 'r',
        nested: { access_token: 'n' },
        username: 'alice',
      },
      { paths: ['*_token'] },
    )
    expect(event.access_token).toBe('[REDACTED]')
    expect(event.refresh_token).toBe('[REDACTED]')
    expect((event.nested as Record<string, unknown>).access_token).toBe('[REDACTED]')
    expect(event.username).toBe('alice')
  })

  it('matches path globs under a prefix', () => {
    const event = redactEvent(
      {
        user: { email: 'a@b.com', password: 'secret' },
        admin: { email: 'c@d.com' },
      },
      { paths: ['user.*'] },
    )
    expect((event.user as Record<string, unknown>).email).toBe('[REDACTED]')
    expect((event.user as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((event.admin as Record<string, unknown>).email).toBe('c@d.com')
  })

  it('combines globs and exact paths', () => {
    const event = redactEvent(
      {
        password: 'everywhere',
        headers: { 'x-forwarded-for': '1.2.3.4', authorization: 'Bearer x' },
      },
      {
        paths: ['password', 'authorization', 'headers.x-forwarded-for'],
      },
    )
    expect(event.password).toBe('[REDACTED]')
    expect((event.headers as Record<string, unknown>).authorization).toBe('[REDACTED]')
    expect((event.headers as Record<string, unknown>)['x-forwarded-for']).toBe('[REDACTED]')
  })

  it('uses custom replacement string', () => {
    const event = redactEvent(
      { user: { password: 'secret' } },
      { paths: ['password'], replacement: '***' },
    )
    expect((event.user as Record<string, unknown>).password).toBe('***')
  })

  it('redacts header keys case-insensitively', () => {
    const event = redactEvent(
      {
        headers: { Authorization: 'Bearer x', Cookie: 'sid=1' },
      },
      { paths: ['authorization', 'cookie'] },
    )
    const headers = event.headers as Record<string, unknown>
    expect(headers.Authorization).toBe('[REDACTED]')
    expect(headers.Cookie).toBe('[REDACTED]')
  })

  it('redacts audit.changes nested passwords via segment shorthand', () => {
    const event = redactEvent(
      {
        audit: {
          changes: {
            before: { password: 'old' },
            after: { password: 'new' },
          },
        },
      },
      { paths: ['password'] },
    )
    const changes = (event.audit as Record<string, unknown>).changes as Record<string, unknown>
    expect((changes.before as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((changes.after as Record<string, unknown>).password).toBe('[REDACTED]')
  })
})

describe('redactEvent - pattern-based', () => {
  it('redacts credit card numbers', () => {
    const ccPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g
    let event: Record<string, unknown> = {
      message: 'Card 4111 1111 1111 1111 was declined',
      other: 'no card here',
    }
    event = redactEvent(event, { patterns: [ccPattern] })
    expect(event.message).toBe('Card [REDACTED] was declined')
    expect(event.other).toBe('no card here')
  })

  it('redacts email addresses', () => {
    const emailPattern = /[\w.+-]+@[\w-]+\.[\w.]+/g
    let event: Record<string, unknown> = {
      user: { note: 'Contact alice@example.com for details' },
    }
    event = redactEvent(event, { patterns: [emailPattern] })
    expect((event.user as Record<string, unknown>).note).toBe('Contact [REDACTED] for details')
  })

  it('redacts IP addresses', () => {
    const ipPattern = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g
    let event: Record<string, unknown> = {
      client: { ip: '192.168.1.1' },
      log: 'Connection from 10.0.0.5 established',
    }
    event = redactEvent(event, { patterns: [ipPattern] })
    expect((event.client as Record<string, unknown>).ip).toBe('[REDACTED]')
    expect(event.log).toBe('Connection from [REDACTED] established')
  })

  it('applies multiple patterns', () => {
    const emailPattern = /[\w.+-]+@[\w-]+\.[\w.]+/g
    const ipPattern = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g
    let event: Record<string, unknown> = {
      message: 'User alice@example.com connected from 10.0.0.1',
    }
    event = redactEvent(event, { patterns: [emailPattern, ipPattern] })
    expect(event.message).toBe('User [REDACTED] connected from [REDACTED]')
  })

  it('handles arrays with string values', () => {
    const emailPattern = /[\w.+-]+@[\w-]+\.[\w.]+/g
    let event: Record<string, unknown> = {
      recipients: ['alice@example.com', 'bob@example.com', 'not-an-email'],
    }
    event = redactEvent(event, { patterns: [emailPattern] })
    const recipients = event.recipients as string[]
    expect(recipients[0]).toBe('[REDACTED]')
    expect(recipients[1]).toBe('[REDACTED]')
    expect(recipients[2]).toBe('not-an-email')
  })

  it('handles arrays with nested objects', () => {
    const emailPattern = /[\w.+-]+@[\w-]+\.[\w.]+/g
    let event: Record<string, unknown> = {
      users: [
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob', email: 'bob@test.com' },
      ],
    }
    event = redactEvent(event, { patterns: [emailPattern] })
    const users = event.users as Record<string, unknown>[]
    expect(defined(users[0], 'users[0]').email).toBe('[REDACTED]')
    expect(defined(users[1], 'users[1]').email).toBe('[REDACTED]')
    expect(defined(users[0], 'users[0]').name).toBe('Alice')
  })

  it('uses custom replacement string', () => {
    let event: Record<string, unknown> = {
      message: 'User alice@example.com logged in',
    }
    event = redactEvent(event, {
      patterns: [/[\w.+-]+@[\w-]+\.[\w.]+/g],
      replacement: '***',
    })
    expect(event.message).toBe('User *** logged in')
  })

  it('skips non-string non-object values', () => {
    let event: Record<string, unknown> = {
      count: 42,
      active: true,
      name: null,
    }
    event = redactEvent(event, { patterns: [/test/g] })
    expect(event.count).toBe(42)
    expect(event.active).toBe(true)
    expect(event.name).toBeNull()
  })
})

describe('redactEvent - combined paths + patterns', () => {
  it('applies both path and pattern redaction', () => {
    let event: Record<string, unknown> = {
      user: {
        email: 'alice@example.com',
        ip: '192.168.1.1',
      },
      message: 'Payment with card 4111-1111-1111-1111 processed',
    }
    event = redactEvent(event, {
      paths: ['user.email', 'user.ip'],
      patterns: [/\b\d{4}[-]?\d{4}[-]?\d{4}[-]?\d{4}\b/g],
    })
    const user = event.user as Record<string, unknown>
    expect(user.email).toBe('[REDACTED]')
    expect(user.ip).toBe('[REDACTED]')
    expect(event.message).toBe('Payment with card [REDACTED] processed')
  })
})

describe('redactEvent - edge cases', () => {
  it('does not mutate nested references in the input', () => {
    const nested = { ip: '192.168.1.1' }
    const array = ['192.168.1.2']
    const source: Record<string, unknown> = { nested, items: array }
    const redacted = redactEvent(source, defined(resolveRedactConfig({ builtins: ['ipv4'] }), 'redact config'))

    expect(nested.ip).toBe('192.168.1.1')
    expect(array).toEqual(['192.168.1.2'])
    expect((redacted.nested as Record<string, unknown>).ip).toBe('***.***.***.1')
    expect(redacted.items).toEqual(['***.***.***.2'])
  })

  it('redacts events that contain non-cloneable values', () => {
    const source: Record<string, unknown> = {
      email: 'alice@example.com',
      handler: () => {},
    }
    const redacted = redactEvent(source, { patterns: [/[\w.+-]+@[\w-]+\.[\w.]+/g] })
    expect(typeof source.handler).toBe('function')
    expect(redacted.email).toBe('[REDACTED]')
    expect(redacted).not.toHaveProperty('handler')
  })

  it('leaves prototype accessors of native objects alone during path redaction', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cause = new DOMException('Upstream request timed out', 'TimeoutError')
    const redacted = redactEvent(
      {
        error: {
          code: 'UPSTREAM_TIMEOUT',
          cause,
        },
      },
      { paths: ['*code'] },
    )

    expect(redacted).toMatchObject({
      error: {
        code: '[REDACTED]',
        cause: expect.any(DOMException),
      },
    })
    expect(cause.name).toBe('TimeoutError')
    // `DOMException.code` matches `*code`, but it lives on the prototype: the walk
    // never sees it, so there is nothing to fail to write.
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('leaves prototype accessors of native objects alone during pattern redaction', () => {
    const cause = new DOMException('Contact alice@example.com', 'NetworkError')
    const redacted = redactEvent(
      {
        message: 'Contact alice@example.com',
        error: { cause },
      },
      { patterns: [/[\w.+-]+@[\w-]+\.[\w.]+/g] },
    )

    expect(redacted.message).toBe('Contact [REDACTED]')
    expect(redacted).toMatchObject({
      error: {
        cause: expect.objectContaining({
          message: 'Contact alice@example.com',
        }),
      },
    })
  })

  it('leaves prototype accessors of native objects alone during built-in masking', () => {
    const cause = new DOMException('Contact alice@example.com', 'NetworkError')
    const config = defined(resolveRedactConfig({ builtins: ['email'] }), 'redact config')
    const redacted = redactEvent(
      {
        message: 'Contact alice@example.com',
        error: { cause },
      },
      config,
    )

    expect(redacted.message).toBe('Contact a***@***.com')
    expect(redacted).toMatchObject({
      error: {
        cause: expect.objectContaining({
          message: 'Contact alice@example.com',
        }),
      },
    })
  })

  // Skipping every non-plain object would also skip these — a class instance
  // reaching the walker un-cloned still carries its own fields in the open.
  it('redacts own fields of a class instance', () => {
    class Session {
      constructor(public readonly userId: string, public token: string) {}
    }

    const tree: Record<string, unknown> = { session: new Session('u_1', 'sk_live_secret') }
    redactPathsInTree(tree, defined(compileRedactPathMatchers(['token']), 'matchers'), '[REDACTED]')

    expect((tree.session as Session).token).toBe('[REDACTED]')
    expect((tree.session as Session).userId).toBe('u_1')
  })

  it('warns instead of throwing when a matched field cannot be rewritten', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const frozen = Object.defineProperty({}, 'token', {
      value: 'sk_live_secret',
      enumerable: true,
      writable: false,
      configurable: false,
    })

    expect(() => {
      redactPathsInTree({ frozen }, defined(compileRedactPathMatchers(['token']), 'matchers'), '[REDACTED]')
    }).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('frozen.token'))
  })

  it('handles empty config gracefully', () => {
    let event: Record<string, unknown> = { user: { email: 'alice@example.com' } }
    event = redactEvent(event, {})
    expect((event.user as Record<string, unknown>).email).toBe('alice@example.com')
  })

  it('handles empty paths array', () => {
    let event: Record<string, unknown> = { secret: 'value' }
    event = redactEvent(event, { paths: [] })
    expect(event.secret).toBe('value')
  })

  it('handles empty patterns array', () => {
    let event: Record<string, unknown> = { secret: 'value' }
    event = redactEvent(event, { patterns: [] })
    expect(event.secret).toBe('value')
  })

  it('handles null/undefined values in the tree', () => {
    let event: Record<string, unknown> = {
      user: null,
      data: undefined,
      valid: 'test@example.com',
    }
    event = redactEvent(event, {
      paths: ['user.email'],
      patterns: [/[\w.+-]+@[\w-]+\.[\w.]+/g],
    })
    expect(event.user).toBeNull()
    expect(event.data).toBeUndefined()
    expect(event.valid).toBe('[REDACTED]')
  })
})

describe('resolveRedactConfig', () => {
  it('returns undefined for false', () => {
    expect(resolveRedactConfig(false)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(resolveRedactConfig(undefined)).toBeUndefined()
  })

  it('returns all built-in maskers for true', () => {
    const config = defined(resolveRedactConfig(true), 'redact config')
    expect(config._maskers).toHaveLength(Object.keys(builtinPatterns).length)
  })

  it('includes built-in maskers by default when object is passed', () => {
    const config = defined(resolveRedactConfig({ paths: ['user.password'] }), 'redact config')
    expect(config.paths).toEqual(['user.password'])
    expect(config._maskers).toHaveLength(Object.keys(builtinPatterns).length)
  })

  it('disables built-ins with builtins: false', () => {
    const config = defined(resolveRedactConfig({ builtins: false, paths: ['user.email'] }), 'redact config')
    expect(config.paths).toEqual(['user.email'])
    expect(config._maskers).toBeUndefined()
    expect(config.patterns).toBeUndefined()
  })

  it('selects specific built-in maskers', () => {
    const config = defined(resolveRedactConfig({ builtins: ['email', 'creditCard'] }), 'redact config')
    expect(config._maskers).toHaveLength(2)
  })

  it('keeps custom patterns separate from built-in maskers', () => {
    const custom = /SECRET_\w+/g
    const config = defined(resolveRedactConfig({
      builtins: ['email'],
      patterns: [custom],
    }), 'redact config')
    expect(config._maskers).toHaveLength(1)
    expect(config.patterns).toHaveLength(1)
  })

  it('precompiles path matchers', () => {
    const config = defined(resolveRedactConfig({ paths: ['user.password', '*_token'] }), 'redact config')
    expect(config._pathMatchers).toBeDefined()

    const redacted = redactEvent({ user: { password: 'hunter2' }, api_token: 'abc' }, config)
    expect((redacted.user as Record<string, unknown>).password).toBe('[REDACTED]')
    expect(redacted.api_token).toBe('[REDACTED]')
  })

  it('redacts identically with and without precompiled matchers', () => {
    const event = { user: { Password: 'hunter2', name: 'jo' }, nested: { secret_token: 'x' } }
    const paths = ['password', '*_token']
    const resolved = defined(resolveRedactConfig({ builtins: false, paths }), 'redact config')
    const adHoc: RedactConfig = { builtins: false, paths }
    expect(redactEvent(event, resolved)).toEqual(redactEvent(event, adHoc))
  })
})

describe('normalizeRedactConfig', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeRedactConfig(undefined)).toBeUndefined()
  })

  it('returns undefined for false', () => {
    expect(normalizeRedactConfig(false)).toBeUndefined()
  })

  it('resolves true to all built-in maskers', () => {
    const config = defined(normalizeRedactConfig(true), 'redact config')
    expect(defined(config._maskers, 'maskers').length).toBe(Object.keys(builtinPatterns).length)
  })

  it('preserves paths and replacement', () => {
    const config = normalizeRedactConfig({
      paths: ['user.email'],
      replacement: '***',
    })
    expect(config?.paths).toEqual(['user.email'])
    expect(config?.replacement).toBe('***')
  })

  it('converts string patterns to RegExp separately from built-in maskers', () => {
    const config = defined(normalizeRedactConfig({
      patterns: ['\\b\\d{4}\\b'],
    }), 'redact config')
    expect(config._maskers).toHaveLength(Object.keys(builtinPatterns).length)
    expect(config.patterns).toHaveLength(1)
    expect(defined(config.patterns?.[0], 'patterns[0]').source).toBe('\\b\\d{4}\\b')
  })

  it('converts source/flags objects to RegExp', () => {
    const config = defined(normalizeRedactConfig({
      builtins: false,
      patterns: [{ source: '\\d+', flags: 'gi' }],
    }), 'redact config')
    const pattern = defined(config.patterns?.[0], 'patterns[0]')
    expect(pattern).toBeInstanceOf(RegExp)
    expect(pattern.source).toBe('\\d+')
    expect(pattern.flags).toBe('gi')
  })

  it('preserves existing RegExp instances', () => {
    const re = /test/g
    const config = defined(normalizeRedactConfig({
      builtins: false,
      patterns: [re],
    }), 'redact config')
    const pattern = defined(config.patterns?.[0], 'patterns[0]')
    expect(pattern.source).toBe(re.source)
    expect(pattern.flags).toBe(re.flags)
  })

  it('filters out invalid pattern entries', () => {
    const config = normalizeRedactConfig({
      builtins: false,
      patterns: ['valid', 42, null, undefined],
    })
    expect(config?.patterns).toHaveLength(1)
  })

  it('ignores invalid regex sources without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = normalizeRedactConfig({
      builtins: false,
      patterns: ['valid', '(unclosed', { source: '[', flags: 'g' }],
    })
    expect(config?.patterns).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns on pattern objects without a source field instead of dropping them silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = normalizeRedactConfig({
      builtins: false,
      patterns: [{ source: '\\d+' }, {}],
    })
    expect(config?.patterns).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('[normalizeRedactConfig] Ignoring redact pattern object without a `source` field')
    warn.mockRestore()
  })

  it('handles builtins field from deserialized JSON', () => {
    const config = normalizeRedactConfig({
      builtins: ['email', 'creditCard'],
      paths: ['user.ssn'],
    })
    expect(config?._maskers).toHaveLength(2)
    expect(config?.paths).toEqual(['user.ssn'])
  })
})

describe('redactEvent - function replacement', () => {
  it('derives the replacement from a path-matched value', () => {
    const event = redactEvent(
      { user: { email: 'alice@example.com' } },
      { builtins: false, paths: ['user.email'], replacement: matched => `len:${String(matched).length}` },
    )
    expect((event.user as Record<string, unknown>).email).toBe('len:17')
  })

  it('passes the dot path and leaf key for path matches', () => {
    const seen: Array<{ path: string, key: string }> = []
    redactEvent(
      { user: { email: 'a@b.co' }, items: [{ token: 'x' }] },
      {
        builtins: false,
        paths: ['user.email', 'token'],
        replacement: (_matched, ctx) => {
          seen.push({ path: ctx.path, key: ctx.key })
          return '[x]'
        },
      },
    )
    expect(seen).toEqual([
      { path: 'user.email', key: 'email' },
      { path: 'items.0.token', key: 'token' },
    ])
  })

  it('receives the whole subtree when a path matches an object', () => {
    let matched: unknown
    redactEvent(
      { payment: { card: { number: '4111', expiry: '12/26' } } },
      {
        builtins: false,
        paths: ['payment.card'],
        replacement: (value) => {
          matched = value
          return '[card]'
        },
      },
    )
    expect(matched).toEqual({ number: '4111', expiry: '12/26' })
  })

  it('derives the replacement from a pattern match, with capture groups', () => {
    const event = redactEvent(
      { path: '/public/claim/eyJhbGciOiJIUzI1NiJ9' },
      {
        builtins: false,
        patterns: [/\/public\/claim\/([A-Za-z0-9._-]{12,})/g],
        replacement: (_match, ctx) => `/public/claim/[tok:${defined(ctx.groups?.[0], 'group').slice(0, 6)}]`,
      },
    )
    expect(event.path).toBe('/public/claim/[tok:eyJhbG]')
  })

  it('exposes capture groups alongside named groups', () => {
    let groups: Array<string | undefined> | undefined
    redactEvent(
      { path: '/u/42' },
      {
        builtins: false,
        patterns: [/\/u\/(?<id>\d+)/g],
        replacement: (_match, ctx) => {
          ({ groups } = ctx)
          return '/u/[id]'
        },
      },
    )
    expect(groups).toEqual(['42'])
  })

  it('passes the path of the string field a pattern matched', () => {
    let path: string | undefined
    redactEvent(
      { request: { headers: { authorization: 'token abcdef' } } },
      {
        builtins: false,
        patterns: [/abcdef/g],
        replacement: (_match, ctx) => {
          ({ path } = ctx)
          return '[x]'
        },
      },
    )
    expect(path).toBe('request.headers.authorization')
  })

  it('falls back to [REDACTED] when the replacement throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = redactEvent(
      { token: 'secret-value' },
      {
        builtins: false,
        paths: ['token'],
        replacement: () => {
          throw new Error('bad policy')
        },
      },
    )
    expect(event.token).toBe('[REDACTED]')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('falls back to [REDACTED] when the replacement returns a non-string', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = redactEvent(
      { token: 'secret-value' },
      { builtins: false, paths: ['token'], replacement: (() => 42) as unknown as RedactConfig['replacement'] },
    )
    expect(event.token).toBe('[REDACTED]')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('never leaks the raw value when a pattern replacement throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = redactEvent(
      { path: '/claim/supersecrettoken' },
      {
        builtins: false,
        patterns: [/supersecrettoken/g],
        replacement: () => {
          throw new Error('bad policy')
        },
      },
    )
    expect(event.path).toBe('/claim/[REDACTED]')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('redactEvent - transform', () => {
  it('mutates the event in place without touching the source', () => {
    const source: Record<string, unknown> = { tenant: 'regulated', query: 'name=alice' }
    const event = redactEvent(source, {
      builtins: false,
      transform: (e) => {
        if (e.tenant === 'regulated') delete e.query
      },
    })
    expect(event).not.toHaveProperty('query')
    expect(source.query).toBe('name=alice')
  })

  it('sees raw values, before the declarative stages run', () => {
    let seen: unknown
    redactEvent(
      { user: { email: 'alice@example.com' } },
      {
        builtins: false,
        paths: ['user.email'],
        transform: (e) => {
          seen = (e.user as Record<string, unknown>).email
        },
      },
    )
    expect(seen).toBe('alice@example.com')
  })

  it('still applies the declarative stages to what it leaves behind', () => {
    const config = defined(resolveRedactConfig({ builtins: ['email'] }), 'redact config')
    const event = redactEvent({ note: 'ping alice@example.com' }, {
      ...config,
      transform: (e) => {
        e.extra = 'ping bob@example.com'
      },
    })
    // A field the hook adds is masked by the built-ins that run after it.
    expect(event.note).toBe('ping a***@***.com')
    expect(event.extra).toBe('ping b***@***.com')
  })

  it('reports a throwing transform and keeps redacting', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = redactEvent(
      { password: 'hunter2' },
      {
        builtins: false,
        paths: ['password'],
        transform: () => {
          throw new Error('bad hook')
        },
      },
    )
    expect(event.password).toBe('[REDACTED]')
    expect(error).toHaveBeenCalledWith('[evlog] redact transform failed:', expect.any(Error))
    error.mockRestore()
  })
})

describe('function-valued redact policy across the config bridge', () => {
  it('passes a live function replacement through normalizeRedactConfig', () => {
    const replacement = () => '[x]'
    const config = normalizeRedactConfig({ paths: ['token'], replacement })
    expect(config?.replacement).toBe(replacement)
  })

  it('passes a live transform through normalizeRedactConfig', () => {
    const transform = () => {}
    const config = normalizeRedactConfig({ transform })
    expect(config?.transform).toBe(transform)
  })

  it('detects function-valued policy so config bridges can warn', () => {
    expect(hasFunctionRedactPolicy({ replacement: () => '[x]' })).toBe(true)
    expect(hasFunctionRedactPolicy({ transform: () => {} })).toBe(true)
    expect(hasFunctionRedactPolicy({ paths: ['token'], replacement: '***' })).toBe(false)
    expect(hasFunctionRedactPolicy(true)).toBe(false)
    expect(hasFunctionRedactPolicy(undefined)).toBe(false)
  })

  it('drops function policy when the config is JSON-serialized, as the bridges do', () => {
    const serialized = JSON.parse(JSON.stringify({
      paths: ['token'],
      replacement: () => '[x]',
      transform: () => {},
    })) as Record<string, unknown>

    // The warning is the only signal left at this point — hence hasFunctionRedactPolicy
    // being called before serialization, not after.
    expect(hasFunctionRedactPolicy(serialized)).toBe(false)
    expect(normalizeRedactConfig(serialized)?.replacement).toBeUndefined()
  })

  it('warns when a function-valued policy crosses the bridge', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    prepareRedactForBridge({ replacement: () => '[x]' })
    expect(warn).toHaveBeenCalledWith(FUNCTION_REDACT_POLICY_WARNING)
    warn.mockRestore()
  })
})

describe('RegExp patterns across the config bridge', () => {
  it('rewrites RegExp patterns to source/flags so a JSON round-trip still redacts', () => {
    const redact = { builtins: false, patterns: [/sk_live_\w+/g] }
    prepareRedactForBridge(redact)
    const serialized = JSON.parse(JSON.stringify(redact))

    const resolved = defined(normalizeRedactConfig(serialized), 'redact config')
    expect(resolved.patterns).toHaveLength(1)
    expect(defined(resolved.patterns?.[0], 'patterns[0]').flags).toBe('g')

    const event = redactEvent({ key: 'sk_live_abc123' }, resolved)
    expect(event.key).toBe('[REDACTED]')
  })

  it('keeps patterns intact when the config is passed live, not through the bridge', () => {
    const redact = { builtins: false, patterns: [/sk_live_\w+/g] }
    prepareRedactForBridge(redact)
    const resolved = defined(normalizeRedactConfig(redact), 'redact config')
    expect(defined(resolved.patterns?.[0], 'patterns[0]')).toBeInstanceOf(RegExp)
  })
})
