import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  defineAuditCatalog,
  defineError,
  defineErrorCatalog,
} from '../../src/catalog'
import { EvlogError } from '../../src/error'

describe('defineError', () => {
  it('produces a factory that builds an EvlogError with all defaults applied', () => {
    const paymentDeclined = defineError('billing.PAYMENT_DECLINED', {
      status: 402,
      message: 'Card declined',
      why: 'Issuer declined the charge',
      fix: 'Try another card',
      link: 'https://docs.example.com/payments',
    })

    const err = paymentDeclined()

    expect(err).toBeInstanceOf(EvlogError)
    expect(err.code).toBe('billing.PAYMENT_DECLINED')
    expect(err.status).toBe(402)
    expect(err.message).toBe('Card declined')
    expect(err.why).toBe('Issuer declined the charge')
    expect(err.fix).toBe('Try another card')
    expect(err.link).toBe('https://docs.example.com/payments')
  })

  it('exposes static metadata on the factory itself', () => {
    const notFound = defineError('user.NOT_FOUND', {
      status: 404,
      message: 'User not found',
      tags: ['user', 'not-found'] as const,
    })

    expect(notFound.code).toBe('user.NOT_FOUND')
    expect(notFound.status).toBe(404)
    expect(notFound.message).toBe('User not found')
    expect(notFound.tags).toEqual(['user', 'not-found'])
  })

  it('leaves status unset when not provided', () => {
    const whatever = defineError('app.WHATEVER', { message: 'Boom' })
    expect(whatever().status).toBeUndefined()
    expect(whatever.status).toBeUndefined()
    expect(whatever().toJSON()).not.toHaveProperty('status')
  })

  it('accepts call-site overrides for every overridable field', () => {
    const base = defineError('app.BASE', {
      status: 400,
      message: 'Base',
      why: 'default why',
      fix: 'default fix',
      link: 'default-link',
    })

    const cause = new Error('underlying')
    const err = base({
      message: 'Overridden message',
      status: 422,
      why: 'overridden why',
      fix: 'overridden fix',
      link: 'overridden-link',
      cause,
      internal: { ref: 'x' },
    })

    expect(err.code).toBe('app.BASE')
    expect(err.message).toBe('Overridden message')
    expect(err.status).toBe(422)
    expect(err.why).toBe('overridden why')
    expect(err.fix).toBe('overridden fix')
    expect(err.link).toBe('overridden-link')
    expect(err.cause).toBe(cause)
    expect(err.internal).toEqual({ ref: 'x' })
  })

  it('shallow-merges call-site `internal` over catalog defaults (call-site wins)', () => {
    const withDefaults = defineError('app.X', {
      message: 'x',
      internal: { category: 'gateway', shared: 'default' },
    })

    const err = withDefaults({ internal: { ref: 'r-1', shared: 'overridden' } })

    expect(err.internal).toEqual({
      category: 'gateway',
      ref: 'r-1',
      shared: 'overridden',
    })
  })

  it('templated message: invokes the function with required typed params', () => {
    const insufficientFunds = defineError('billing.INSUFFICIENT_FUNDS', {
      status: 402,
      message: ({ available, required }: { available: number, required: number }) =>
        `Insufficient funds: $${available}/$${required}`,
    })

    const err = insufficientFunds({ available: 5, required: 100 })

    expect(err.message).toBe('Insufficient funds: $5/$100')
    expect(err.status).toBe(402)
  })

  it('templated message: respects message override even when params provided', () => {
    const tpl = defineError('app.TPL', {
      message: ({ name }: { name: string }) => `Hello ${name}`,
    })

    const err = tpl({ name: 'world', message: 'Forced message' })
    expect(err.message).toBe('Forced message')
  })

  it('preserves the literal `code` type on the factory metadata', () => {
    const foo = defineError('app.FOO', { message: 'foo' })
    expectTypeOf(foo.code).toEqualTypeOf<'app.FOO'>()
  })
})

