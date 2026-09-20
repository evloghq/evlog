import type { ModelMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluate } from 'eve/ai'
import { PRE_ESCALATION_THRESHOLD } from './github/escalate'
import {
  buildQuestions,
  decideRouting,
  isTriageTurn,
  parseTriageIssueNumber,
  preRouteTriage,
  TRIAGE_THRESHOLDS,
  type TriageTurnContext,
} from './triage-router'

vi.mock('eve/ai', () => ({
  evaluate: vi.fn(),
}))

vi.mock('./github/credentials', () => ({
  githubCredentials: { installationToken: async () => 'tok_test' },
}))

const TAXONOMY = [
  { name: 'cli', description: 'The evlog CLI' },
  { name: 'question', description: 'A usage question' },
  { name: 'bug', description: 'Something is broken' },
]

const ISSUE_RESPONSE = JSON.stringify({
  title: 'How do I enable wide events?',
  body: 'I cannot find the option in the docs.',
  labels: [],
})

interface RecordedCall {
  readonly url: string
  readonly method: string
  readonly body: unknown
}

const recorded: RecordedCall[] = []

function stubFetch(options: { taxonomy?: Array<{ name: string, description?: string | null }>, issueLabels?: string[] } = {}): void {
  recorded.length = 0
  const { taxonomy = TAXONOMY, issueLabels = [] } = options
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    recorded.push(call)
    const path = new URL(call.url).pathname
    if (path === '/repos/evloghq/evlog/issues/12') {
      return new Response(JSON.stringify({ title: 'How do I enable wide events?', body: 'I cannot find the option in the docs.', labels: issueLabels.map(name => ({ name })) }), { status: 200 })
    }
    if (path === '/repos/evloghq/evlog/labels') return new Response(JSON.stringify(taxonomy), { status: 200 })
    return new Response('{}', { status: 200 })
  }))
}

function calls(): readonly RecordedCall[] {
  return recorded
}

function callPaths(): string[] {
  return calls().map(call => `${call.method} ${new URL(call.url).pathname}`)
}

function triageCtx(overrides?: Partial<TriageTurnContext>): TriageTurnContext {
  return {
    channel: { kind: 'github' },
    messages: [dispatchMessage(12)],
    session: { auth: { current: { principalId: 'github:evlogai' } as TriageTurnContext['session']['auth']['current'] } },
    ...overrides,
  }
}

function dispatchMessage(number: number, action = 'opened'): ModelMessage {
  return { role: 'user', content: `Issue ${action}: #${number} A title` }
}

function kindAnswer(choice: string, probabilities: Record<string, number>) {
  return { choice, probabilities }
}

function evaluateWith(answers: Record<string, unknown>): void {
  vi.mocked(evaluate).mockResolvedValueOnce({
    answers,
    usage: { inputTokens: 950, outputTokens: 0, totalTokens: 950 },
    response: { modelId: 'jev-test', timestamp: new Date() },
  } as never)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.mocked(evaluate).mockReset()
})

describe('parseTriageIssueNumber', () => {
  it('reads the issue number from the dispatch message', () => {
    expect(parseTriageIssueNumber([dispatchMessage(12)])).toBe(12)
  })

  it('reads the number from array-shaped content', () => {
    expect(parseTriageIssueNumber([{ role: 'user', content: [{ type: 'text', text: 'Issue opened: #34 Title' }] }])).toBe(34)
  })

  it('refuses reopens, edits, and non-dispatch turns', () => {
    expect(parseTriageIssueNumber([dispatchMessage(12, 'reopened')])).toBeNull()
    expect(parseTriageIssueNumber([dispatchMessage(12, 'edited')])).toBeNull()
    expect(parseTriageIssueNumber([{ role: 'user', content: 'Tell me about evlog' }])).toBeNull()
    expect(parseTriageIssueNumber([])).toBeNull()
    expect(parseTriageIssueNumber(undefined)).toBeNull()
  })
})

describe('isTriageTurn', () => {
  it('accepts an autonomous github turn and rejects everything else', () => {
    expect(isTriageTurn(triageCtx())).toBe(true)
    expect(isTriageTurn(triageCtx({ channel: { kind: 'channel:github' } }))).toBe(true)
    expect(isTriageTurn(triageCtx({ channel: { kind: 'slack' } }))).toBe(false)
    expect(isTriageTurn(triageCtx({ session: { auth: { current: { principalId: 'github:hugorcd' } as TriageTurnContext['session']['auth']['current'] } } }))).toBe(false)
    expect(isTriageTurn(triageCtx({ session: { auth: { current: null } } }))).toBe(false)
  })
})

