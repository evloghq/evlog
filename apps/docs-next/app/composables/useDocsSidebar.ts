import type { NavigationItem } from 'comark-content'

export interface SidebarGroup {
  /** Dim label above the group. No label for the first block (Introduction, Installation...). */
  label?: string
  /** Top-level content sections. One section lists its pages; several list one entry per section. */
  sections: string[]
  /**
   * Sections whose pages are a catalogue the reader picks one of (the drains). The section's own page
   * lists them all, so the sidebar shows only the one being read.
   */
  catalogs?: string[]
  /**
   * The steps of the event's path, in the order evlog runs them: sections (`events`) or pages lifted
   * out of their section (`events/sampling`). A group with steps lists exactly these.
   */
  steps?: string[]
}

export interface SidebarItem {
  title: string
  path: string
  /** Pages of a multi-page product, listed under it. */
  children: SidebarItem[]
  /** The children are a catalogue: only the one being read is listed. */
  catalog: boolean
  /** The section a page lifted out of it still belongs to, for the breadcrumb. */
  parent?: { title: string, path: string }
}

export interface SidebarBlock {
  label?: string
  /** The section whose pages the block lists, when it lists one section's pages. */
  section?: string
  /** The items are the steps of the event's path. */
  steps?: boolean
  items: SidebarItem[]
}

function toItem(node: NavigationItem, catalog = false): SidebarItem {
  return {
    title: node.title,
    path: node.path,
    // A directory's index page is the directory's own link, not one of its children.
    children: (node.children ?? []).filter(child => child.path !== node.path).map(child => toItem(child)),
    catalog,
  }
}

/** The entries of one group, from the navigation node of each of its sections that exists. */
export function groupItems(group: SidebarGroup, nodes: Map<string, NavigationItem>): SidebarItem[] {
  if (group.steps) return stepItems(group, nodes)
  const present = group.sections.filter(section => nodes.has(section))
  return present.flatMap((section) => {
    const node = nodes.get(section)!
    return present.length === 1 && node.children?.length
      ? node.children.map(child => toItem(child))
      : [toItem(node, group.catalogs?.includes(section))]
  })
}

function stepItems(group: SidebarGroup, nodes: Map<string, NavigationItem>): SidebarItem[] {
  const lifted = (page: NavigationItem) => group.steps!.some(step => step.includes('/') && page.path.endsWith(`/${step}`))
  return group.steps!.flatMap((step) => {
    const [section, page] = step.split('/') as [string, string?]
    const node = nodes.get(section)
    if (!node) return []
    if (!page) {
      const item = toItem(node, group.catalogs?.includes(section))
      return [{ ...item, children: item.children.filter(child => !lifted({ path: child.path } as NavigationItem)) }]
    }
    const child = node.children?.find(child => child.path.endsWith(`/${page}`))
    return child ? [{ ...toItem(child), parent: { title: node.title, path: node.path } }] : []
  })
}

/** Whether the page at `path` is the entry's own page or one of the pages under it. */
export function holds(item: SidebarItem, path: string): boolean {
  return item.path === path || item.children.some(child => holds(child, path))
}

/**
 * The pages listed under a sidebar entry while the reader is at `path`: every page of the section being
 * read, or for a catalogue the one page being read. A catalogue's `pinned` pages (the reader's
 * framework) are listed first, wherever the reader is.
 */
export function listedChildren(item: SidebarItem, path: string, pinned?: (child: SidebarItem) => boolean): SidebarItem[] {
  if (!item.catalog) return holds(item, path) ? item.children : []
  return [
    ...item.children.filter(child => child.path !== path && pinned?.(child)),
    ...item.children.filter(child => child.path === path),
  ]
}

/**
 * How far the sidebar scrolls to show the entry of the page being read: 0 when the entry is already
 * in view, otherwise the distance that puts it a third of the way down.
 */
export function revealDistance(view: { top: number, bottom: number }, entry: { top: number, bottom: number }): number {
  if (entry.top >= view.top && entry.bottom <= view.bottom) return 0
  return entry.top - view.top - (view.bottom - view.top) / 3
}

function readingOrder(items: SidebarItem[]): SidebarItem[] {
  return items.flatMap(item => [item, ...(item.catalog ? [] : readingOrder(item.children))])
}

/**
 * The pages before and after `path` in the sidebar's order, so Previous and Next walk the event's path.
 * A catalogue page (a framework, a drain) is not chained to its siblings: it leads back to its catalogue
 * and on to the step after it.
 */
export function surroundOf(blocks: SidebarBlock[], path: string): [SidebarItem | undefined, SidebarItem | undefined] | undefined {
  const order = readingOrder(blocks.flatMap(block => block.items))
  const index = order.findIndex(item => item.path === path)
  if (index !== -1) return [order[index - 1], order[index + 1]]
  const catalog = order.findIndex(item => item.catalog && item.children.some(child => child.path === path))
  if (catalog !== -1) return [order[catalog], order[catalog + 1]]
}

export interface TrailRow {
  y: number
  current: boolean
  children: { y: number, end: number, current: boolean }[]
}

export interface Trail {
  line: string
  lit?: string
  stops: { y: number, state: 'here' | 'on' | 'off' }[]
}

const SPINE = 6.5
const BEND = 6

function branch(y: number, end: number) {
  return `V${y - BEND}A${BEND} ${BEND} 0 0 0 ${SPINE + BEND} ${y}H${end}`
}

// The event's path as one drawing: a spine through a stop per step, and an elbow off it to each nested
// page. Only the way to the page being read is lit, as one stroke from its step's stop.
export function trail(rows: TrailRow[]): Trail {
  const ys = rows.flatMap(row => [row.y, ...row.children.map(child => child.y - BEND)])
  const line = [
    `M${SPINE} ${rows[0]!.y}V${Math.max(...ys)}`,
    ...rows.flatMap(row => row.children.map(child => `M${SPINE} ${child.y - BEND}${branch(child.y, child.end)}`)),
  ].join('')
  const parent = rows.find(row => row.children.some(child => child.current))
  const child = parent?.children.find(child => child.current)
  return {
    line,
    lit: parent && child ? `M${SPINE} ${parent.y}${branch(child.y, child.end)}` : undefined,
    stops: rows.map(row => ({ y: row.y, state: row.current ? 'here' : row === parent ? 'on' : 'off' })),
  }
}

/**
 * The sidebar of the version being read: the groups from `sidebar` in app.config, or one group per
 * top-level section for a version whose tree they were not written for (v2).
 */
export function useDocsSidebar() {
  const content = useDocsContent()
  const navigation = inject<Ref<NavigationItem[]>>('navigation', ref([]))
  const { sidebar } = useAppConfig() as { sidebar?: SidebarGroup[] }

  return computed<SidebarBlock[]>(() => {
    const base = content.value.routeBase
    const nav = navigation.value ?? []
    const bySection = new Map(nav.map(node => [segmentOf(node.path, base), node]))

    const groups: SidebarGroup[] = sidebar?.length && navGroupsApply(sidebar, nav, base)
      ? sidebar
      : nav.map(node => ({ label: node.children?.length ? node.title : undefined, sections: [segmentOf(node.path, base)] }))

    return groups.map(group => ({
      label: group.label,
      section: group.sections.length === 1 ? bySection.get(group.sections[0]!)?.title : undefined,
      steps: Boolean(group.steps),
      items: groupItems(group, bySection),
    })).filter(block => block.items.length)
  })
}
