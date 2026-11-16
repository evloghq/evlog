import { describe, expect, it, vi } from 'vitest'
import { createSandboxEnvironment, isVercelEnvironment } from './sandbox-backend'

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
})
