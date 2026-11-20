import { describe, expect, it } from 'vitest'
import { createBudget } from '../src/budget'
import { createLru } from '../src/cache'

describe('createBudget', () => {
  it('allows perMinute calls at once, then refills one call per minute / perMinute', () => {
    let now = 0
    const budget = createBudget({ perMinute: 2, cooldownMs: 1000 }, () => now)
    expect(budget.take()).toBe(true)
    expect(budget.take()).toBe(true)
    expect(budget.take()).toBe(false)
    now = 29_999
    expect(budget.take()).toBe(false)
    now = 30_000
    expect(budget.take()).toBe(true)
    expect(budget.take()).toBe(false)
  })

  it('opens after three consecutive failures and closes after the cooldown', () => {
    let now = 0
    const budget = createBudget({ perMinute: 10, cooldownMs: 1000 }, () => now)
    budget.fail()
    budget.fail()
    budget.succeed()
    budget.fail()
    budget.fail()
    expect(budget.take()).toBe(true)
    budget.fail()
    expect(budget.take()).toBe(false)
    now = 999
    expect(budget.take()).toBe(false)
    now = 1000
    expect(budget.take()).toBe(true)
  })
})

describe('createLru', () => {
  it('evicts the least recently used entry past max', () => {
    const lru = createLru<number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    lru.get('a')
    lru.set('c', 3)
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('a')).toBe(1)
    expect(lru.get('c')).toBe(3)
  })
})
