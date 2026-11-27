import type { NavigationItem } from 'comark-content'
import { segmentOf } from 'comark-docs/app/utils/navigation'
import type { SidebarGroup, SidebarItem } from '~/composables/useDocsSidebar'

/**
 * A docs version, as listed in `nuxt.config.ts`. One with a `branch` and a `contentDir` is mounted at
 * `/<id>` and read from that directory at that branch; the one without is the app's own content at `/`.
 */
export interface DocsVersion {
  id: string
  label: string
  badge?: string
  branch?: string
  contentDir?: string
  /** Where the version switch lands for the app's own version, whose `/` is the site's landing page. */
  home?: string
}

/** The mounted version a path under the catch-all route belongs to, and the path inside that version. */
export function splitVersionPath(path: string, versions: DocsVersion[]) {
  const [, first, ...rest] = path.split('/')
  const version = versions.find(version => version.branch && version.id === first)
  return version && { version, path: `/${rest.join('/')}` }
}

/** The version read under `routeBase`: the one mounted there, otherwise the app's own. */
export function currentVersion(versions: DocsVersion[], routeBase: string) {
  return versions.find(version => version.branch && `/${version.id}` === routeBase)
    ?? versions.find(version => !version.branch)
}

export function versionItems(versions: DocsVersion[], current: DocsVersion | undefined) {
  return versions.map(version => ({
    label: version.label,
    badge: version.badge,
    to: version.branch ? `/${version.id}` : version.home ?? '/',
    current: version.id === current?.id,
  }))
}

/** The versions listed in `nuxt.config.ts`. Nuxt types an array in the runtime config without its entries. */
export function configuredVersions() {
  return useRuntimeConfig().public.docsVersions as DocsVersion[]
}

export function useDocsVersions() {
  const versions = configuredVersions()
  const content = useDocsContent()
  const current = computed(() => currentVersion(versions, content.value.routeBase))
  const items = computed(() => versionItems(versions, current.value))
  return { versions, current, items }
}

/** The first page of a navigation tree, where a version without a landing page starts. */
export function firstPage(nav: NavigationItem[]): string | undefined {
  let [node] = nav
  while (node?.children?.length) [node] = node.children
  return node?.path
}

/**
 * The pages a sidebar entry lists. The sidebar draws two levels and v2 nests a third under some entries
 * (Adapters > Cloud > Axiom): those pages take the place of their directory, which has no page of its own.
 */
export function flattenPages(children: SidebarItem[]): SidebarItem[] {
  return children.flatMap(child => child.children.length ? child.children : [child])
}

/**
 * Whether the configured sidebar groups were written for this navigation tree: they name every one of
 * its sections. Naming some is not enough, v2 and v3 share `start` and `reference`.
 */
export function navGroupsApply(groups: SidebarGroup[], nav: NavigationItem[], base: string) {
  const named = new Set(groups.flatMap(group => group.sections))
  return nav.every(node => named.has(segmentOf(node.path, base)))
}
