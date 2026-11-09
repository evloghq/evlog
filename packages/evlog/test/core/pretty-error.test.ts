import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from '../../src/error'
import { createRequestLogger, initLogger } from '../../src/logger'
import {
  buildErrorEntries,
  compactStackForStorage,
  normalizeErrorContext,
  parseStackFrames,
  pickPrimaryFrame,
  readCodeSnippet,
  registerPrettyErrorSnippetReader,
} from '../../src/shared/pretty-error'
import { readCodeSnippetFromDisk } from '../../src/shared/pretty-error-snippet.node'
import { enrichErrorStackForDev } from '../../src/shared/enrich-error-stack.node'
import { prependNitroErrorHandler } from '../../src/nitro'
import { expectLinearTime } from '../helpers/timers'

const SAMPLE_STACK = `Error: Payment processing failed
    at Object.handler (file:///Users/dev/project/server/api/test.get.ts:100:0)
    at async file:///Users/dev/project/node_modules/h3/dist/index.mjs:2017:19
    at async Object.callAsync (file:///Users/dev/project/node_modules/unctx/dist/index.mjs:72:16)`

describe('normalizeErrorContext', () => {
  it('extracts guidance fields from EvlogError-shaped objects', () => {
    const err = createError({
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      status: 402,
      why: 'Card declined',
      fix: 'Try another card',
      link: 'https://docs.example.com/payments',
    })

    expect(normalizeErrorContext({
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      why: err.why,
      fix: err.fix,
      link: err.link,
      status: err.status,
    })).toMatchObject({
      message: 'Payment failed',
      code: 'PAYMENT_DECLINED',
      why: 'Card declined',
      fix: 'Try another card',
      link: 'https://docs.example.com/payments',
      status: 402,
    })
  })

  it('reads guidance from nested data', () => {
    expect(normalizeErrorContext({
      message: 'Failed',
      data: {
        code: 'X',
        why: 'because',
        fix: 'do Y',
      },
    })).toMatchObject({
      code: 'X',
      why: 'because',
      fix: 'do Y',
    })
  })
})

describe('parseStackFrames', () => {
  it('marks node_modules frames as non-app and picks the app frame for snippets', () => {
    const frames = parseStackFrames(SAMPLE_STACK)
    expect(frames).toHaveLength(3)
    expect(frames[0]?.isApp).toBe(true)
    expect(frames[0]?.file).toContain('server/api/test.get.ts')
    expect(frames[1]?.isApp).toBe(false)
    expect(frames[2]?.isApp).toBe(false)

    const primary = pickPrimaryFrame(frames)
    expect(primary?.file).toContain('server/api/test.get.ts')
    expect(primary?.line).toBe(100)
  })

  it('reads the function name up to the first ` (` and the location from the end of the line', () => {
    const frames = parseStackFrames(`Error: x
    at handler (/Users/dev/My Project (copy)/server/api/a.ts:3:7)
    at async Object.run (file:///Users/dev/project/server/run.ts:12:5)
    at eval (eval at compile (file:///Users/dev/project/lib/tpl.js:4:9), <anonymous>:1:2)
    at file:///Users/dev/project/server/b.ts:8:1
    at new Promise (<anonymous>)`)

    expect(frames.map(({ fn, file, line, column }) => ({ fn, file, line, column }))).toEqual([
      { fn: 'handler', file: '/Users/dev/My Project (copy)/server/api/a.ts', line: 3, column: 7 },
      { fn: 'async Object.run', file: 'file:///Users/dev/project/server/run.ts', line: 12, column: 5 },
      { fn: 'eval', file: 'eval at compile (file:///Users/dev/project/lib/tpl.js:4:9), <anonymous>', line: 1, column: 2 },
      { fn: undefined, file: 'file:///Users/dev/project/server/b.ts', line: 8, column: 1 },
    ])
  })

  it('parses attacker-shaped frame lines in linear time', () => {
    const lines = [
      `at a${' ('.repeat(32_768)}`,
      `at async a${' ('.repeat(32_768)}`,
      `at a (${'1:'.repeat(32_768)})`,
    ]
    for (const line of lines) {
      expectLinearTime(frame => parseStackFrames(`Error: invalid value\n    ${frame}`), line, line.slice(0, 16))
    }
  })

  it('skips evlog internal frames from createError throws', () => {
    const stack = `Error: Payment processing failed
    at new EvlogError (file:///Users/dev/project/packages/evlog/src/error.ts:166:10)
    at createError (file:///Users/dev/project/packages/evlog/src/error.ts:166:10)
    at Object.handler (file:///Users/dev/project/server/api/test/structured-error.get.ts:100:9)
    at async file:///Users/dev/project/node_modules/h3/dist/index.mjs:2017:19`
    const primary = pickPrimaryFrame(parseStackFrames(stack))
    expect(primary?.file).toContain('structured-error.get.ts')
    expect(primary?.line).toBe(100)
  })

  it('does not skip user handler files named error.ts', () => {
    const stack = `Error: boom
    at Object.handler (file:///Users/dev/project/server/api/error.ts:42:5)
    at async file:///Users/dev/project/node_modules/h3/dist/index.mjs:2017:19`
    const primary = pickPrimaryFrame(parseStackFrames(stack))
    expect(primary?.file).toContain('server/api/error.ts')
    expect(primary?.line).toBe(42)
  })

  it('skips bundled .nuxt/dev frames', () => {
    const stack = `Payment processing failed
at createError (.nuxt/dev/index.mjs:3007:10)
at Object.handler (.nuxt/dev/index.mjs:8108:9)
at async file:///Users/dev/project/node_modules/h3/dist/index.mjs:2017:19`
    const primary = pickPrimaryFrame(parseStackFrames(stack))
    expect(primary).toBeUndefined()
  })

  it('skips node internal frames when picking snippet locations', () => {
    const stack = `EvlogError: Payment method declined
    at AsyncLocalStorage.run (node:internal/async_local_storage/async_context_frame:63:14)
    at Object.handler (file:///Users/dev/project/apps/next-playground/app/api/test/structured-error/route.ts:7:9)`
    const primary = pickPrimaryFrame(parseStackFrames(stack))
    expect(primary?.file).toContain('structured-error/route.ts')
    expect(primary?.line).toBe(7)
  })

  it('prefers app route.ts over Next route-modules after dev stack enrichment', () => {
    const stack = `EvlogError: Payment method declined
    at <unknown> (app/api/test/structured-error/route.ts:7:25)
    at AppRouteRouteModule.do (webpack://next/src/server/route-modules/app-route/module.ts:631:21)
    at <unknown> (webpack://next/src/server/route-modules/app-route/module.ts:844:24)`
    const frames = parseStackFrames(stack)
    const primary = pickPrimaryFrame(frames)
    expect(primary?.file).toContain('structured-error/route.ts')
    expect(primary?.line).toBe(7)

    const entries = buildErrorEntries({
      message: 'Payment method declined',
      stack,
      why: 'Card declined',
    }, { snippet: false, stackDepth: 3, compact: false })
    const children = entries[0]?.children ?? []
    const locationLine = children.find(line => line.includes('structured-error/route.ts'))
    expect(locationLine).toBeDefined()
    expect(children.find(line => line.includes('route-modules'))).toBeUndefined()
  })
})

