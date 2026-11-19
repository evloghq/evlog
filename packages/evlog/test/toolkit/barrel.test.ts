import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as toolkit from '../../src/shared/index'
import * as toolkitStorage from '../../src/shared/storage'

describe('evlog/toolkit barrel exports', () => {
  it('exports createMiddlewareLogger', () => {
    expect(toolkit.createMiddlewareLogger).toBeTypeOf('function')
  })

  it('exports extractSafeHeaders', () => {
    expect(toolkit.extractSafeHeaders).toBeTypeOf('function')
  })

  it('exports extractSafeNodeHeaders', () => {
    expect(toolkit.extractSafeNodeHeaders).toBeTypeOf('function')
  })

  it('exports createLoggerStorage (also available from evlog/toolkit/storage)', () => {
    expect(toolkit.createLoggerStorage).toBeTypeOf('function')
  })

  it('exports extractErrorStatus', () => {
    expect(toolkit.extractErrorStatus).toBeTypeOf('function')
  })

  it('exports shouldLog', () => {
    expect(toolkit.shouldLog).toBeTypeOf('function')
  })

  it('exports getServiceForPath', () => {
    expect(toolkit.getServiceForPath).toBeTypeOf('function')
  })

  it('exports fork helpers and runEnrichAndDrain', () => {
    expect(toolkit.attachForkToLogger).toBeTypeOf('function')
    expect(toolkit.forkBackgroundLogger).toBeTypeOf('function')
    expect(toolkit.runEnrichAndDrain).toBeTypeOf('function')
  })
})

describe('evlog/toolkit/storage', () => {
  it('exports createLoggerStorage', () => {
    expect(toolkitStorage.createLoggerStorage).toBeTypeOf('function')
  })

  it('shares its storage with the deprecated toolkit barrel re-export', () => {
    expect(toolkit.createLoggerStorage('barrel test').storage).toBe(toolkitStorage.createLoggerStorage('barrel test').storage)
  })
})

describe('extractErrorStatus', () => {
  it('extracts status field', () => {
    expect(toolkit.extractErrorStatus({ status: 404 })).toBe(404)
  })

  it('extracts statusCode field', () => {
    expect(toolkit.extractErrorStatus({ statusCode: 502 })).toBe(502)
  })

  it('prefers status over statusCode', () => {
    expect(toolkit.extractErrorStatus({ status: 400, statusCode: 502 })).toBe(400)
  })

  it('defaults to 500 for unknown errors', () => {
    expect(toolkit.extractErrorStatus(new Error('fail'))).toBe(500)
    expect(toolkit.extractErrorStatus(null)).toBe(500)
    expect(toolkit.extractErrorStatus(undefined)).toBe(500)
  })

  it('defaults to 500 for non-numeric status', () => {
    expect(toolkit.extractErrorStatus({ status: 'bad' })).toBe(500)
    expect(toolkit.extractErrorStatus({ status: NaN })).toBe(500)
    expect(toolkit.extractErrorStatus({ statusCode: Infinity })).toBe(500)
  })

  it('coerces string numbers', () => {
    expect(toolkit.extractErrorStatus({ status: '404' })).toBe(404)
  })
})

const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../dist')

describe.skipIf(!existsSync(join(distDir, 'toolkit/storage.mjs')))(
  'toolkit/storage dist entry',
  () => {
    it('ships createLoggerStorage with node:async_hooks on the dedicated entry', () => {
      const source = readFileSync(join(distDir, 'toolkit/storage.mjs'), 'utf8')
      expect(source).toMatch(/node:async_hooks/)
      expect(source).toMatch(/createLoggerStorage/)
    })
  },
)
