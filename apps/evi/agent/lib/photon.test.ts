import { emptySessionView, foldEvents, type SessionView } from 'eve/events'
import { describe, expect, it } from 'vitest'
import { type PromptState, showNextPrompt } from './photon'

const at = '2026-11-14T00:00:00Z'
let line = 0

function commit(...records: Array<{ type: string, data: unknown }>) {
  line += 1
  return records.map((record, index) => ({
    ...record,
    meta: { position: { line, index }, at, endOfLine: index === records.length - 1 },
  }))
}

function approval(callId: string, input: Record<string, unknown>) {
  return [
    { type: 'call.requested', data: { callId, owner: { turnId: 't1' }, capability: { kind: 'tool', name: 'github__createIssue' }, input } },
    {
      type: 'interaction.opened',
      data: {
        interactionId: `approve-${callId}`,
        subject: { callId },
        request: {
          kind: 'approval',
          prompt: `Approve ${callId}?`,
          options: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny' }],
        },
      },
    },
  ]
}

function settled(callId: string) {
  return { type: 'interaction.settled', data: { interactionId: `approve-${callId}`, outcome: 'accepted' } }
}

async function show(view: SessionView, state: PromptState): Promise<string[]> {
  const posted: string[] = []
  await showNextPrompt(view, state, (text) => Promise.resolve(posted.push(text)))
  return posted
}

describe('showNextPrompt', () => {
  it('shows one approval at a time, the one a typed reply answers', async () => {
    const state: PromptState = {}
    let view = foldEvents(emptySessionView(), commit(
      ...approval('first', { title: 'Docs gap', labels: [], body: '' }),
      ...approval('second', { title: 'Other' }),
    ))

    const first = 'Approve first?\ntitle: Docs gap\n\n· Approve: reply "approve"\n· Deny: reply "deny"\nOr answer in your own words.'
    expect(await show(view, state)).toEqual([first])
    expect(await show(view, state)).toEqual([])

    view = foldEvents(view, commit(settled('first')))
    const [next] = await show(view, state)
    expect(next).toMatch(/^Approve second\?\ntitle: Other\n/)

    view = foldEvents(view, commit(settled('second')))
    expect(await show(view, state)).toEqual([])
    expect(state.promptOnScreen).toBeUndefined()
  })
})
