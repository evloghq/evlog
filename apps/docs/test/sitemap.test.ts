import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { UNSHALLOW_TIMEOUT_MS, ensureFullHistory, historySource, readContentCommitDates } from '../config/content-dates'
import { collectSitemapUrls } from '../server/utils/sitemap'

const contentPages = vi.hoisted(() => [
  { path: '/landing', stem: '0.landing' },
  { path: '/start/introduction', stem: '1.start/1.introduction' },
])

vi.mock('@nuxt/content/server', () => ({
  queryCollection: () => ({ all: () => Promise.resolve(contentPages) }),
}))

const appDir = fileURLToPath(new URL('..', import.meta.url))

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

  it('fetches from the public GitHub URL, since Vercel clones without a remote', () => {
    const calls: string[][] = []
    const env = { VERCEL_GIT_REPO_OWNER: 'acme', VERCEL_GIT_REPO_SLUG: 'docs', VERCEL_GIT_COMMIT_REF: 'main' }
    ensureFullHistory('/repo', (args) => {
      calls.push(args)
      return 'true\n'
    }, env)

    expect(calls[1]).toEqual(['fetch', '--unshallow', '--filter=blob:none', '--quiet', 'https://github.com/acme/docs.git', 'main'])
  })

  it('defaults to evloghq/evlog outside Vercel', () => {
    expect(historySource({})).toEqual({ url: 'https://github.com/evloghq/evlog.git', ref: 'HEAD' })
  })

  it('logs one line with the outcome and the number of distinct dates', () => {
    const lines: string[] = []
    const git = (args: string[]) => args[0] === 'log' ? log : 'true\n'
    readContentCommitDates('/repo', git, { env: {}, log: line => lines.push(line) })

    expect(lines).toEqual(['[content-dates] unshallowed from https://github.com/evloghq/evlog.git; 2 files, 2 distinct dates'])
  })

  it('logs the failure reason when the fetch fails', () => {
    const lines: string[] = []
    const git = (args: string[]) => {
      if (args[0] === 'fetch') throw new Error('fatal: unable to access\nmore detail')
      return args[0] === 'log' ? log : 'true\n'
    }
    readContentCommitDates('/repo', git, { env: {}, log: line => lines.push(line) })

    expect(lines[0]).toBe('[content-dates] unshallow from https://github.com/evloghq/evlog.git failed (fatal: unable to access), keeping shallow dates; 2 files, 2 distinct dates')
  })
})

describe('sitemap source', () => {
  // `@nuxtjs/sitemap` (registered by Docus) owns `/sitemap.xml` and builds it from the
  // sources Docus lists. A source we do not shadow brings back a sitemap with no lastmod.
  it('shadows every local sitemap source Docus registers', () => {
    const docusConfig = readFileSync(fileURLToPath(new URL('../node_modules/docus/nuxt.config.ts', import.meta.url)), 'utf8')
    const sources = docusConfig.match(/sources:\s*\[([^\]]*)\]/)?.[1]?.match(/'[^']+'/g)?.map(source => source.slice(1, -1))

    expect(sources).toEqual(['/api/__sitemap__/urls'])
    for (const source of sources!) {
      expect(existsSync(`${appDir}server${source}.ts`), `server${source}.ts`).toBe(true)
    }
  })

  it('does not ship a sitemap.xml route, which the module handler would silently shadow', () => {
    expect(existsSync(`${appDir}server/routes/sitemap.xml.ts`)).toBe(false)
  })

  it('dates every page from its last commit and lists the home page at /', async () => {
    vi.stubGlobal('defineSitemapEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useRuntimeConfig', () => ({
      contentCommitDates: { '0.landing': '2026-10-17', '1.start/1.introduction': '2026-10-11' },
    }))
    try {
      const { default: source } = await import('../server/api/__sitemap__/urls')

      expect(await (source as unknown as (event: unknown) => Promise<unknown>)({})).toEqual([
        { loc: '/', lastmod: '2026-10-17' },
        { loc: '/start/introduction', lastmod: '2026-10-11' },
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
