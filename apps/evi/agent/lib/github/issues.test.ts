import { afterEach, describe, expect, it, vi } from 'vitest'
import { addIssueLabels, fetchIssueSnapshot, listRepositoryLabels } from './issues'

interface RecordedCall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

const recorded: RecordedCall[] = []

function stubFetch(response: Response | Error): void {
  recorded.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of new Headers(init?.headers).entries()) headers[key] = value
    const call: RecordedCall = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    recorded.push(call)
    if (response instanceof Error) throw response
    return response
  }))
}

function calls(): readonly RecordedCall[] {
  return recorded
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchIssueSnapshot', () => {
  it('returns the title, body, and label names of the issue', async () => {
    stubFetch(new Response(JSON.stringify({
      title: 'Wide events drop the session id',
      body: 'Repro: log twice.',
      labels: [{ name: 'bug' }, 'cli', { nonsense: true }],
    }), { status: 200 }))

    await expect(fetchIssueSnapshot(12, 'tok')).resolves.toEqual({
      title: 'Wide events drop the session id',
      body: 'Repro: log twice.',
      labels: ['bug', 'cli'],
    })

    const call = calls()[0]
    expect(call?.url).toBe('https://api.github.com/repos/evloghq/evlog/issues/12')
    expect(call?.headers.authorization).toBe('Bearer tok')
    expect(call?.headers.accept).toBe('application/vnd.github+json')
    expect(call?.headers['x-github-api-version']).toBe('2022-11-28')
  })

  it('coerces missing fields to empty values instead of throwing', async () => {
    stubFetch(new Response(JSON.stringify({ labels: null }), { status: 200 }))

    await expect(fetchIssueSnapshot(12, 'tok')).resolves.toEqual({ title: '', body: '', labels: [] })
  })

  it('throws with the path and status on a failed read', async () => {
    stubFetch(new Response('rate limited', { status: 403 }))

    await expect(fetchIssueSnapshot(12, 'tok')).rejects.toThrow('GitHub GET /repos/evloghq/evlog/issues/12 failed (403): rate limited')
  })
})

describe('listRepositoryLabels', () => {
  it('returns the label names and descriptions from the paginated endpoint', async () => {
    stubFetch(new Response(JSON.stringify([
      { name: 'cli', description: 'The evlog CLI' },
      { name: 'bug', description: null },
      { nope: true },
      { name: '', description: 'nameless' },
    ]), { status: 200 }))

    await expect(listRepositoryLabels('tok')).resolves.toEqual([
      { name: 'cli', description: 'The evlog CLI' },
      { name: 'bug', description: null },
    ])

    expect(calls()[0]?.url).toBe('https://api.github.com/repos/evloghq/evlog/labels?per_page=100')
  })

  it('returns an empty taxonomy on a shape it cannot read', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'not a list' }), { status: 200 }))

    await expect(listRepositoryLabels('tok')).resolves.toEqual([])
  })

  it('throws with the path and status on a failed read', async () => {
    stubFetch(new Response('nope', { status: 404 }))

    await expect(listRepositoryLabels('tok')).rejects.toThrow('GitHub GET /repos/evloghq/evlog/labels?per_page=100 failed (404): nope')
  })
})

describe('addIssueLabels', () => {
  it('posts the label names to the issue labels endpoint', async () => {
    stubFetch(new Response(JSON.stringify([]), { status: 200 }))

    await addIssueLabels(15, ['bug', 'cli'], 'tok')

    const call = calls()[0]
    expect(call?.method).toBe('POST')
    expect(call?.url).toBe('https://api.github.com/repos/evloghq/evlog/issues/15/labels')
    expect(call?.headers.authorization).toBe('Bearer tok')
    expect(call?.body).toEqual({ labels: ['bug', 'cli'] })
  })

  it('throws with the path and status on a failed write', async () => {
    stubFetch(new Response('forbidden', { status: 403 }))

    await expect(addIssueLabels(15, ['bug'], 'tok')).rejects.toThrow('GitHub POST /repos/evloghq/evlog/issues/15/labels failed (403): forbidden')
  })
})