describe('compactStackForStorage', () => {
  it('returns the stack unchanged when only build output and node_modules frames remain', () => {
    const stack = `EvlogError: Payment method declined
    at createError (/Users/dev/project/packages/evlog/src/error.ts:699:12)
    at Object.handler (/Users/dev/project/apps/next-playground/.next/dev/server/chunks/route.js:5372:176)
    at async /Users/dev/project/node_modules/next/dist/server/base-server.js:934:17
    at async /Users/dev/project/node_modules/next/dist/server/lib/start-server.js:225:13`

    expect(compactStackForStorage(stack)).toBe(stack)
  })

  it('keeps app source frames when present', () => {
    const stack = `Error: boom
    at Object.handler (file:///Users/dev/project/server/api/test.get.ts:100:0)
    at async file:///Users/dev/project/node_modules/h3/dist/index.mjs:2017:19`

    expect(compactStackForStorage(stack)).toBe(`Error: boom
at Object.handler (file:///Users/dev/project/server/api/test.get.ts:100:0)`)
  })
})

describe('readCodeSnippet', () => {
  beforeEach(() => {
    registerPrettyErrorSnippetReader(readCodeSnippetFromDisk)
  })

  afterEach(() => {
    registerPrettyErrorSnippetReader(null)
  })

  it('returns lines around the error line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evlog-pretty-error-'))
    const file = join(dir, 'handler.ts')
    writeFileSync(file, [
      'line 1',
      'line 2',
      'throw new Error(\'boom\')',
      'line 4',
    ].join('\n'), 'utf8')

    const snippet = readCodeSnippet(file, 3, 1)
    expect(snippet).toEqual([
      { line: 2, content: 'line 2', isErrorLine: false },
      { line: 3, content: 'throw new Error(\'boom\')', isErrorLine: true },
      { line: 4, content: 'line 4', isErrorLine: false },
    ])
  })

  it('skips bundled .next paths even when a reader is registered', () => {
    expect(readCodeSnippet('/Users/dev/project/.next/dev/server/chunks/route.js', 42)).toBeNull()
  })
})

