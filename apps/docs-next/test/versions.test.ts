import type { NavigationItem } from 'comark-content'
import { describe, expect, it } from 'vitest'
import type { SidebarItem } from '../app/composables/useDocsSidebar'
import {
  currentVersion,
  firstPage,
  flattenPages,
  navGroupsApply,
  splitVersionPath,
  versionItems,
  type DocsVersion,
} from '../app/utils/versions'

const v3: DocsVersion = { id: 'v3', label: 'v3', badge: 'beta' }
const v2: DocsVersion = { id: 'v2', label: 'v2', branch: 'main', contentDir: 'apps/docs/content' }
const versions = [v3, v2]

function section(path: string, pages: string[] = []): NavigationItem {
  return { title: path, path, children: pages.map(page => ({ title: page, path: `${path}/${page}` })) } as NavigationItem
}

function entry(path: string, children: SidebarItem[] = []): SidebarItem {
  return { title: path, path, catalog: false, children }
}

describe('mounted versions', () => {
  it('reads a path under a mounted version as that version and the path inside it', () => {
    expect(splitVersionPath('/v2/start/introduction', versions)).toEqual({ version: v2, path: '/start/introduction' })
  })

  it('reads the root of a mounted version as its `/`', () => {
    expect(splitVersionPath('/v2', versions)).toEqual({ version: v2, path: '/' })
    expect(splitVersionPath('/v2/', versions)).toEqual({ version: v2, path: '/' })
  })

  it('leaves the paths of the app\'s own content alone', () => {
    expect(splitVersionPath('/start/introduction', versions)).toBeUndefined()
    expect(splitVersionPath('/', versions)).toBeUndefined()
  })

  it('matches a whole segment, and only a version that is mounted', () => {
    expect(splitVersionPath('/v2-migration', versions)).toBeUndefined()
    expect(splitVersionPath('/start/v2', versions)).toBeUndefined()
    expect(splitVersionPath('/v3/start/introduction', versions)).toBeUndefined()
  })

  it('names the version mounted at the route base as current', () => {
    expect(currentVersion(versions, '/v2')).toBe(v2)
  })

  it('names the app\'s own version as current everywhere else, previews included', () => {
    expect(currentVersion(versions, '')).toBe(v3)
    expect(currentVersion(versions, '/tree/main')).toBe(v3)
  })

  it('links each version inside the app and checks the current one', () => {
    expect(versionItems(versions, v2)).toEqual([
      { label: 'v3', badge: 'beta', to: '/', current: false },
      { label: 'v2', badge: undefined, to: '/v2', current: true },
    ])
  })
  it('sends the app\'s own version to its first docs page when it names one', () => {
    const [own] = versionItems([{ ...v3, home: '/start/introduction' }, v2], v2)

    expect(own!.to).toBe('/start/introduction')
  })


  it('starts a version without a landing on the first page of its first section', () => {
    expect(firstPage([section('/start', ['introduction', 'installation']), section('/learn', ['overview'])]))
      .toBe('/start/introduction')
    expect(firstPage([])).toBeUndefined()
  })
})

describe('the sidebar of a mounted version', () => {
  const groups = [
    { sections: ['start'] },
    { label: 'Core', sections: ['events', 'errors'] },
    { label: 'Reference', sections: ['reference'] },
  ]

  it('applies the configured groups to a tree whose sections they all name', () => {
    expect(navGroupsApply(groups, [section('/start'), section('/events'), section('/reference')], '')).toBe(true)
  })

  it('does not apply them to a tree that only shares some sections', () => {
    const nav = [section('/v2/start'), section('/v2/learn'), section('/v2/reference')]
    expect(navGroupsApply(groups, nav, '/v2')).toBe(false)
  })

  it('lists the pages of a nested directory in its place', () => {
    const axiom = entry('/v2/integrate/adapters/cloud/axiom')
    const sentry = entry('/v2/integrate/adapters/cloud/sentry')
    const overview = entry('/v2/integrate/adapters/overview')
    const cloud = entry('/v2/integrate/adapters/cloud', [axiom, sentry])
    expect(flattenPages([overview, cloud])).toEqual([overview, axiom, sentry])
  })
})
