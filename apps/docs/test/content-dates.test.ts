import { describe, expect, it } from 'vitest'
import { parseCommitDates } from '../config/content-dates'

describe('parseCommitDates', () => {
  it('keys each file by its stem below content/', () => {
    const log = [
      '2026-08-15',
      '',
      'content/7.extend/1.stream.md',
      'content/1.start/.navigation.yml',
    ].join('\n')

    expect(parseCommitDates(log)).toEqual({
      '7.extend/1.stream': '2026-08-15',
      '1.start/.navigation': '2026-08-15',
    })
  })

  it('keeps the most recent commit when a file changed more than once', () => {
    const log = [
      '2026-08-15',
      '',
      'content/7.extend/1.stream.md',
      '2026-07-26',
      '',
      'content/7.extend/1.stream.md',
    ].join('\n')

    expect(parseCommitDates(log)['7.extend/1.stream']).toBe('2026-08-15')
  })

  it('ignores paths outside the content directory', () => {
    const log = ['2026-08-15', '', 'app/pages/index.vue', 'content/0.landing.md'].join('\n')

    expect(parseCommitDates(log)).toEqual({ '0.landing': '2026-08-15' })
  })

  it('returns nothing for a repository with no content history', () => {
    expect(parseCommitDates('')).toEqual({})
  })
})
