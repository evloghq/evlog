import { afterEach, describe, expect, it, vi } from 'vitest'
import { ESCALATION_LABEL, escalateFailedTriage, isAutonomousTriageState } from './escalate'

vi.mock('./credentials', () => ({
  githubCredentials: { installationToken: async () => 'tok_test' },
}))

afterEach(() => {
  vi.unstubAllGlobals()
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

const REPOSITORY = { owner: 'acme', repo: 'widgets' }

describe('escalateFailedTriage', () => {
  it('labels and assigns the issue on the given repository, creating the label when missing', async () => {
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

    await escalateFailedTriage(REPOSITORY, 42)

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      `GET /repos/acme/widgets/labels/${encodeURIComponent(ESCALATION_LABEL)}`,
      'POST /repos/acme/widgets/labels',
      'POST /repos/acme/widgets/issues/42/labels',
      'POST /repos/acme/widgets/issues/42/assignees',
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

    await escalateFailedTriage(REPOSITORY, 7)

    expect(methods).toEqual([
      `GET /repos/acme/widgets/labels/${encodeURIComponent(ESCALATION_LABEL)}`,
      'POST /repos/acme/widgets/issues/7/labels',
      'POST /repos/acme/widgets/issues/7/assignees',
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

    await escalateFailedTriage(REPOSITORY, 9)

    expect(methods.slice(1)).toEqual([
      'POST /repos/acme/widgets/labels',
      'POST /repos/acme/widgets/issues/9/labels',
      'POST /repos/acme/widgets/issues/9/assignees',
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
    await expect(escalateFailedTriage(REPOSITORY, 9)).rejects.toThrow('failed (422)')
  })

  it('surfaces a failed GitHub call', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('nope', { status: 403 })
      return new Response('{}', { status: 200 })
    }))
    await expect(escalateFailedTriage(REPOSITORY, 7)).rejects.toThrow('failed (403)')
  })
})
