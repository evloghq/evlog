import { describe, expect, it } from 'vitest'
import { GRADIENT_GLYPH, TAGLINE, WORDMARK, formatBanner, wantsHeader } from '../src/core/brand'
import { createContext } from '../src/core/context'

const base = { cwd: '/tmp', env: {}, nodeVersion: 'v22.0.0', tty: true }

describe('wantsHeader', () => {
  const ctx = createContext({ ...base, color: false, columns: 80 })

  it('is on by default', () => {
    expect(wantsHeader(ctx, {}, [])).toBe(true)
  })

  it('respects --json, --no-header, and env opt-outs', () => {
    expect(wantsHeader(ctx, { json: true }, [])).toBe(false)
    expect(wantsHeader(ctx, { noHeader: true }, [])).toBe(false)
    expect(wantsHeader(ctx, {}, ['node', 'evlog', 'doctor', '--no-header'])).toBe(false)
    expect(wantsHeader(createContext({ ...base, env: { EVLOG_CLI_NO_HEADER: '1' } }), {}, [])).toBe(false)
    expect(wantsHeader(createContext({ ...base, env: { EVLOG_CLI_HEADER: '0' } }), {}, [])).toBe(false)
  })
})

describe('formatBanner', () => {
  it('renders the ASCII wordmark, tagline, and docs link with colors', () => {
    const banner = formatBanner(createContext({ ...base, color: true, columns: 100 }), '0.0.0')
    for (const row of WORDMARK) expect(banner).toContain(row)
    expect(banner).toContain(TAGLINE)
    expect(banner).toContain('v0.0.0')
    expect(banner).toContain('\x1B]8;;https://evlog.dev')
  })

  it('keeps all wordmark rows the same width', () => {
    const widths = new Set(WORDMARK.map(row => row.length))
    expect(widths.size).toBe(1)
  })

  it('falls back to a compact one-liner without colors, with no ANSI leaked', () => {
    const banner = formatBanner(createContext({ ...base, color: false, columns: 100 }), '0.0.0')
    expect(banner).not.toContain(WORDMARK[0])
    expect(banner).not.toContain('\x1B')
    expect(banner).toContain('evlog v0.0.0 — digging through logs is not observability')
  })

  it('falls back to the one-liner on narrow terminals even with colors', () => {
    const banner = formatBanner(createContext({ ...base, color: true, columns: 30 }), '0.0.0')
    expect(banner).not.toContain(WORDMARK[0])
  })

  it('renders a truecolor gradient rule that fades blue to dark', () => {
    const banner = formatBanner(createContext({ ...base, color: true, truecolor: true, columns: 100 }), '0.0.0')
    expect(banner).toContain('\x1B[38;2;43;90;255m') // brand blue start
    expect(banner).toContain('\x1B[38;2;8;10;40m') // near-black end
  })

  it('renders the rule in plain blue on a terminal without truecolor', () => {
    const banner = formatBanner(createContext({ ...base, color: true, truecolor: false, columns: 100 }), '0.0.0')
    expect(banner).not.toContain('\x1B[38;2;')
    expect(banner).toContain(`\x1B[34m${GRADIENT_GLYPH.repeat(WORDMARK[0].length)}\x1B[0m`)
  })
})
