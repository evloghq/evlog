import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRequestClock, drawTime, formatTook, opticalHang, pathSegments, takeFacts } from '../app/utils/pageHeader'

const contentDir = resolve(import.meta.dirname, '../content')

describe('the page header', () => {
  it('takes the product facts out of the body and leaves the rest in order', () => {
    const nodes = [['p', {}, 'Before'], ['product-facts', { entry: 'evlog/axiom', status: 'stable' }], ['h2', { id: 'a' }, 'After']]
    expect(takeFacts(nodes)).toEqual({
      facts: { entry: 'evlog/axiom', status: 'stable' },
      nodes: [['p', {}, 'Before'], ['h2', { id: 'a' }, 'After']],
    })
  })

  it('leaves a page without facts as it is', () => {
    const nodes = [['p', {}, 'product-facts']]
    expect(takeFacts(nodes)).toEqual({ nodes })
  })

  it('finds the facts of every page that declares them', () => {
    // The header only reads top-level nodes, so facts nested in another block would not be drawn.
    const nested = readdirSync(contentDir, { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.md'))
      .filter(file => /^[ \t]+:+product-facts|^:{3,}product-facts/m.test(readFileSync(resolve(contentDir, file), 'utf8')))
    expect(nested).toEqual([])
  })

  it('links the segments of a path that are pages, and never the page itself', () => {
    const pages = new Set(['/drains', '/drains/axiom', '/start/quick-start'])
    expect(pathSegments('/drains/axiom', pages)).toEqual([{ name: 'drains', to: '/drains' }, { name: 'axiom', to: undefined }])
    expect(pathSegments('/start/quick-start', pages)).toEqual([{ name: 'start', to: undefined }, { name: 'quick-start', to: undefined }])
  })

  it('prints a duration the way evlog does', () => {
    expect(formatTook(41.6)).toBe('42ms')
    expect(formatTook(999.4)).toBe('999ms')
    expect(formatTook(1234)).toBe('1.23s')
  })

  it('draws its rule for the time the request took, between 160 and 600ms', () => {
    expect(drawTime(12)).toBe(160)
    expect(drawTime(283.4)).toBe(283)
    expect(drawTime(4000)).toBe(600)
  })

  it('times a navigation from its start to the page it asked for', () => {
    const clock = createRequestClock()
    clock.start('/events', 100)
    expect(clock.navigating).toBe(true)
    expect(clock.finish('/events', 400)).toEqual({ path: '/events', ms: 300 })
    expect(clock.navigating).toBe(false)
    expect(clock.finish('/events', 900)).toBeUndefined()
  })

  it('still times a navigation when the page being left finishes rendering after it started', () => {
    const clock = createRequestClock()
    clock.start('/events', 100)
    expect(clock.finish('/start/quick-start', 150)).toBeUndefined()
    expect(clock.finish('/events', 400)).toEqual({ path: '/events', ms: 300 })
  })

  it('times the page a redirected navigation lands on', () => {
    const clock = createRequestClock()
    clock.start('/integrations', 100)
    clock.start('/integrations/overview', 120)
    expect(clock.finish('/integrations/overview', 320)).toEqual({ path: '/integrations/overview', ms: 200 })
  })

  it('pulls a title that starts on a stem further left than one that starts on a diagonal', () => {
    expect(opticalHang('Events')).toBeGreaterThan(opticalHang('Sampling'))
    expect(opticalHang('Sampling')).toBeGreaterThan(opticalHang('Axiom'))
    expect(opticalHang('Axiom')).toBe(0)
    expect(opticalHang('evlog map')).toBe(0)
  })
})
