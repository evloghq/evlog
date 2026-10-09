import { describe, expect, it } from 'vitest'
import { unwrapTooltipDatum } from '../app/utils/chart-tooltip'

const row = { label: 'Oct 7', success: 12, errors: 2, previous: 9 }

describe('unwrapTooltipDatum', () => {
  it('passes the data row through unchanged', () => {
    expect(unwrapTooltipDatum(row)).toBe(row)
  })

  it('unwraps the StackedBarDataRecord wrapper to its datum', () => {
    const wrapper = { datum: row, index: 3, stacked: true, stackIndex: 0, isEnding: false }
    expect(unwrapTooltipDatum(wrapper)).toBe(row)
  })

  it('keeps undefined as undefined', () => {
    expect(unwrapTooltipDatum(undefined)).toBeUndefined()
  })
})
