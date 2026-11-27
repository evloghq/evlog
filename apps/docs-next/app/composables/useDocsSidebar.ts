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
}

export interface SidebarItem {
  title: string
  path: string
  /** Pages of a multi-page product, listed under it. */
  children: SidebarItem[]
  /** The children are a catalogue: only the one being read is listed. */
  catalog: boolean
}

export interface SidebarBlock {
  label?: string
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

/** The pages listed under a sidebar entry while the reader is at `path`. */
export function listedChildren(item: SidebarItem, path: string): SidebarItem[] {
  return item.catalog ? item.children.filter(child => child.path === path) : item.children
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

    return groups.map((group) => {
      const nodes = group.sections.map(section => bySection.get(section)).filter(Boolean) as NavigationItem[]
      const only = nodes.length === 1 ? nodes[0] : undefined
      const items = only?.children?.length
        ? only.children.map(node => toItem(node))
        : nodes.map(node => toItem(node, group.catalogs?.includes(segmentOf(node.path, base))))
      return { label: group.label, items }
    }).filter(block => block.items.length)
  })
}
