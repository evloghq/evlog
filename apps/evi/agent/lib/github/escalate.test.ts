import { afterEach, describe, expect, it, vi } from 'vitest'
import { ESCALATION_LABEL, escalateTriage, isAutonomousTriageState, PRE_ESCALATION_THRESHOLD, preEscalateTriage, shouldPreEscalate } from './escalate'

vi.mock('./credentials', () => ({
  githubCredentials: { installationToken: async () => 'tok_test' },
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shouldPreEscalate', () => {
  it('escalates at the threshold and above it', () => {
    expect(shouldPreEscalate(PRE_ESCALATION_THRESHOLD)).toBe(true)
    expect(shouldPreEscalate(0.99)).toBe(true)
    expect(shouldPreEscalate(0.84)).toBe(false)
  })
})

describe('preEscalateTriage', () => {
  it('only assigns the maintainer, without the failure label', async () => {
    const methods: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      methods.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`)
      return new Response('{}', { status: 200 })
    }))

    await preEscalateTriage(15, 'tok_router')

    expect(methods).toEqual(['POST /repos/evloghq/evlog/issues/15/assignees'])
  })
})

describe('isAutonomousTriageState', () => {
  it('recognizes an issue dispatch with no triggering comment', () => {
    expect(isAutonomousTriageState({ issueNumber: 12, triggeringCommentId: null })).toBe(true)
  })

  it('rejects mention comments and non-issue conversations', () => {
    expect(isAutonomousTriageState({ issueNumber: 12, triggeringCommentId: 34 })).toBe(false)
    expect(isAutonomousTriageState({ issueNumber: null, triggeringCommentId: null })).toBe(false)
  })
})

describe('escalateTriage', () => {
  it('labels and assigns the issue, creating the label when missing', async () => {
    const calls: Array<{ url: string, method: string, body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (String(url).includes('/labels/') && init?.method === undefined) {
        return new Response('not found', { status: 404 })
      }
      return new Response('{}', { status: 200 })
    }))

    await escalateTriage(42)

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      `GET /repos/evloghq/evlog/labels/${encodeURIComponent(ESCALATION_LABEL)}`,
      'POST /repos/evloghq/evlog/labels',
      'POST /repos/evloghq/evlog/issues/42/labels',
      'POST /repos/evloghq/evlog/issues/42/assignees',
    ])
    expect(calls[2]?.body).toEqual({ labels: [ESCALATION_LABEL] })
    expect(calls[3]?.body).toEqual({ assignees: ['hugorcd'] })
  })

  it('skips label creation when the label exists', async () => {
    const methods: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      methods.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`)
      return new Response('{}', { status: 200 })
    }))

    await escalateTriage(7)

    expect(methods).toEqual([
      `GET /repos/evloghq/evlog/labels/${encodeURIComponent(ESCALATION_LABEL)}`,
      'POST /repos/evloghq/evlog/issues/7/labels',
      'POST /repos/evloghq/evlog/issues/7/assignees',
    ])
  })

  it('treats a concurrent label creation (422) as success', async () => {
    const methods: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      methods.push(`${init?.method ?? 'GET'} ${path}`)
      if (init?.method === undefined) return new Response('not found', { status: 404 })
      if (path.endsWith('/labels') && !path.includes('/issues/')) {
        return new Response('{"errors":[{"code":"already_exists"}]}', { status: 422 })
      }
      return new Response('{}', { status: 200 })
    }))

    await escalateTriage(9)

    expect(methods.slice(1)).toEqual([
      'POST /repos/evloghq/evlog/labels',
      'POST /repos/evloghq/evlog/issues/9/labels',
      'POST /repos/evloghq/evlog/issues/9/assignees',
    ])
  })

  it('surfaces a 422 that is not already_exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (init?.method === undefined) return new Response('not found', { status: 404 })
      if (path.endsWith('/labels') && !path.includes('/issues/')) {
        return new Response('{"errors":[{"code":"invalid","field":"color"}]}', { status: 422 })
      }
      return new Response('{}', { status: 200 })
    }))
    await expect(escalateTriage(9)).rejects.toThrow('failed (422)')
  })

  it('surfaces a failed GitHub call', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('nope', { status: 403 })
      return new Response('{}', { status: 200 })
    }))
    await expect(escalateTriage(7)).rejects.toThrow('failed (403)')
  })
})
