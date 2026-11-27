import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NavigationItem } from 'comark-content'
import { groupItems, listedChildren, revealDistance, surroundOf, trail, type SidebarItem } from '../app/composables/useDocsSidebar'

const contentDir = resolve(import.meta.dirname, '../content')

function entry(path: string, catalog: boolean, children: string[]): SidebarItem {
  return { title: path, path, catalog, children: children.map(child => ({ title: child, path: child, catalog: false, children: [] })) }
}

describe('the sidebar', () => {
  const drains = entry('/drains', true, ['/drains/axiom', '/drains/sentry', '/drains/otlp'])
  const events = entry('/events', false, ['/events/sampling', '/events/redaction'])

  it('lists only the page being read under a catalogue', () => {
    expect(listedChildren(drains, '/drains/sentry').map(child => child.path)).toEqual(['/drains/sentry'])
  })

  it('lists nothing under a catalogue while its own page is read', () => {
    expect(listedChildren(drains, '/drains')).toEqual([])
  })

  it('lists nothing under a section the reader is outside of', () => {
    expect(listedChildren(events, '/errors')).toEqual([])
    expect(listedChildren(events, '/events-archive')).toEqual([])
  })

  // The reader's framework keeps its row under Integrations on every page.
  const integrations = entry('/integrations', true, ['/integrations/nuxt', '/integrations/hono', '/extend/ai-sdk'])
  const chosen = (child: SidebarItem) => child.path === '/integrations/hono'

  it('lists a pinned page of a catalogue wherever the reader is', () => {
    expect(listedChildren(integrations, '/events/sampling', chosen).map(child => child.path)).toEqual(['/integrations/hono'])
  })

  it('lists the pinned page before the page being read, and once when they are the same', () => {
    expect(listedChildren(integrations, '/integrations/nuxt', chosen).map(child => child.path)).toEqual(['/integrations/hono', '/integrations/nuxt'])
    expect(listedChildren(integrations, '/integrations/hono', chosen).map(child => child.path)).toEqual(['/integrations/hono'])
  })

  it('lists every page under a section that is not a catalogue', () => {
    expect(listedChildren(events, '/events/redaction').map(child => child.path)).toEqual(['/events/sampling', '/events/redaction'])
  })

  const section = (path: string, children: string[] = []) =>
    ({ title: path, path, children: children.map(child => ({ title: child, path: child })) }) as NavigationItem

  it('lists the pages of a group with one section', () => {
    const nodes = new Map([['start', section('/start', ['/start/introduction', '/start/installation'])]])

    expect(groupItems({ sections: ['start'] }, nodes).map(item => item.path)).toEqual(['/start/introduction', '/start/installation'])
  })

  it('lists one entry per section of a group with several', () => {
    const nodes = new Map([
      ['reference', section('/reference', ['/reference/configuration', '/reference/glossary'])],
      ['events', section('/events', ['/events/sampling'])],
    ])
    const items = groupItems({ sections: ['events', 'reference'], catalogs: ['reference'] }, nodes)

    expect(items.map(item => [item.path, item.catalog, item.children.length])).toEqual([
      ['/events', false, 1],
      ['/reference', true, 2],
    ])
  })

  // The event's path lifts three of Events' pages to steps of their own, in the order evlog runs them.
  it('lists the steps in order, lifting a page out of its section and keeping its parent', () => {
    const nodes = new Map([
      ['events', { ...section('/events', ['/events/sampling', '/events/lifecycle']), title: 'Events' }],
      ['drains', section('/drains', ['/drains/axiom'])],
    ])
    const items = groupItems({ sections: ['events', 'drains'], steps: ['events', 'events/sampling', 'drains'], catalogs: ['drains'] }, nodes)

    expect(items.map(item => [item.path, item.children.map(child => child.path), item.parent?.path])).toEqual([
      ['/events', ['/events/lifecycle'], undefined],
      ['/events/sampling', [], '/events'],
      ['/drains', ['/drains/axiom'], undefined],
    ])
  })

  it('does not open a section while a page lifted out of it is read', () => {
    const lifecycleOnly = entry('/events', false, ['/events/lifecycle'])

    expect(listedChildren(lifecycleOnly, '/events/sampling')).toEqual([])
    expect(listedChildren(lifecycleOnly, '/events/lifecycle').map(child => child.path)).toEqual(['/events/lifecycle'])
  })

  it('skips a section the navigation does not have', () => {
    const nodes = new Map([['map', section('/map')]])

    expect(groupItems({ sections: ['map', 'cli'], catalogs: ['cli'] }, nodes).map(item => item.path)).toEqual(['/map'])
  })

  it('leaves the sidebar where it is while the current entry is in view', () => {
    expect(revealDistance({ top: 100, bottom: 700 }, { top: 660, bottom: 688 })).toBe(0)
  })

  it('scrolls an entry below the fold to a third of the way down', () => {
    expect(revealDistance({ top: 100, bottom: 700 }, { top: 1090, bottom: 1118 })).toBe(790)
  })

  it('scrolls back up to an entry cut by the top edge', () => {
    expect(revealDistance({ top: 100, bottom: 700 }, { top: 90, bottom: 118 })).toBe(-210)
  })

  // The sidebar does not list a catalogue's pages, so its overview page is the way to each of them. The
  // Extend overview is the map of every extension point, so it links each of its pages too.
  it.each([
    ['4.drains', '/drains', 14],
    ['10.integrations', '/integrations', 17],
    ['12.cli', '/cli', 6],
    ['13.compare', '/compare', 6],
    ['11.reference', '/reference', 5],
    ['14.extend', '/extend', 8],
  ])('%s: the overview links every page of the catalogue', (dir, base, atLeast) => {
    const files = readdirSync(resolve(contentDir, dir)).filter(file => file.endsWith('.md'))
    const overview = readFileSync(resolve(contentDir, dir, files.find(file => /^\d+\.index\.md$/.test(file))!), 'utf8')
    const pages = files.filter(file => !file.includes('.index.')).map(file => `${base}/${file.replace(/^\d+\./, '').replace(/\.md$/, '')}`)

    expect(pages.length).toBeGreaterThanOrEqual(atLeast)
    expect(pages.filter(page => !overview.includes(`](${page})`))).toEqual([])
  })
})

