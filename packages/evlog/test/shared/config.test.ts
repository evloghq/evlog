import { describe, expect, it } from 'vitest'
import { formatPublicEnvKeys } from '../../src/shared/config'

describe('formatPublicEnvKeys', () => {
  it('drops NUXT_* aliases and keeps canonical names', () => {
    expect(formatPublicEnvKeys(['NUXT_BETTER_STACK_API_KEY', 'BETTER_STACK_API_KEY']))
      .toBe('BETTER_STACK_API_KEY')
  })

  it('joins alternatives with commas and required fields with slashes', () => {
    expect(formatPublicEnvKeys(
      ['NUXT_AXIOM_API_KEY', 'AXIOM_API_KEY'],
      ['NUXT_AXIOM_DATASET', 'AXIOM_DATASET'],
    )).toBe('AXIOM_API_KEY/AXIOM_DATASET')
  })

  it('lists multiple aliases for the same field', () => {
    expect(formatPublicEnvKeys(['NUXT_DATADOG_API_KEY', 'DATADOG_API_KEY', 'DD_API_KEY']))
      .toBe('DATADOG_API_KEY, DD_API_KEY')
  })

  it('falls back to NUXT_* when no public keys exist', () => {
    expect(formatPublicEnvKeys(['NUXT_ONLY_KEY']))
      .toBe('NUXT_ONLY_KEY')
  })
})
