import { describe, expect, it } from 'vitest'
import { corpusFindings, routeOf, slugOf } from './reach.mjs'

const page = (path, description, links = [], headings = []) => ({
  path,
  frontmatter: description === null ? {} : { description },
  links: links.map(href => ({ href, line: 1 })),
  headings: headings.map(raw => ({ raw })),
})

describe('routeOf', () => {
  it('derives the route a content file serves', () => {
    expect(routeOf('apps/docs/content/2.learn/5.sampling.md')).toBe('/learn/sampling')
    expect(routeOf('apps/docs/content/4.integrate/adapters/01.overview.md')).toBe('/integrate/adapters')
  })

  it('returns nothing for a file that serves no route', () => {
    expect(routeOf('packages/evlog/README.md')).toBeNull()
    expect(routeOf('apps/docs/content/0.landing.md')).toBeNull()
  })
})

describe('slugOf', () => {
  it('removes punctuation instead of collapsing it', () => {
    // The renderer drops the character and keeps the space it sat between, so
    // these anchors carry two and three dashes and the corpus links to them.
    expect(slugOf('Drain & Enrichers')).toBe('drain--enrichers')
    expect(slugOf('The ratchet: `--baseline`')).toBe('the-ratchet---baseline')
    expect(slugOf('HTTP drain (browser to server)')).toBe('http-drain-browser-to-server')
  })

  it('keeps underscores, as the renderer does', () => {
    expect(slugOf('AI fields under `gen_ai`')).toBe('ai-fields-under-gen_ai')
  })
})

describe('corpusFindings', () => {
  const long = 'x'.repeat(200)
  const fine = 'A description that is comfortably inside what a search result will show the reader today.'

  it('measures a description only where there is a search result to fill', () => {
    const docs = corpusFindings([page('apps/docs/content/2.learn/a.md', long)])
    const skill = corpusFindings([page('.agents/skills/create-adapter/SKILL.md', long)])

    expect(docs.get('apps/docs/content/2.learn/a.md')?.some(f => f.id === 'D-02')).toBe(true)
    expect(skill.size).toBe(0)
  })

  it('flags a link whose heading was renamed away', () => {
    const source = page('apps/docs/content/4.integrate/a.md', fine, ['#choosing-a-record-shape'], ['Choose a record shape'])
    const found = corpusFindings([source])

    expect(found.get('apps/docs/content/4.integrate/a.md').some(f => f.id === 'D-12')).toBe(true)
  })

  it('follows an anchor onto the page it points at', () => {
    const target = page('apps/docs/content/2.learn/b.md', fine, [], ['Error Catalogs'])
    const source = page('apps/docs/content/4.integrate/a.md', fine, ['/learn/b#error-catalogs'], [])
    const found = corpusFindings([source, target])

    expect(found.get('apps/docs/content/4.integrate/a.md')?.some(f => f.id === 'D-12') ?? false).toBe(false)
  })

  it('leaves an anchor on a page it cannot see alone', () => {
    const source = page('apps/docs/content/4.integrate/a.md', fine, ['https://getpino.io/#/docs/transports'], [])
    const found = corpusFindings([source])

    expect(found.get('apps/docs/content/4.integrate/a.md')?.some(f => f.id === 'D-12') ?? false).toBe(false)
  })

  it('flags a description too short to earn its slot', () => {
    const found = corpusFindings([page('apps/docs/content/2.learn/a.md', 'Sampling.')])

    expect(found.get('apps/docs/content/2.learn/a.md')[0].message).toContain('the slot holds')
  })

  it('flags a page nothing points at, and clears it once something does', () => {
    const orphan = [page('apps/docs/content/2.learn/a.md', fine), page('apps/docs/content/2.learn/b.md', fine)]
    const linked = [page('apps/docs/content/2.learn/a.md', fine), page('apps/docs/content/2.learn/b.md', fine, ['/learn/a'])]

    expect(corpusFindings(orphan).get('apps/docs/content/2.learn/a.md')?.[0].id).toBe('D-11')
    expect(corpusFindings(linked).get('apps/docs/content/2.learn/a.md')).toBeUndefined()
  })

  it('does not let a page suggest itself', () => {
    // The link is real and points at this page's own route, which tells no
    // reader anywhere else that the page exists.
    const pages = [page('apps/docs/content/2.learn/a.md', fine, ['/learn/a']), page('apps/docs/content/2.learn/b.md', fine)]

    expect(corpusFindings(pages).get('apps/docs/content/2.learn/a.md')?.[0].id).toBe('D-11')
  })

  it('exempts a section index, numbered prefix included', () => {
    const pages = [
      page('apps/docs/content/2.learn/0.overview.md', fine),
      page('apps/docs/content/4.integrate/index.md', fine),
      page('apps/docs/content/2.learn/a.md', fine, ['/learn', '/integrate']),
    ]
    const found = corpusFindings(pages)

    expect(found.get('apps/docs/content/2.learn/0.overview.md')).toBeUndefined()
    expect(found.get('apps/docs/content/4.integrate/index.md')).toBeUndefined()
  })

  it('counts a link that lives in a card prop or a table cell', () => {
    // `links` is what the parser harvested, wherever it found it.
    const pages = [page('apps/docs/content/2.learn/a.md', fine), page('apps/docs/content/2.learn/index.md', fine, ['/learn/a#section'])]

    expect(corpusFindings(pages).get('apps/docs/content/2.learn/a.md')).toBeUndefined()
  })
})