describe('buildQuestions', () => {
  it('asks kind, needs-maintainer, and label over the same state', () => {
    const questions = buildQuestions(TAXONOMY)
    expect(Object.keys(questions)).toEqual(['kind', 'needsMaintainer', 'label'])
    expect(Object.keys(questions.label.criteria as Record<string, string>)).toEqual(['cli', 'question', 'bug'])
    const criteria = questions.label.criteria as Record<string, string>
    expect(criteria['cli']).toBe('The evlog CLI')
  })

  it('omits the label question when the taxonomy fetch came up empty', () => {
    expect(Object.keys(buildQuestions([]))).toEqual(['kind', 'needsMaintainer'])
  })
})

describe('decideRouting', () => {
  const taxonomy = new Set(TAXONOMY.map(label => label.name))

  it('routes a confident question and a confident doc gap to a cheap turn', () => {
    for (const kind of ['question', 'doc-gap']) {
      const decision = decideRouting({ kind: kindAnswer(kind, { [kind]: 0.9, 'bug-with-repro': 0.1 }) }, taxonomy)
      expect(decision.cheapTurn).toBe(true)
    }
  })

  it('keeps bugs at the full turn whatever the confidence', () => {
    const decision = decideRouting({ kind: kindAnswer('bug-with-repro', { 'bug-with-repro': 0.98 }) }, taxonomy)
    expect(decision.cheapTurn).toBe(false)
  })

  it('keeps a middling confidence at the full turn', () => {
    const decision = decideRouting({ kind: kindAnswer('question', { question: TRIAGE_THRESHOLDS.cheapTurn - 0.01, 'off-topic': 0.25, 'doc-gap': 0.24 }) }, taxonomy)
    expect(decision.cheapTurn).toBe(false)
  })

  it('falls back to the full turn and acts on no signal over a flat distribution', () => {
    const decision = decideRouting({
      kind: kindAnswer('off-topic', { 'off-topic': TRIAGE_THRESHOLDS.flatKind - 0.01, question: 0.27, 'bug-without-repro': 0.26 }),
      label: { choice: 'bug', probabilities: { bug: 0.9 } },
      needsMaintainer: { probability: 0.99 },
    }, taxonomy)
    expect(decision.cheapTurn).toBe(false)
    expect(decision.applyLabel).toBe(false)
    expect(decision.preEscalate).toBe(false)
  })

  it('labels only what exists in the taxonomy, above the label threshold', () => {
    const confident = decideRouting({ kind: kindAnswer('question', { question: 0.9 }), label: { choice: 'cli', probabilities: { cli: TRIAGE_THRESHOLDS.applyLabel } } }, taxonomy)
    expect(confident.label).toBe('cli')
    expect(confident.applyLabel).toBe(true)

    const foreign = decideRouting({ kind: kindAnswer('question', { question: 0.9 }), label: { choice: 'not-a-real-label', probabilities: { 'not-a-real-label': 0.99 } } }, taxonomy)
    expect(foreign.label).toBeNull()
    expect(foreign.applyLabel).toBe(false)

    const hesitant = decideRouting({ kind: kindAnswer('question', { question: 0.9 }), label: { choice: 'cli', probabilities: { cli: TRIAGE_THRESHOLDS.applyLabel - 0.01 } } }, taxonomy)
    expect(hesitant.label).toBe('cli')
    expect(hesitant.applyLabel).toBe(false)
  })

  it('pre-escalates only above the escalate.ts threshold', () => {
    const above = decideRouting({ kind: kindAnswer('bug-without-repro', { 'bug-without-repro': 0.9 }), needsMaintainer: { probability: PRE_ESCALATION_THRESHOLD } }, taxonomy)
    expect(above.preEscalate).toBe(true)
    const below = decideRouting({ kind: kindAnswer('bug-without-repro', { 'bug-without-repro': 0.9 }), needsMaintainer: { probability: PRE_ESCALATION_THRESHOLD - 0.01 } }, taxonomy)
    expect(below.preEscalate).toBe(false)
  })
})

