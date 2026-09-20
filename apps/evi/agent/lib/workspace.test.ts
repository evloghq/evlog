import { afterEach, describe, expect, it } from 'vitest'
import { checkoutDir, installCommand, REPO_DIR, runOutput } from './workspace'

describe('runOutput', () => {
  it('prefers stderr, falls back to stdout, and never prints undefined', () => {
    expect(runOutput({ stdout: 'out\n', stderr: 'err\n' })).toBe('err')
    expect(runOutput({ stdout: 'out\n', stderr: '' })).toBe('out')
    expect(runOutput({ stdout: 'out\n', stderr: ' \n' })).toBe('out')
    expect(runOutput({})).toBe('')
  })
})

describe('checkoutDir', () => {
  afterEach(() => {
    delete process.env.EVI_REPOSITORY
  })

  it('maps the home repository to the template clone', () => {
    expect(checkoutDir({ owner: 'evloghq', repo: 'evlog' })).toBe(REPO_DIR)
    process.env.EVI_REPOSITORY = 'acme/widgets'
    expect(checkoutDir({ owner: 'acme', repo: 'widgets' })).toBe(REPO_DIR)
  })

  it('gives any other repository its own directory under /workspace', () => {
    expect(checkoutDir({ owner: 'acme', repo: 'widgets' })).toBe('/workspace/acme/widgets')
  })
})

describe('installCommand', () => {
  it('runs a frozen nci in the checkout without a corepack prompt', () => {
    expect(installCommand('/workspace/acme/widgets')).toBe('cd /workspace/acme/widgets && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nci')
  })
})
