import { describe, expect, it } from 'vitest'
import { defineSignal } from '../src/define'
import { toQuestion, toVerdict } from '../src/evaluate'

const fault = defineSignal({
  name: 'fault',
  ask: 'Who is responsible?',
  choice: { client: 'Bad input', app: 'Our bug', upstream: 'Dependency failed' },
})
const severity = defineSignal({ name: 'severity', ask: 'How urgent?', score: ['noise', 'watch', 'page'] })
const silent = defineSignal({ name: 'silent', ask: 'Left empty-handed?', criteria: { true: 'No order created' } })

describe('toQuestion', () => {
  it('maps each signal kind to the AI SDK question shape', () => {
    expect(toQuestion(fault)).toEqual({
      type: 'choice',
      instructions: 'Who is responsible?',
      criteria: { client: 'Bad input', app: 'Our bug', upstream: 'Dependency failed' },
    })
    expect(toQuestion(severity)).toEqual({ type: 'score', instructions: 'How urgent?', criteria: ['noise', 'watch', 'page'] })
    expect(toQuestion(silent)).toEqual({ type: 'boolean', instructions: 'Left empty-handed?', criteria: { true: 'No order created' } })
  })
})

describe('toVerdict', () => {
  it('turns P(true) into a value with the probability of that value', () => {
    expect(toVerdict(silent, { type: 'boolean', probability: 0.94 })).toEqual({ value: true, confidence: 0.94 })
    expect(toVerdict(silent, { type: 'boolean', probability: 0.06 })).toEqual({ value: false, confidence: 0.94 })
  })

  it('reads choice confidence from the distribution', () => {
    const verdict = toVerdict(fault, {
      type: 'choice',
      choice: 'upstream',
      probabilities: { client: 0.03, app: 0.04, upstream: 0.93 },
    })
    expect(verdict).toEqual({ value: 'upstream', confidence: 0.93 })
  })

  it('names the most likely level and keeps the weighted score', () => {
    const verdict = toVerdict(severity, {
      type: 'score',
      score: 1.3,
      probabilities: { 0: 0.1, 1: 0.5, 2: 0.4 },
    })
    expect(verdict).toEqual({ value: 'watch', score: 1.3, confidence: 0.5 })
  })

  it('omits confidence when the model returns no distribution', () => {
    expect(toVerdict(fault, { type: 'choice', choice: 'app' })).toEqual({ value: 'app' })
    expect(toVerdict(severity, { type: 'score', score: 1.4 })).toEqual({ value: 'watch', score: 1.4 })
  })

  it('clamps a distribution-less score to the level range', () => {
    expect(toVerdict(severity, { type: 'score', score: 7 })).toEqual({ value: 'page', score: 7 })
    expect(toVerdict(severity, { type: 'score', score: -1 })).toEqual({ value: 'noise', score: -1 })
  })
})
