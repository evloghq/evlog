import { describe, expect, it } from 'vitest'
import { AUTO_APPROVED_KEYS, decideEnvVarWrite, writableProjects } from './vercel-env'

const PROJECT = { EVI_VERCEL_WRITABLE_PROJECTS: 'prj_evi, prj_evlog-docs' }

describe('writableProjects', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(writableProjects({ EVI_VERCEL_WRITABLE_PROJECTS: ' prj_a , ,prj_b' })).toEqual(['prj_a', 'prj_b'])
  })

  it('is empty when unset, so nothing auto-approves', () => {
    expect(writableProjects({})).toEqual([])
  })
})

describe('decideEnvVarWrite', () => {
  it('auto-approves an allowlisted key on a writable project', () => {
    const decision = decideEnvVarWrite({ projectId: 'prj_evi', key: 'EVI_VERCEL_MCP_ROUTE' }, PROJECT)
    expect(decision).toEqual({ type: 'approved', reason: expect.stringContaining('allowlisted') })
  })

  it('auto-approves every allowlisted agent-config key', () => {
    for (const key of AUTO_APPROVED_KEYS) {
      expect(decideEnvVarWrite({ projectId: 'prj_evlog-docs', key }, PROJECT))
        .toEqual({ type: 'approved', reason: expect.any(String) })
    }
  })

  it('pauses for a human on a non-allowlisted key, even on a writable project', () => {
    expect(decideEnvVarWrite({ projectId: 'prj_evi', key: 'SOME_APP_SETTING' }, PROJECT)).toBe('user-approval')
  })

  it('pauses for a human on an unlisted project, even for an allowlisted key', () => {
    expect(decideEnvVarWrite({ projectId: 'prj_other', key: 'EVI_VERCEL_MCP_ROUTE' }, PROJECT)).toBe('user-approval')
  })

  it('pauses for a human when the project list is unset', () => {
    expect(decideEnvVarWrite({ projectId: 'prj_evi', key: 'EVI_VERCEL_MCP_ROUTE' }, {})).toBe('user-approval')
  })

  it('denies secret-shaped keys outright, everywhere', () => {
    const keys = ['VERCEL_TOKEN', 'DATABASE_URL', 'MY_API_KEY', 'STRIPE_SECRET', 'PRIVATE_KEY', 'SENTRY_DSN', 'AUTH_COOKIE']
    for (const key of keys) {
      const decision = decideEnvVarWrite({ projectId: 'prj_evi', key }, PROJECT)
      expect(decision).toMatchObject({ type: 'denied' })
    }
  })

  it('denies a secret-shaped key before any other check, even on an unlisted project', () => {
    expect(decideEnvVarWrite({ projectId: 'prj_other', key: 'VERCEL_TOKEN' }, PROJECT)).toMatchObject({ type: 'denied' })
  })
})
