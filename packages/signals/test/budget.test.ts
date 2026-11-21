import { describe, expect, it } from 'vitest'
import { createBudget } from '../src/budget'
import { createLru } from '../src/cache'

describe('createBudget', () => {
  it('holds ten seconds of budget, then refills at perMinute', () => {
    let now = 0
    const budget = createBudget({ perMinute: 60, cooldownMs: 1000, keepShare: 0 }, () => now, () => 0)
    for (let i = 0; i < 10; i++) expect(budget.take('enrich')).toBe(1)
    expect(budget.take('enrich')).toBe(false)
    now = 999
    expect(budget.take('enrich')).toBe(false)
    now = 2000
    expect(budget.take('enrich')).toBe(3)
  })

  it('keeps a share for keep signals that enrich cannot spend, and lets keep fall back on the rest', () => {
    const now = 0
    const starved = createBudget({ perMinute: 60, cooldownMs: 1000, keepShare: 0.5 }, () => now, () => 0)
    for (let i = 0; i < 5; i++) expect(starved.take('enrich')).toBe(1)
    expect(starved.take('enrich')).toBe(false)
    for (let i = 0; i < 5; i++) expect(starved.take('keep')).toBe(1)
    expect(starved.take('keep')).toBe(false)

    const spare = createBudget({ perMinute: 60, cooldownMs: 1000, keepShare: 0.5 }, () => now, () => 0)
    for (let i = 0; i < 10; i++) expect(spare.take('keep')).toBe(1)
    expect(spare.take('keep')).toBe(false)
  })

  it('admits each event with the probability the lane can afford once arrivals outpace it, and counts the ones it skipped', () => {
    let now = 0
    let draw = 0.5
    const budget = createBudget({ perMinute: 600, cooldownMs: 1000, keepShare: 0 }, () => now, () => draw)
    for (let i = 0; i < 1000; i++) budget.take('enrich')
    now = 1000
    expect(budget.take('enrich')).toBe(false)
    draw = 0.009
    expect(budget.take('enrich')).toBe(902)
  })

  it('returns a refunded call to its lane and carries its events over to the next call', () => {
    const budget = createBudget({ perMinute: 6, cooldownMs: 1000, keepShare: 0 }, () => 0, () => 0)
    expect(budget.take('enrich')).toBe(1)
    budget.refund('enrich', 1)
    expect(budget.take('enrich')).toBe(2)
    expect(budget.take('enrich')).toBe(false)
  })

  it('opens after three consecutive failures and closes after the cooldown', () => {
    let now = 0
    const budget = createBudget({ perMinute: 600, cooldownMs: 1000, keepShare: 0 }, () => now, () => 0)
    budget.fail()
    budget.fail()
    budget.succeed()
    budget.fail()
    budget.fail()
    expect(budget.take('enrich')).not.toBe(false)
    budget.fail()
    expect(budget.take('enrich')).toBe(false)
    now = 999
    expect(budget.take('enrich')).toBe(false)
    now = 1000
    expect(budget.take('enrich')).not.toBe(false)
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
