import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listedChildren, type SidebarItem } from '../app/composables/useDocsSidebar'

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

  it('lists every page under a section that is not a catalogue', () => {
    expect(listedChildren(events, '/events/redaction').map(child => child.path)).toEqual(['/events/sampling', '/events/redaction'])
  })

  // The sidebar does not list a catalogue's pages, so its overview page is the way to each of them.
  it.each([
    ['4.drains', '/drains'],
    ['10.integrations', '/integrations'],
  ])('%s: the overview links every page of the catalogue', (dir, base) => {
    const files = readdirSync(resolve(contentDir, dir)).filter(file => file.endsWith('.md'))
    const overview = readFileSync(resolve(contentDir, dir, files.find(file => /^\d+\.index\.md$/.test(file))!), 'utf8')
    const pages = files.filter(file => !file.includes('.index.')).map(file => `${base}/${file.replace(/^\d+\./, '').replace(/\.md$/, '')}`)

    expect(pages.length).toBeGreaterThan(10)
    expect(pages.filter(page => !overview.includes(`](${page})`))).toEqual([])
  })
})
