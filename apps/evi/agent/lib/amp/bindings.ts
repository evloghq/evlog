import { defineState } from 'eve/context'
import type { AmpListedThread } from './progress'
import { pickAmpThread } from './progress'
import { ampThreadUrl, parseAmpThreadId } from './route'

export interface AmpBinding {
  readonly threadId: string
  readonly threadUrl: string
  readonly issue: string | null
  readonly sessionId: string
  readonly repository: string
  readonly progressKey: string | null
}

const BINDING_CAP = 20

export const ampBindings = defineState<AmpBinding[]>('evi.amp.bindings', () => [])

export function rememberAmpBinding(bindings: readonly AmpBinding[], next: AmpBinding): AmpBinding[] {
  const issue = normalizeIssue(next.issue)
  const rest = bindings.filter((binding) => {
    if (binding.threadId === next.threadId) return false
    const existingIssue = normalizeIssue(binding.issue)
    if (issue !== null && existingIssue === issue) return false
    return true
  })
  return [next, ...rest].slice(0, BINDING_CAP)
}

export function findAmpBinding(
  bindings: readonly AmpBinding[],
  query: {
    readonly threadId?: string
    readonly issue?: string
    readonly sessionId?: string
    readonly repository?: string
  },
): AmpBinding | null {
  if (query.threadId) {
    const id = parseAmpThreadId(query.threadId)
    if (id) {
      const hit = bindings.find(binding => binding.threadId === id)
      if (hit) return hit
    }
  }
  const issue = normalizeIssue(query.issue ?? null)
  if (issue !== null) {
    const hit = bindings.find(binding => normalizeIssue(binding.issue) === issue)
    if (hit) return hit
  }
  if (query.sessionId && query.issue === undefined && query.threadId === undefined) {
    const repository = query.repository === undefined || query.repository === '' ? undefined : query.repository
    return bindings.find(binding =>
      binding.sessionId === query.sessionId
      && binding.issue === null
      && (repository === undefined || binding.repository === repository),
    ) ?? null
  }
  return null
}

export function resolveStoredAmpThread(input: {
  readonly bindings: readonly AmpBinding[]
  readonly listed: readonly AmpListedThread[]
  readonly query: { readonly threadId?: string, readonly issue?: string, readonly sessionId?: string }
  readonly sessionId: string
  readonly repository?: string
}): AmpBinding | null {
  const stored = findAmpBinding(input.bindings, { ...input.query, repository: input.repository })
  if (stored) return stored
  const picked = pickAmpThread(input.listed, input.query)
  const repository = input.repository ?? ''
  if (picked) {
    return {
      threadId: picked.id,
      threadUrl: picked.url,
      issue: input.query.issue ?? null,
      sessionId: input.sessionId,
      repository,
      progressKey: null,
    }
  }
  if (input.query.threadId) {
    const id = parseAmpThreadId(input.query.threadId)
    const url = ampThreadUrl(id)
    if (id !== null && url !== null) {
      return {
        threadId: id,
        threadUrl: url,
        issue: input.query.issue ?? null,
        sessionId: input.sessionId,
        repository,
        progressKey: null,
      }
    }
  }
  return null
}

function normalizeIssue(issue: string | null): string | null {
  if (issue === null) return null
  const trimmed = issue.trim()
  return trimmed === '' ? null : trimmed.toLowerCase()
}
