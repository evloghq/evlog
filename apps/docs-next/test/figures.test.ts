import { redactEvent, resolveRedactConfig } from 'evlog/toolkit'
import { describe, expect, it } from 'vitest'
import { redactionFields } from '../app/utils/redaction'

describe('the Redaction figure', () => {
  it('shows each value as evlog masks it with the built-ins on', () => {
    const event: Record<string, Record<string, string>> = {}
    for (const field of redactionFields) {
      const [group, leaf] = field.key.split('.') as [string, string]
      event[group] = { ...event[group], [leaf]: field.raw }
    }

    const redacted = redactEvent(event, resolveRedactConfig(true)!) as typeof event

    const printed = Object.fromEntries(redactionFields.map((field) => {
      const [group, leaf] = field.key.split('.') as [string, string]
      return [field.key, redacted[group]![leaf]]
    }))
    const shown = Object.fromEntries(redactionFields.map(field => [field.key, field.masked ?? field.raw]))
    expect(shown).toEqual(printed)
  })
})
