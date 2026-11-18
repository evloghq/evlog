import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineErrorCatalog } from '../../src/catalog'
import { createError, EvlogError } from '../../src/error'
import { onErrorCreated } from '../../src/shared/error-created'

describe('onErrorCreated', () => {
  const unsubscribes: Array<() => void> = []
  afterEach(() => unsubscribes.splice(0).forEach(off => off()))

  it('sees every evlog error as it is built, before anything throws it', () => {
    const seen: EvlogError[] = []
    unsubscribes.push(onErrorCreated(error => seen.push(error)))
    const billing = defineErrorCatalog('billing', {
      DECLINED: { status: 402, message: 'Card declined', why: 'The issuer refused', fix: 'Use another card' },
    })

    const direct = createError({ message: 'Missing order', code: 'ORDER_MISSING' })
    const fromCatalog = billing.DECLINED()

    expect(seen).toEqual([direct, fromCatalog])
    expect(seen[1]).toMatchObject({ status: 402, why: 'The issuer refused', fix: 'Use another card' })
  })

  it('stops calling a listener once it unsubscribes', () => {
    const listener = vi.fn()
    const off = onErrorCreated(listener)
    createError('first')
    off()
    createError('second')

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
