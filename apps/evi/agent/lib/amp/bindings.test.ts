import { describe, expect, it } from 'vitest'
import { findAmpBinding, rememberAmpBinding, resolveStoredAmpThread, type AmpBinding } from './bindings'
import type { AmpListedThread } from './progress'

const THREAD_A = 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const THREAD_B = 'T-bbbbbbbb-cccc-dddd-eeee-ffffffffffff'

function binding(overrides: Partial<AmpBinding> = {}): AmpBinding {
  return {
    threadId: THREAD_A,
    threadUrl: `https://ampcode.com/threads/${THREAD_A}`,
    issue: 'EVL-42',
    sessionId: 'sess-1',
    repository: 'evloghq/evlog',
    progressKey: 'running||',
    ...overrides,
  }
}

describe('rememberAmpBinding', () => {
  it('replaces the same thread or the same issue and keeps the newest first', () => {
    const first = rememberAmpBinding([], binding())
    const updated = rememberAmpBinding(first, binding({ progressKey: 'idle|https://github.com/evloghq/evlog/pull/900|' }))
    expect(updated).toHaveLength(1)
    expect(updated[0]?.progressKey).toContain('idle')

    const otherIssue = rememberAmpBinding(updated, binding({
      threadId: THREAD_B,
      threadUrl: `https://ampcode.com/threads/${THREAD_B}`,
      issue: 'EVL-99',
    }))
    expect(otherIssue.map(item => item.threadId)).toEqual([THREAD_B, THREAD_A])

    const replacedIssue = rememberAmpBinding(otherIssue, binding({
      threadId: THREAD_B,
      threadUrl: `https://ampcode.com/threads/${THREAD_B}`,
      issue: 'EVL-42',
    }))
    expect(replacedIssue).toHaveLength(1)
    expect(replacedIssue[0]?.threadId).toBe(THREAD_B)
  })
})

describe('findAmpBinding', () => {
  const stored = [
    binding({ threadId: THREAD_B, threadUrl: `https://ampcode.com/threads/${THREAD_B}`, issue: null, sessionId: 'sess-2' }),
    binding(),
  ]

  it('finds by thread id, issue, or session-scoped work without an issue', () => {
    expect(findAmpBinding(stored, { threadId: `https://ampcode.com/threads/${THREAD_A}` })?.issue).toBe('EVL-42')
    expect(findAmpBinding(stored, { issue: 'evl-42' })?.threadId).toBe(THREAD_A)
    expect(findAmpBinding(stored, { sessionId: 'sess-2' })?.threadId).toBe(THREAD_B)
    expect(findAmpBinding(stored, { sessionId: 'sess-1' })).toBeNull()
    expect(findAmpBinding(stored, { issue: 'EVL-1' })).toBeNull()
  })

  it('fills a binding from Amp search results or a bare thread id when session state is empty', () => {
    const listed: AmpListedThread[] = [
      {
        id: THREAD_A,
        title: 'EVL-42: Split the Loki adapter',
        url: `https://ampcode.com/threads/${THREAD_A}`,
        labels: ['evi'],
        status: 'running',
      },
    ]
    expect(resolveStoredAmpThread({
      bindings: [],
      listed,
      query: { issue: 'EVL-42' },
      sessionId: 'sess-9',
    })?.threadId).toBe(THREAD_A)
    expect(resolveStoredAmpThread({
      bindings: [],
      listed: [],
      query: { threadId: THREAD_B },
      sessionId: 'sess-9',
    })?.threadUrl).toBe(`https://ampcode.com/threads/${THREAD_B}`)
    expect(resolveStoredAmpThread({
      bindings: [],
      listed: [],
      query: { issue: 'EVL-1' },
      sessionId: 'sess-9',
    })).toBeNull()
  })
})
