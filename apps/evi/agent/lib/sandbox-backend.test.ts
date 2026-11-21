import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSandboxEnvironment, isVercelEnvironment, sandboxEnv } from './sandbox-backend'

const prepare = vi.fn(async () => {})

describe('sandbox backend', () => {
  it('uses Docker locally', () => {
    expect(createSandboxEnvironment(false, prepare).provider).toBe('docker')
  })

  it('uses Vercel Sandbox when deployed', () => {
    expect(createSandboxEnvironment(true, prepare).provider).toBe('vercel')
  })

  it('brokers credentials at the firewall only on Vercel Sandbox', () => {
    expect(isVercelEnvironment(createSandboxEnvironment(true, prepare))).toBe(true)
    expect(isVercelEnvironment(createSandboxEnvironment(false, prepare))).toBe(false)
  })

  it('installs amp in the sandbox image and forwards AMP_API_KEY', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'sandbox.ts'), 'utf8')
    expect(source).toContain("'@ampcode/cli'")
    expect(source).toContain('sandboxEnv()')
  })
})

describe('sandboxEnv', () => {
  it('forwards AMP_API_KEY when set', () => {
    expect(sandboxEnv({ AMP_API_KEY: 'sgamp_test' })).toEqual({ AMP_API_KEY: 'sgamp_test' })
    expect(sandboxEnv({ AMP_API_KEY: '  sgamp_test  ' })).toEqual({ AMP_API_KEY: 'sgamp_test' })
  })

  it('omits AMP_API_KEY when unset', () => {
    expect(sandboxEnv({})).toEqual({})
    expect(sandboxEnv({ AMP_API_KEY: '  ' })).toEqual({})
  })
})
