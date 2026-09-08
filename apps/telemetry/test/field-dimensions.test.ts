import { describe, expect, it } from 'vitest'
import { OTHER_VERSION } from '../shared/utils/adoption-shape'
import {
  GRADE_ORDER,
  OTHER_FIELD_GROUP,
  fieldGroup,
  frameworkColor,
  frameworkIcon,
  frameworkLabel,
  gradeForScore,
  gradeRange,
  groupFieldStats,
  toScoreHistogram,
} from '../shared/utils/field-dimensions'

describe('fieldGroup', () => {
  it('reads the reporting command off the key prefix', () => {
    expect(fieldGroup('mapFailWideEvent')).toBe('map')
    expect(fieldGroup('initDevDrain')).toBe('init')
    expect(fieldGroup('agentsSkillsFound')).toBe('agents')
  })

  it('files both of doctor\'s prefixes under doctor', () => {
    /* `doctor` reports `checksFailed` alongside `doctorEvlogFound`; two
       headings for one command would read as two commands. */
    expect(fieldGroup('checksFailed')).toBe('doctor')
    expect(fieldGroup('doctorEvlogFound')).toBe('doctor')
  })

  it('requires the prefix to end at a word boundary', () => {
    /* Otherwise `mapped`/`initial` would be filed under a command that never
       reported them, which is worse than leaving them ungrouped. */
    expect(fieldGroup('mapped')).toBe(OTHER_FIELD_GROUP)
    expect(fieldGroup('initial')).toBe(OTHER_FIELD_GROUP)
    expect(fieldGroup('workspace')).toBe(OTHER_FIELD_GROUP)
  })
})

describe('groupFieldStats', () => {
  const stats = [
    { key: 'mapScore', count: 90 },
    { key: 'workspace', count: 500 },
    { key: 'initDevDrain', count: 40 },
    { key: 'mapDark', count: 10 },
  ]

  it('buckets keys by command, busiest command first', () => {
    expect(groupFieldStats(stats).map(g => g.group)).toEqual(['map', 'init', OTHER_FIELD_GROUP])
  })

  it('keeps the leftovers bin last however busy it is', () => {
    /* `workspace` outweighs every named group here; letting volume decide
       would put the bin of things we could not classify at the top. */
    const groups = groupFieldStats(stats)
    expect(groups.at(-1)!.group).toBe(OTHER_FIELD_GROUP)
    expect(groups.at(-1)!.count).toBe(500)
  })

  it('totals each group', () => {
    expect(groupFieldStats(stats).find(g => g.group === 'map')!.count).toBe(100)
  })
})

describe('gradeRange', () => {
  it('gives every grade band the score window it covers', () => {
    /* The words are a judgement until the reader knows the axis — and the
       windows have to match `gradeFromScore()` in the CLI. */
    expect(GRADE_ORDER.every(grade => gradeRange(grade) !== undefined)).toBe(true)
    expect(gradeRange('excellent')).toBe('90–100')
    expect(gradeRange('good')).toBe('70–89')
    expect(gradeRange('needs-work')).toBe('50–69')
    expect(gradeRange('at-risk')).toBe('0–49')
  })
})

describe('toScoreHistogram', () => {
  function bins(values: { value: string, count: number }[]) {
    return toScoreHistogram(values.map(v => ({ ...v, errors: 0 })))
  }

  it('bins scores in tens across the whole 0-100 axis', () => {
    const out = bins([{ value: '0', count: 1 }, { value: '55', count: 2 }, { value: '94', count: 3 }])

    expect(out).toHaveLength(10)
    expect(out[0]!.count).toBe(1)
    expect(out[5]!.count).toBe(2)
    expect(out[9]!.count).toBe(3)
  })

  it('puts a perfect 100 in the top bin rather than an eleventh', () => {
    /* `Math.floor(100 / 10)` is 10 — one past the last bin, which would drop
       the only score anyone brags about. */
    const out = bins([{ value: '100', count: 4 }])
    expect(out).toHaveLength(10)
    expect(out[9]!.count).toBe(4)
    expect(out[9]!.label).toBe('90–100')
  })

  it('ignores values that are not a score', () => {
    const out = bins([{ value: 'nope', count: 9 }, { value: '-5', count: 9 }, { value: '140', count: 9 }])
    expect(out.every(bin => bin.count === 0)).toBe(true)
  })
})

describe('gradeForScore', () => {
  it('agrees with the band each histogram bin is coloured by', () => {
    /* Drifting from `gradeFromScore()` in the CLI would colour a bin as one
       band while the rows underneath count it in another. */
    expect(gradeForScore(90)).toBe('excellent')
    expect(gradeForScore(89)).toBe('good')
    expect(gradeForScore(70)).toBe('good')
    expect(gradeForScore(69)).toBe('needs-work')
    expect(gradeForScore(50)).toBe('needs-work')
    expect(gradeForScore(49)).toBe('at-risk')
  })
})

describe('frameworkColor', () => {
  it('keys the hue to the framework, not to its rank', () => {
    /* A filter that drops the busiest framework must not repaint the rest —
       a reader who learned "Nuxt is indigo" would be misled. */
    expect(frameworkColor('nuxt')).toBe('var(--chart-cat-1)')
    expect(frameworkColor('next')).toBe('var(--chart-cat-2)')
    expect(new Set(['nuxt', 'next', 'nitro', 'tanstack-start', 'hono'].map(frameworkColor)).size).toBe(5)
  })

  it('gives ids the CLI cannot emit the neutral rather than a category slot', () => {
    expect(frameworkColor('fastify')).toBe('var(--chart-cat-other)')
    expect(frameworkColor(OTHER_VERSION)).toBe('var(--chart-cat-other)')
  })
})

describe('frameworkIcon / frameworkLabel', () => {
  it('gives every framework the CLI reports its own mark and display name', () => {
    /* The CLI reports five ids (`packages/cli/src/lib/map/types.ts`); one
       missing here falls back to a generic box and its raw slug. */
    for (const id of ['nuxt', 'next', 'nitro', 'tanstack-start', 'hono']) {
      expect(frameworkIcon(id)).not.toBe('i-nucleo-box')
      expect(frameworkLabel(id)).not.toBe(id)
    }
    expect(frameworkLabel('hono')).toBe('Hono')
  })
})
