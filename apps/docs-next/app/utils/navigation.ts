import type { NavigationItem } from 'comark-content'
import type { RouteLocationNormalized } from 'vue-router'

/** Logical top-level segment of a path, ignoring the active version `base`. */
export function segmentOf(path: string, base: string): string {
  const rel = base && path.startsWith(base) ? path.slice(base.length) : path
  return rel.split('/').filter(Boolean)[0] ?? ''
}

/** What decides where a header tab links and when it is active. */
export interface NavGroupTarget {
  /** Top-level content sections grouped under this tab. */
  sections?: string[]
  /**
   * Explicit link target. Alone it makes a manual tab backed by an app route; together with `sections`
   * the tab still owns those sections for the sidebar and its active state, and is also active under `to`.
   */
  to?: string
  /** Path prefix that marks the tab active; defaults to `to`. */
  activePath?: string
}

/**
 * Whether a header tab is active on `path`: on any of its `sections`, and under `activePath` or its
 * own `to` (a target that renders a page rather than redirecting).
 */
export function isNavGroupActive(group: NavGroupTarget, path: string, base: string): boolean {
  const seg = segmentOf(path, base)
  if (group.sections?.includes(seg)) return true
  // A target may carry a query or hash (`/play?example=basic`); only its path names a segment.
  const target = group.activePath ?? group.to
  return !!target && seg === segmentOf(target.split(/[?#]/)[0]!, base)
}

export function findPageHeadline(
  navigation: NavigationItem[] | undefined | null,
  path: string | undefined
): string | undefined {
  if (!navigation?.length || !path) return undefined
  for (const item of navigation) {
    if (item.children?.length) {
      const found = walk(item.children, path)
      if (found) return item.title
    }
  }
  return undefined
}

function walk(items: NavigationItem[], path: string): boolean {
  for (const item of items) {
    if (item.path === path) return true
    if (item.children?.length && walk(item.children, path)) return true
  }
  return false
}

export { findFirstLeaf } from '../../utils/navigation'

export interface BreadcrumbItem {
  title: string
  path?: string
}

export type NavigationLayout = 'docs' | 'page'

export function resolveRouteLayout(
  navigation: NavigationItem[] | undefined | null,
  route: Pick<RouteLocationNormalized, 'meta' | 'matched'>,
  path: string
): NavigationLayout | undefined {
  if (route.meta.layout === false) return undefined
  if (route.meta.layout === 'docs' || route.meta.layout === 'page') return route.meta.layout
  const layout = findNavigationLayout(navigation, path)
  const name = route.matched[0]?.name
  if (!layout && (name === 'slug' || name === 'docs-pr' || name === 'docs-blob' || name === 'docs-tree')) return 'docs'
  return layout
}

/** Layout declared by the nearest matching page or directory navigation node. */
export function findNavigationLayout(
  navigation: NavigationItem[] | undefined | null,
  path: string | undefined
): NavigationLayout | undefined {
  if (!navigation?.length || !path) return undefined

  let layout: NavigationLayout | undefined
  const visit = (items: NavigationItem[]) => {
    for (const item of items) {
      const isPage = item.path === path
      const isDirectory = Boolean(
        item.children?.length
        && item.path !== '/'
        && path.startsWith(`${item.path}/`)
      )
      if (!isPage && !isDirectory) continue

      const { layout: itemLayout } = item
      if (itemLayout === 'docs' || itemLayout === 'page') layout = itemLayout
      if (item.children?.length) visit(item.children)
    }
  }

  visit(navigation)
  return layout
}

/** Trail of navigation items leading to `path`, including the page itself. */
export function findBreadcrumb(
  navigation: NavigationItem[] | undefined | null,
  path: string | undefined
): BreadcrumbItem[] {
  if (!navigation?.length || !path) return []
  const trail: BreadcrumbItem[] = []
  const visit = (items: NavigationItem[]): boolean => {
    for (const item of items) {
      trail.push({ title: item.title, path: item.page !== false ? item.path : undefined })
      if (item.path === path && item.page !== false) return true
      if (item.children?.length && visit(item.children)) return true
      trail.pop()
    }
    return false
  }
  return visit(navigation) ? trail : []
}

export interface SurroundLink {
  title: string
  description?: string
  path: string
}

export function findSurroundLinks(
  navigation: NavigationItem[] | undefined | null,
  path: string | undefined
): Array<SurroundLink | null> {
  if (!navigation?.length || !path) return []

  const flat: SurroundLink[] = []
  const collect = (items: NavigationItem[]) => {
    for (const item of items) {
      // A directory `index.md` is emitted twice: as the section node and as its own first child.
      // Keep only the child, or the page's next link points back at the page itself.
      const selfIndexed = item.children?.some((child) => child.path === item.path)
      if (item.page !== false && !selfIndexed) {
        flat.push({ title: item.title, description: item.description, path: item.path })
      }
      if (item.children?.length) collect(item.children)
    }
  }
  collect(navigation)

  const index = flat.findIndex((item) => item.path === path)
  if (index === -1) return []
  return [flat[index - 1] || null, flat[index + 1] || null]
}
