import type { DrainContext, EnrichContext, WideEvent } from '../../src/types'
import { initLogger } from '../../src/logger'

export const PAYLOADS = {
  simple: { a: 1, b: 'hello' },

  shallow: {
    userId: 'usr_abc123',
    action: 'checkout',
    cart: { items: 3, total: 9999, currency: 'USD' },
    region: 'us-east-1',
    sessionId: 'sess_xyz789',
  },

  deep: {
    user: { id: 'usr_abc', plan: 'pro', profile: { name: 'John', settings: { theme: 'dark', locale: 'en' } } },
    request: { method: 'POST', path: '/api/checkout', headers: { 'content-type': 'application/json' } },
    cart: { items: [{ id: 'a', qty: 1, price: 2999 }, { id: 'b', qty: 2, price: 3500 }], total: 9999 },
    payment: { method: 'card', last4: '4242', gateway: 'stripe' },
  },

  medium: Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [`field_${i}`, i % 2 === 0 ? `value_${i}` : i]),
  ),

  large: Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [`field_${i}`, { nested: { value: `data_${i}`, count: i } }]),
  ),
} as const

export const USER_AGENTS = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}

export function initSilentLogger(): void {
  initLogger({
    env: { service: 'bench', environment: 'production' },
    pretty: false,
    silent: true,
    _suppressDrainWarning: true,
  })
}

/**
 * Silent logger configured as a production process runs it: `redact` resolves to
 * `true` when NODE_ENV is production, so every emit is redacted.
 */
export function initProductionLogger(): void {
  initLogger({
    env: { service: 'bench', environment: 'production' },
    pretty: false,
    silent: true,
    redact: true,
    _suppressDrainWarning: true,
  })
}

export function makeEnrichCtx(headers: Record<string, string>): EnrichContext {
  return {
    event: {} as Record<string, unknown>,
    headers,
    request: { method: 'GET', path: '/api/test', requestId: 'req_123' },
  }
}

export function makeDrainCtx(i = 0): DrainContext {
  return {
    event: {
      timestamp: '2025-01-15T10:30:00.000Z',
      level: 'info',
      service: 'bench',
      environment: 'production',
      method: 'POST',
      path: '/api/checkout',
      status: 200,
      duration: '12ms',
      userId: `usr_${i}`,
    } as unknown as WideEvent,
    request: { method: 'POST', path: '/api/checkout', requestId: `req_${i}` },
    headers: { 'content-type': 'application/json' },
  }
}