describe('the event\'s path', () => {
  const rows = (current?: string) => [
    { y: 14.5, current: current === 'integrations', children: [] },
    { y: 42.5, current: current === 'events', children: [
      { y: 68.5, end: 34, current: current === 'lifecycle' },
      { y: 94.5, end: 34, current: false },
    ] },
    { y: 122.5, current: current === 'drains', children: [{ y: 148.5, end: 34, current: false }] },
  ]

  it('runs the spine down to the last nested page under the last step', () => {
    expect(trail(rows()).line.startsWith('M6.5 14.5V142.5')).toBe(true)
  })

  it('lights one stroke from a step to its nested page being read, and marks that step', () => {
    const path = trail(rows('lifecycle'))
    expect(path.lit).toBe('M6.5 42.5V62.5A6 6 0 0 0 12.5 68.5H34')
    expect(path.stops.map(stop => stop.state)).toEqual(['off', 'on', 'off'])
  })

  it('fills each stop further than the one before, to a full disc at the last step', () => {
    const [first, second, last] = trail(rows()).stops.map(stop => stop.fill)
    expect(first).toBe('M6.5 14.5V12A2.5 2.5 0 0 1 8.67 15.75Z')
    expect(second).toBe('M6.5 42.5V40A2.5 2.5 0 1 1 4.33 43.75Z')
    expect(last).toBe('M6.5 120A2.5 2.5 0 1 1 6.5 125A2.5 2.5 0 1 1 6.5 120Z')
  })

  it('lights no line when the page being read is a step', () => {
    const path = trail(rows('events'))
    expect(path.lit).toBeUndefined()
    expect(path.stops.map(stop => stop.state)).toEqual(['off', 'here', 'off'])
  })
})

describe('previous and next', () => {
  const page = (path: string, children: SidebarItem[] = [], catalog = false): SidebarItem => ({ title: path, path, catalog, children })
  const blocks = [
    { items: [page('/start/quick-start')] },
    { steps: true, items: [
      page('/integrations', [page('/integrations/hono'), page('/integrations/nuxt')], true),
      page('/events', [page('/events/lifecycle')]),
      page('/events/sampling'),
      page('/drains', [page('/drains/axiom'), page('/drains/sentry')], true),
    ] },
    { items: [page('/audit')] },
  ]
  const around = (path: string) => surroundOf(blocks, path)?.map(item => item?.path)

  it('follows the event\'s path, through a step\'s own pages, across groups', () => {
    expect(around('/events/lifecycle')).toEqual(['/events', '/events/sampling'])
    expect(around('/integrations')).toEqual(['/start/quick-start', '/events'])
    expect(around('/drains')).toEqual(['/events/sampling', '/audit'])
  })

  it('leads a catalogue page back to its catalogue and on to the next step, not to its siblings', () => {
    expect(around('/drains/sentry')).toEqual(['/drains', '/audit'])
    expect(around('/integrations/hono')).toEqual(['/integrations', '/events'])
  })

  it('knows nothing of a page outside the sidebar', () => {
    expect(surroundOf(blocks, '/elsewhere')).toBeUndefined()
  })
})
