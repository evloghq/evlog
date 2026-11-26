import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureScenario, serialize } from '../scripts/capture'
import { scenarios } from '../scripts/scenarios/index'
import { eventScenarios } from '../app/utils/events'

describe('captured events', () => {
  it('has one committed file per scenario', () => {
    expect(Object.keys(eventScenarios).sort()).toEqual(Object.keys(scenarios).sort())
  })

  // Fails when evlog's output or a scenario changed and `pnpm capture` was not run again.
  it.each(Object.keys(scenarios))('%s is what evlog prints today', (name) => {
    const committed = readFileSync(resolve(import.meta.dirname, `../app/data/events/${name}.json`), 'utf8')
    expect(serialize(captureScenario(name))).toBe(committed)
  }, 30_000)
})
