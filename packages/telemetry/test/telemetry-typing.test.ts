import { afterEach, beforeEach, describe, expectTypeOf, it, vi } from 'vitest'
import { createTelemetry, telemetry } from '../src/create'
import type { CustomFields } from '../src/types'

describe('telemetry.set typing', () => {
  it('accepts numbers and booleans without collect', () => {
    expectTypeOf(telemetry.set).toBeCallableWith({ checksFailed: 2, ok: true })
  })

  it('rejects undeclared string fields at compile time', () => {
    // @ts-expect-error framework requires collect.fields declaration
    expectTypeOf(telemetry.set).toBeCallableWith({ framework: 'nuxt' })
  })

  it('types allowlisted string values on declared keys', () => {
    type Fields = { framework: readonly ['nuxt', 'next'] }
    expectTypeOf<'nuxt'>().toMatchTypeOf<NonNullable<CustomFields<Fields>['framework']>>()
  })
})

describe('TelemetryHandle.set typing', () => {
  /* Only the types are under test: an enabled handle writes a machine id in the contributor's home. */
  beforeEach(() => {
    vi.stubEnv('EVLOG_TELEMETRY', '0')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts allowlisted strings from collect.fields', () => {
    const handle = createTelemetry({
      name: 'test',
      version: '1.0.0',
      collect: { fields: { framework: ['nuxt', 'next'] as const } },
    })
    expectTypeOf(handle.set).toBeCallableWith({ framework: 'nuxt' })
  })

  it('rejects undeclared string fields on the handle', () => {
    const handle = createTelemetry({ name: 'test', version: '1.0.0' })
    // @ts-expect-error framework requires collect.fields declaration
    expectTypeOf(handle.set).toBeCallableWith({ framework: 'nuxt' })
  })
})