describe('buildErrorEntries', () => {
  it('renders message, guidance, location, and hidden stack summary', () => {
    const entries = buildErrorEntries({
      message: 'Payment failed',
      stack: SAMPLE_STACK,
      why: 'Card declined',
      fix: 'Try another card',
      link: 'https://docs.example.com/payments',
    }, { snippet: false, stackDepth: 2, compact: false })

    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.key).toBe('error')
    expect(entry.value).toContain('Payment failed')
    expect(entry.value).not.toContain('stack=')
    const children = entry.children ?? []
    expect(children.some(line => line.includes('Why:'))).toBe(true)
    expect(children.some(line => line.includes('Fix:'))).toBe(true)
    expect(children.some(line => line.includes('More:'))).toBe(true)
    expect(children.some(line => line.includes('hidden in node_modules'))).toBe(true)
  })

  it('keeps the frames of a stack with CRLF line endings', () => {
    const lf = buildErrorEntries({ message: 'Payment failed', stack: SAMPLE_STACK }, { snippet: false, stackDepth: 2, compact: false })
    const crlf = buildErrorEntries({ message: 'Payment failed', stack: SAMPLE_STACK.replaceAll('\n', '\r\n') }, { snippet: false, stackDepth: 2, compact: false })

    expect(crlf[0]?.children).toEqual(lf[0]?.children)
    expect(crlf[0]?.children?.some(line => line.includes('server/api/test.get.ts:100'))).toBe(true)
  })

  it('reads the snippet from the frame path as written and escapes it only for display', () => {
    const reader = vi.fn(() => null)
    registerPrettyErrorSnippetReader(reader)
    try {
      const file = '/Users/dev/project/server/api/te\x07st.get.ts'
      const entries = buildErrorEntries({ message: 'x', stack: `Error: x\n    at handler (${file}:10:5)` }, { snippet: true, cwd: '/Users/dev/project' })

      expect(reader).toHaveBeenCalledWith(file, 10, expect.any(Number))
      expect(entries[0]?.children).toContain('\x1B[2m   at handler (server/api/te\\u0007st.get.ts:10)\x1B[0m')
    } finally {
      registerPrettyErrorSnippetReader(null)
    }
  })

  it('omits redundant caused-by when it matches the message', () => {
    const entries = buildErrorEntries({
      message: 'Payment failed',
      stack: SAMPLE_STACK,
      cause: 'Payment failed',
    }, { snippet: false })

    const children = entries[0]?.children ?? []
    expect(children.some(line => line.includes('Caused by:'))).toBe(false)
  })

  it('filters createError frames from the collapsed stack', () => {
    const stack = `Payment processing failed
at createError (/Users/dev/project/packages/evlog/dist/error.mjs:128:8)
at Object.handler (server/api/test/structured-error.get.ts:100:0)
at async file:///Users/dev/project/node_modules/h3/dist/index.mjs:2017:19`
    const entries = buildErrorEntries({
      message: 'Payment failed',
      stack,
      why: 'Card declined',
    }, { snippet: false, stackDepth: 5, compact: false })

    const children = entries[0]?.children ?? []
    expect(children.some(line => line.includes('createError'))).toBe(false)
    expect(children.some(line => line.includes('structured-error.get.ts'))).toBe(true)
  })

  it('wraps long Fix guidance with hanging indent', () => {
    const longFix = `${'Please use a different payment method. '.repeat(6)}Contact your bank.`
    const entries = buildErrorEntries({
      message: 'Payment failed',
      stack: SAMPLE_STACK,
      fix: longFix,
    }, { snippet: false, stackDepth: 0, compact: false })

    const children = entries[0]?.children ?? []
    const fixIndex = children.findIndex(line => line.includes('Fix:'))
    expect(fixIndex).toBeGreaterThanOrEqual(0)
    expect(children[fixIndex + 1]).toMatch(/^\s{5}\S/)
  })
})

describe('prependNitroErrorHandler', () => {
  const handler = '/evlog/nitro/errorHandler'

  it('prepends without duplicating an existing handler list', () => {
    expect(prependNitroErrorHandler(undefined, handler)).toBe(handler)
    expect(prependNitroErrorHandler('/nuxt/error', handler)).toEqual([handler, '/nuxt/error'])

    const existing = ['/nuxt/error', '/nitro/dev']
    expect(prependNitroErrorHandler(existing, handler)).toEqual([handler, ...existing])
    expect(prependNitroErrorHandler([handler, ...existing], handler)).toEqual([handler, ...existing])
    expect(prependNitroErrorHandler(['framework', handler], handler)).toEqual([handler, 'framework'])
  })
})

describe('enrichErrorStackForDev', () => {
  const originalEnv = process.env.NODE_ENV
  const originalConfig = process.env.__EVLOG_CONFIG

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    if (originalConfig === undefined) delete process.env.__EVLOG_CONFIG
    else process.env.__EVLOG_CONFIG = originalConfig
  })

  it('skips Nitro stack enrichment outside pretty dev', async () => {
    process.env.NODE_ENV = 'production'
    await expect(enrichErrorStackForDev(new Error('boom'))).resolves.toBeUndefined()

    process.env.NODE_ENV = 'development'
    process.env.__EVLOG_CONFIG = JSON.stringify({ pretty: false })
    await expect(enrichErrorStackForDev(new Error('boom'), { pretty: false })).resolves.toBeUndefined()
  })
})

describe('pretty error logger integration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    initLogger({ pretty: true, dev: { prettyError: { snippet: false } } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses console.log for error-level wide events (avoids per-line ERROR badges)', () => {
    const logger = createRequestLogger({ method: 'GET', path: '/fail', requestId: 'r1' })
    logger.error(new Error('boom'))
    logger.emit({ status: 500 })

    expect(console.log).toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })
})
