import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloneUrl, homeRepository, isHomeRepository, parseRepository, repositoryOf, repositorySlug } from './repo'

const ENV = 'EVI_REPOSITORY'

describe('parseRepository', () => {
  it('splits an owner/repo slug', () => {
    expect(parseRepository('evloghq/evlog')).toEqual({ owner: 'evloghq', repo: 'evlog' })
    expect(parseRepository('acme-inc/widgets.js')).toEqual({ owner: 'acme-inc', repo: 'widgets.js' })
  })

  it('rejects anything that is not a bare slug', () => {
    expect(parseRepository('evlog')).toBeNull()
    expect(parseRepository('evloghq/evlog/tree/main')).toBeNull()
    expect(parseRepository('https://github.com/evloghq/evlog')).toBeNull()
    expect(parseRepository('-evloghq/evlog')).toBeNull()
    expect(parseRepository('evloghq/..')).toBeNull()
    expect(parseRepository('evloghq/ev log')).toBeNull()
  })
})

describe('homeRepository', () => {
  beforeEach(() => {
    delete process.env[ENV]
  })

  afterEach(() => {
    delete process.env[ENV]
  })

  it('defaults to the evlog repository', () => {
    expect(homeRepository()).toEqual({ owner: 'evloghq', repo: 'evlog' })
  })

  it('reads EVI_REPOSITORY', () => {
    process.env[ENV] = 'acme/widgets'
    expect(homeRepository()).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('refuses a malformed EVI_REPOSITORY', () => {
    process.env[ENV] = 'https://github.com/acme/widgets'
    expect(() => homeRepository()).toThrow('EVI_REPOSITORY must be an owner/repo slug')
  })
})

describe('isHomeRepository', () => {
  afterEach(() => {
    delete process.env[ENV]
  })

  it('matches the home repository regardless of case', () => {
    expect(isHomeRepository({ owner: 'EvlogHQ', name: 'Evlog' })).toBe(true)
  })

  it('rejects another repository the App is installed on', () => {
    expect(isHomeRepository({ owner: 'evloghq', name: 'evlog-docs' })).toBe(false)
    process.env[ENV] = 'acme/widgets'
    expect(isHomeRepository({ owner: 'evloghq', name: 'evlog' })).toBe(false)
    expect(isHomeRepository({ owner: 'acme', name: 'widgets' })).toBe(true)
  })
})

describe('repositoryOf', () => {
  it('keeps only the repository fields of a channel state', () => {
    expect(repositoryOf({ owner: 'acme', repo: 'widgets', issueNumber: 4 } as never)).toEqual({ owner: 'acme', repo: 'widgets' })
  })
})

describe('repositorySlug and cloneUrl', () => {
  it('derive the API slug and the token-free clone URL', () => {
    const repository = { owner: 'acme', repo: 'widgets' }
    expect(repositorySlug(repository)).toBe('acme/widgets')
    expect(cloneUrl(repository)).toBe('https://github.com/acme/widgets.git')
  })
})