describe('defineErrorCatalog', () => {
  const billingErrors = defineErrorCatalog('billing', {
    PAYMENT_DECLINED: {
      status: 402,
      message: 'Card declined',
      why: 'Issuer declined the charge',
      fix: 'Try another card',
    },
    INSUFFICIENT_FUNDS: {
      status: 402,
      message: ({ available, required }: { available: number, required: number }) =>
        `Insufficient funds: $${available}/$${required}`,
    },
    CART_EMPTY: {
      status: 400,
      message: 'Cart is empty',
    },
  })

  it('derives the wire `code` as `${prefix}.${KEY}` for every entry', () => {
    expect(billingErrors.PAYMENT_DECLINED.code).toBe('billing.PAYMENT_DECLINED')
    expect(billingErrors.INSUFFICIENT_FUNDS.code).toBe('billing.INSUFFICIENT_FUNDS')
    expect(billingErrors.CART_EMPTY.code).toBe('billing.CART_EMPTY')
  })

  it('throws an EvlogError carrying the prefixed code when invoked', () => {
    const err = billingErrors.PAYMENT_DECLINED()
    expect(err).toBeInstanceOf(EvlogError)
    expect(err.code).toBe('billing.PAYMENT_DECLINED')
    expect(err.status).toBe(402)
    expect(err.why).toBe('Issuer declined the charge')
    expect(err.fix).toBe('Try another card')
  })

  it('supports templated messages with typed params on catalog entries', () => {
    const err = billingErrors.INSUFFICIENT_FUNDS({ available: 5, required: 100 })
    expect(err.message).toBe('Insufficient funds: $5/$100')
  })

  it('exposes _prefix and _codes as readonly metadata (non-enumerable)', () => {
    expect(billingErrors._prefix).toBe('billing')
    expect(billingErrors._codes).toEqual([
      'billing.PAYMENT_DECLINED',
      'billing.INSUFFICIENT_FUNDS',
      'billing.CART_EMPTY',
    ])

    const enumerable = Object.keys(billingErrors)
    expect(enumerable).toEqual(['PAYMENT_DECLINED', 'INSUFFICIENT_FUNDS', 'CART_EMPTY'])
    expect(enumerable).not.toContain('_prefix')
    expect(enumerable).not.toContain('_codes')
  })

  it('preserves literal codes in the factory type via `const` generics', () => {
    expectTypeOf(billingErrors.PAYMENT_DECLINED.code).toEqualTypeOf<'billing.PAYMENT_DECLINED'>()
    expectTypeOf(billingErrors.INSUFFICIENT_FUNDS.code).toEqualTypeOf<'billing.INSUFFICIENT_FUNDS'>()
    expectTypeOf(billingErrors._prefix).toEqualTypeOf<'billing'>()
  })

  it('supports prefixes with dots for hierarchical namespacing', () => {
    const billingPaymentErrors = defineErrorCatalog('billing.payment', {
      DECLINED: { status: 402, message: 'Card declined' },
      EXPIRED: { status: 402, message: 'Card expired' },
    })

    expect(billingPaymentErrors.DECLINED.code).toBe('billing.payment.DECLINED')
    expect(billingPaymentErrors._codes).toEqual(['billing.payment.DECLINED', 'billing.payment.EXPIRED'])
    expectTypeOf(billingPaymentErrors.DECLINED.code).toEqualTypeOf<'billing.payment.DECLINED'>()
  })
})

describe('defineAuditCatalog', () => {
  const billingAudit = defineAuditCatalog('billing', {
    INVOICE_REFUND: {
      target: 'invoice',
      severity: 'high',
      requiresChanges: true,
      description: 'Refund an invoice to the customer',
      redactPaths: ['cardNumber'],
    },
    INVOICE_CREATE: { target: 'invoice' },
    SUBSCRIPTION_CANCEL: { target: 'subscription' },
    PASSWORD_CHANGE: {},
  })

  it('produces factories that prefix the `action` and inject the `target.type`', () => {
    const input = billingAudit.INVOICE_REFUND({
      actor: { type: 'user', id: 'u1' },
      target: { id: 'inv_889' },
    })

    expect(input.action).toBe('billing.INVOICE_REFUND')
    expect(input.actor).toEqual({ type: 'user', id: 'u1' })
    expect(input.target).toEqual({ id: 'inv_889', type: 'invoice' })
  })

  it('exposes static action and target on the factory itself', () => {
    expect(billingAudit.INVOICE_REFUND.action).toBe('billing.INVOICE_REFUND')
    expect(billingAudit.INVOICE_REFUND.target).toBe('invoice')
    expect(billingAudit.INVOICE_REFUND.severity).toBe('high')
    expect(billingAudit.INVOICE_REFUND.requiresChanges).toBe(true)
    expect(billingAudit.INVOICE_REFUND.description).toBe('Refund an invoice to the customer')
    expect(billingAudit.INVOICE_REFUND.redactPaths).toEqual(['cardNumber'])
    expect(billingAudit.PASSWORD_CHANGE.action).toBe('billing.PASSWORD_CHANGE')
    expect(billingAudit.PASSWORD_CHANGE.target).toBeUndefined()
  })

  it('exposes _prefix and _actions readonly metadata', () => {
    expect(billingAudit._prefix).toBe('billing')
    expect(billingAudit._actions).toEqual([
      'billing.INVOICE_REFUND',
      'billing.INVOICE_CREATE',
      'billing.SUBSCRIPTION_CANCEL',
      'billing.PASSWORD_CHANGE',
    ])
  })

  it('preserves literal action types in the factory metadata', () => {
    expectTypeOf(billingAudit.INVOICE_REFUND.action).toEqualTypeOf<'billing.INVOICE_REFUND'>()
    expectTypeOf(billingAudit.SUBSCRIPTION_CANCEL.action).toEqualTypeOf<'billing.SUBSCRIPTION_CANCEL'>()
    expectTypeOf(billingAudit._prefix).toEqualTypeOf<'billing'>()
  })

  it('passes through other audit fields untouched', () => {
    const input = billingAudit.INVOICE_REFUND({
      actor: { type: 'user', id: 'u1' },
      target: { id: 'inv_889' },
      outcome: 'success',
      reason: 'duplicate',
      causationId: 'corr-1',
    })

    expect(input.outcome).toBe('success')
    expect(input.reason).toBe('duplicate')
    expect(input.causationId).toBe('corr-1')
  })
})

describe('createError + catalog typing', () => {
  // With no `declare module 'evlog'` augmentation in this test scope,
  // `ErrorCode` resolves to `never` and `ErrorOptions.code` accepts any
  // string (no breaking change to existing call sites).
  it('still accepts arbitrary string codes from raw createError', async () => {
    const { createError } = await import('../../src/error')
    const err = createError({ code: 'ad.hoc.code', message: 'x' })
    expect(err.code).toBe('ad.hoc.code')
  })

  it('catalog factory codes are interchangeable with createError-style strings', () => {
    const factory = defineError('app.SAMPLE', { message: 'sample' })
    const fromFactory = factory()
    expect(fromFactory.code).toBe('app.SAMPLE')

    // The catalog's code metadata is the same wire string a parseError consumer would compare to:
    expect(fromFactory.code).toBe(factory.code)
  })
})
