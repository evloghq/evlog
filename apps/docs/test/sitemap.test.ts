import { describe, expect, it } from 'vitest'
import { UNSHALLOW_TIMEOUT_MS, ensureFullHistory, readContentCommitDates } from '../config/content-dates'
import { collectSitemapUrls } from '../server/utils/sitemap'

describe('collectSitemapUrls', () => {
  it('maps content paths to sitemap entries', () => {
    expect(collectSitemapUrls([{ path: '/learn/wide-events' }])).toEqual([{ loc: '/learn/wide-events' }])
  })

  it('rewrites the landing content path to the home page', () => {
    expect(collectSitemapUrls([{ path: '/landing' }])).toEqual([{ loc: '/' }])
  })

  it('excludes pages opting out through frontmatter', () => {
    const pages = [
      { path: '/public' },
      { path: '/private', meta: { sitemap: false } },
    ]

    expect(collectSitemapUrls(pages)).toEqual([{ loc: '/public' }])
  })

  it('excludes navigation configuration files', () => {
    const pages = [
      { path: '/learn/.navigation' },
      { path: '/.navigation' },
      { path: '/learn/overview' },
    ]

    expect(collectSitemapUrls(pages)).toEqual([{ loc: '/learn/overview' }])
  })

  it('deduplicates repeated paths', () => {
    const pages = [{ path: '/landing' }, { path: '/' }]

    expect(collectSitemapUrls(pages)).toEqual([{ loc: '/' }])
  })

  it('reads lastmod from the commit date of the page stem', () => {
    const pages = [{ path: '/learn/overview', stem: '2.learn/0.overview' }]

    const dates = { '2.learn/0.overview': '2026-04-16' }

    expect(collectSitemapUrls(pages, dates)).toEqual([{ loc: '/learn/overview', lastmod: '2026-04-16' }])
  })

  it('omits lastmod for pages with no commit date', () => {
    const pages = [{ path: '/a', stem: 'untracked' }, { path: '/b' }]

    expect(collectSitemapUrls(pages, { other: '2026-04-16' })).toEqual([{ loc: '/a' }, { loc: '/b' }])
  })
})

describe('per-file lastmod', () => {
  const log = [
    '2026-10-11',
    '',
    'content/1.start/1.introduction.md',
    '2026-07-15',
    '',
    'content/4.integrate/frameworks/01.nuxt.md',
  ].join('\n')

  it('gives each page the date of its own last commit, not the build commit', () => {
    const git = (args: string[]) => args[0] === 'log' ? log : 'false\n'
    const pages = [
      { path: '/start/introduction', stem: '1.start/1.introduction' },
      { path: '/integrate/frameworks/nuxt', stem: '4.integrate/frameworks/01.nuxt' },
    ]

    expect(collectSitemapUrls(pages, readContentCommitDates('/repo', git))).toEqual([
      { loc: '/start/introduction', lastmod: '2026-10-11' },
      { loc: '/integrate/frameworks/nuxt', lastmod: '2026-07-15' },
    ])
  })

  it('unshallows a shallow clone before reading dates', () => {
    const calls: string[][] = []
    const git = (args: string[]) => {
      calls.push(args)
      return args[0] === 'rev-parse' ? 'true\n' : log
    }

    readContentCommitDates('/repo', git)

    expect(calls.map(args => args.slice(0, 2))).toEqual([
      ['rev-parse', '--is-shallow-repository'],
      ['fetch', '--unshallow'],
      ['log', '--format=%cs'],
    ])
  })

  it('skips the fetch on a full clone', () => {
    const calls: string[][] = []
    ensureFullHistory('/repo', (args) => {
      calls.push(args)
      return 'false\n'
    })

    expect(calls).toHaveLength(1)
  })

  it('bounds the unshallow fetch with a timeout', () => {
    let fetchTimeout: number | undefined
    ensureFullHistory('/repo', (args, _cwd, options) => {
      if (args[0] === 'fetch') fetchTimeout = options?.timeout
      return 'true\n'
    })

    expect(fetchTimeout).toBe(UNSHALLOW_TIMEOUT_MS)
  })

  it('keeps building when the fetch fails', () => {
    const git = (args: string[]) => {
      if (args[0] === 'fetch') throw new Error('offline')
      return args[0] === 'rev-parse' ? 'true\n' : log
    }

    expect(Object.keys(readContentCommitDates('/repo', git))).toHaveLength(2)
  })
})