describe('preRouteTriage', () => {
  it('returns null without touching the network when disabled', async () => {
    stubFetch()

    await expect(preRouteTriage(triageCtx())).resolves.toBeNull()
    expect(calls()).toHaveLength(0)
  })

  it('returns null for turns that are not issue dispatches', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch()

    await expect(preRouteTriage(triageCtx({ messages: [{ role: 'user', content: 'Mention me in this thread' }] }))).resolves.toBeNull()
    expect(calls()).toHaveLength(0)
  })

  it('returns null for turns that are not autonomous github turns', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch()

    await expect(preRouteTriage(triageCtx({ session: { auth: { current: { principalId: 'github:hugorcd' } as TriageTurnContext['session']['auth']['current'] } } }))).resolves.toBeNull()
    expect(calls()).toHaveLength(0)
  })

  it('runs the full turn on any failure below the router', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    await expect(preRouteTriage(triageCtx())).resolves.toBeNull()
  })

  it('runs the full turn when Jev has no kind answer', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch()
    evaluateWith({ kind: { probabilities: { question: 0.9 } }, needsMaintainer: { probability: 0.02 } })

    await expect(preRouteTriage(triageCtx())).resolves.toBeNull()
  })

  it('routes a confident question to a cheap turn with one Jev call over the issue body', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch()
    evaluateWith({
      kind: kindAnswer('question', { question: 0.92, 'doc-gap': 0.05, 'bug-with-repro': 0.02, 'bug-without-repro': 0.005, 'off-topic': 0.003 }),
      needsMaintainer: { probability: 0.02 },
      label: { choice: 'question', probabilities: { question: 0.86, cli: 0.1, bug: 0.04 } },
    })

    await expect(preRouteTriage(triageCtx())).resolves.toEqual({ cheapTurn: true })

    const evalOptions = vi.mocked(evaluate).mock.calls[0]?.[0] as {
      state: string
      questions: Record<string, { criteria?: Record<string, string> }>
      providerOptions?: { gateway?: { tags?: string[] } }
    }
    expect(evalOptions.state).toContain('How do I enable wide events?')
    expect(Object.keys(evalOptions.questions.label.criteria ?? {})).toEqual(['cli', 'question', 'bug'])
    expect(evalOptions.providerOptions?.gateway?.tags).toContain('evi:surface:triage-router')
    expect(callPaths()).toEqual([
      'GET /repos/evloghq/evlog/issues/12',
      'GET /repos/evloghq/evlog/labels',
      'POST /repos/evloghq/evlog/issues/12/labels',
    ])
    expect(calls().find(call => call.url.endsWith('/issues/12/labels'))?.body).toEqual({ labels: ['question'] })
  })

  it('applies a confident label on an unlabeled issue without escalating', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch()
    evaluateWith({
      kind: kindAnswer('question', { question: 0.92 }),
      needsMaintainer: { probability: 0.05 },
      label: { choice: 'cli', probabilities: { cli: 0.87 } },
    })

    await expect(preRouteTriage(triageCtx())).resolves.toEqual({ cheapTurn: true })
    expect(callPaths()).toContainEqual('POST /repos/evloghq/evlog/issues/12/labels')
    expect(calls().some(call => call.url.includes('/assignees'))).toBe(false)
  })

  it('drops a label answer that is not in the live taxonomy', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch()
    evaluateWith({
      kind: kindAnswer('question', { question: 0.92 }),
      needsMaintainer: { probability: 0.05 },
      label: { choice: 'not-a-real-label', probabilities: { 'not-a-real-label': 0.99 } },
    })

    await expect(preRouteTriage(triageCtx())).resolves.toEqual({ cheapTurn: true })
    expect(callPaths()).not.toContainEqual('POST /repos/evloghq/evlog/issues/12/labels')
  })

  it('pre-escalates when the needs-maintainer signal clears the threshold, keeping a confident label', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch()
    evaluateWith({
      kind: kindAnswer('bug-without-repro', { 'bug-without-repro': 0.9 }),
      needsMaintainer: { probability: PRE_ESCALATION_THRESHOLD },
      label: { choice: 'bug', probabilities: { bug: 0.9 } },
    })

    await expect(preRouteTriage(triageCtx())).resolves.toEqual({ cheapTurn: false })
    const paths = callPaths()
    expect(paths).toContainEqual('POST /repos/evloghq/evlog/issues/12/assignees')
    expect(paths).toContainEqual('POST /repos/evloghq/evlog/issues/12/labels')
  })

  it('keeps the existing labels when the issue already carries one', async () => {
    vi.stubEnv('EVI_TRIAGE_ROUTER_ENABLED', '1')
    stubFetch({ issueLabels: ['good first issue'] })
    evaluateWith({
      kind: kindAnswer('question', { question: 0.92 }),
      needsMaintainer: { probability: 0.05 },
      label: { choice: 'cli', probabilities: { cli: 0.9 } },
    })

    await expect(preRouteTriage(triageCtx())).resolves.toEqual({ cheapTurn: true })
    expect(callPaths()).not.toContainEqual('POST /repos/evloghq/evlog/issues/12/labels')
  })
})