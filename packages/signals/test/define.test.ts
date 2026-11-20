import { describe, expect, expectTypeOf, it } from 'vitest'
import type { BooleanVerdict, ChoiceVerdict, ScoreVerdict, SignalColumn } from '../src/define'
import { defineSignal } from '../src/define'

describe('defineSignal', () => {
  it('infers boolean from a bare ask', () => {
    const signal = defineSignal({ name: 'silent-failure', ask: 'Returned 200, but the user left empty-handed' })
    expect(signal.kind).toBe('boolean')
  })

  it('infers choice from ask + choice and types keep on the options', () => {
    const signal = defineSignal({
      name: 'fault',
      when: e => (e.status ?? 0) >= 400,
      ask: 'Who is responsible for this failure?',
      choice: { client: 'Bad input', app: 'Our bug', upstream: 'A dependency failed' },
      keep: (v) => {
        expectTypeOf(v).toEqualTypeOf<ChoiceVerdict<'client' | 'app' | 'upstream'>>()
        return v.value === 'app' && (v.confidence ?? 0) > 0.9
      },
    })
    expect(signal.kind).toBe('choice')
    expect(signal.choice).toEqual({ client: 'Bad input', app: 'Our bug', upstream: 'A dependency failed' })
  })

  it('infers score from ask + score and types keep on the levels', () => {
    const signal = defineSignal({
      name: 'severity',
      when: () => true,
      ask: 'How urgent is this for on-call?',
      score: ['noise', 'watch', 'page'],
      keep: (v) => {
        expectTypeOf(v).toEqualTypeOf<ScoreVerdict<'noise' | 'watch' | 'page'>>()
        return v.value === 'page'
      },
    })
    expect(signal.kind).toBe('score')
    expect(signal.score).toEqual(['noise', 'watch', 'page'])
  })

  it('types keep on the boolean verdict', () => {
    defineSignal({
      name: 'flag',
      when: () => true,
      ask: 'Is this interesting?',
      keep: (v) => {
        expectTypeOf(v).toEqualTypeOf<BooleanVerdict>()
        return v.value && v.confidence > 0.8
      },
    })
  })

  it('keeps on a yes above the threshold when keep is a number', () => {
    const signal = defineSignal({ name: 'flag', when: () => true, ask: 'Is this interesting?', keep: 0.8 })
    expect(signal.keep!({ value: true, confidence: 0.81 })).toBe(true)
    expect(signal.keep!({ value: true, confidence: 0.8 })).toBe(false)
    expect(signal.keep!({ value: false, confidence: 0.95 })).toBe(false)
    expect(() => defineSignal({ name: 'flag', when: () => true, ask: 'q', keep: 1 })).toThrow(/confidence threshold/)
    expect(() => defineSignal({ name: 'flag', when: () => true, ask: 'q', keep: -0.1 })).toThrow(/confidence threshold/)
  })

  it('reads its own column, typed on the options', () => {
    const signal = defineSignal({ name: 'fault', ask: 'Who?', choice: { client: 'c', app: 'a' } })
    const verdict = signal.read({ signals: { fault: { value: 'app', confidence: 0.9, kept: true }, other: { value: true, confidence: 1 } } })
    expectTypeOf(verdict).toEqualTypeOf<SignalColumn<ChoiceVerdict<'client' | 'app'>> | undefined>()
    expect(verdict).toEqual({ value: 'app', confidence: 0.9, kept: true })
    expect(signal.read({})).toBeUndefined()
    const ctor = defineSignal({ name: 'constructor', ask: 'q' })
    expect(ctor.read({ signals: { other: { value: true, confidence: 1 } } })).toBeUndefined()
    expect(ctor.read({ signals: { constructor: { value: true, confidence: 0.7 } } })).toEqual({ value: true, confidence: 0.7 })
  })

  it('rejects keep without when', () => {
    expect(() => defineSignal({ name: 'x', ask: 'q', keep: v => v.value })).toThrow(/keep without when/)
  })

  it('rejects malformed names, empty asks and short option lists', () => {
    expect(() => defineSignal({ name: 'signals.fault', ask: 'q' })).toThrow(/invalid signal name/)
    expect(() => defineSignal({ name: 'fault', ask: '  ' })).toThrow(/empty ask/)
    expect(() => defineSignal({ name: 'fault', ask: 'q', choice: { only: 'one' } })).toThrow(/at least two options/)
  })
})
