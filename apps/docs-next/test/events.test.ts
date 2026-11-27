import { describe, expect, it } from 'vitest'
import { jsonLines, parseAnsi, prettyLines, type EventStep } from '../app/utils/events'

const ESC = '\u001B'

function step(pretty: string[], event: Record<string, unknown> = {}): EventStep {
  return { id: 'step', label: 'step', pretty, event }
}

function added(steps: EventStep[], index: number) {
  return prettyLines(steps, index).filter(line => line.added).map(line => line.spans.map(span => span.text).join(''))
}

describe('parseAnsi', () => {
  it('splits a line into spans that carry the colour in force', () => {
    expect(parseAnsi(`${ESC}[2m10:23:45${ESC}[0m ${ESC}[31mERROR${ESC}[0m done`)).toEqual([
      { text: '10:23:45', tone: 'dim', bold: false },
      { text: ' ', tone: 'plain', bold: false },
      { text: 'ERROR', tone: 'error', bold: false },
      { text: ' done', tone: 'plain', bold: false },
    ])
  })

  it('keeps bold across a colour change and drops it on reset', () => {
    expect(parseAnsi(`${ESC}[1m${ESC}[36muser${ESC}[0m: id`)).toEqual([
      { text: 'user', tone: 'key', bold: true },
      { text: ': id', tone: 'plain', bold: false },
    ])
  })

  it('leaves a colour it has no meaning for as the one before it', () => {
    expect(parseAnsi(`${ESC}[36ma${ESC}[35mb`).map(span => span.tone)).toEqual(['key', 'key'])
  })
})

describe('prettyLines', () => {
  const before = step(['INFO GET /cart 200', '  ├─ requestId: abc', '  └─ user: id=usr_1'])
  const after = step(['ERROR GET /cart 402', '  ├─ error: Declined', '  │Why: Card declined', '  ├─ requestId: abc', '  ├─ user: id=usr_1', '  └─ cart: items=3'])

  it('marks the lines a step put on the event', () => {
    expect(added([before, after], 1)).toEqual(['  ├─ error: Declined', '  │Why: Card declined', '  └─ cart: items=3'])
  })

  it('does not mark a line whose only change is its tree glyph', () => {
    expect(added([before, after], 1)).not.toContain('  ├─ user: id=usr_1')
  })

  it('never marks the request line, whose status changes on every error', () => {
    expect(prettyLines([before, after], 1)[0]!.added).toBe(false)
  })

  it('marks nothing on the first step', () => {
    expect(added([before, after], 0)).toEqual([])
  })

  it('files the lines under a field heading with that field', () => {
    expect(prettyLines([before, after], 1).map(line => line.field)).toEqual(['head', 'error', 'error', 'requestId', 'user', 'cart'])
  })

  it('keeps two identical lines apart', () => {
    const keys = prettyLines([step(['head', '  │', '  │'])], 0).map(line => line.key)
    expect(new Set(keys).size).toBe(3)
  })
})

describe('jsonLines', () => {
  const steps = [
    step([], { path: '/cart', status: 200 }),
    step([], { path: '/cart', user: { id: 'usr_1' }, status: 402 }),
  ]

  function text(index: number) {
    return jsonLines(steps, index).map(line => line.spans.map(span => span.text).join(''))
  }

  it('prints the event as JSON a reader could paste', () => {
    expect(JSON.parse(text(1).join('\n'))).toEqual(steps[1]!.event)
  })

  it('marks every row of a field the step added, and no field whose value changed', () => {
    const lines = jsonLines(steps, 1)
    expect(lines.filter(line => line.added).map(line => line.field)).toEqual(['user', 'user', 'user'])
  })

  it('marks nothing on the first step', () => {
    expect(jsonLines(steps, 0).some(line => line.added)).toBe(false)
  })
})

describe('a step that emitted nothing', () => {
  const dropped: EventStep = { id: 'dropped', label: 'dropped', pretty: [], event: null, dropped: 'Dropped by head sampling.' }
  const kept = step(['INFO POST /pay 200', '  └─ requestId: abc'], { path: '/pay' })

  it('has no lines in either view', () => {
    expect(prettyLines([kept, dropped], 1)).toEqual([])
    expect(jsonLines([kept, dropped], 1)).toEqual([])
  })

  it('makes every field of the event after it new', () => {
    expect(added([dropped, kept], 1)).toEqual(['  └─ requestId: abc'])
    expect(jsonLines([dropped, kept], 1).filter(line => line.added).map(line => line.field)).toEqual(['path'])
  })
})
