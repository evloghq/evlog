import type { NavigationItem } from 'comark-content'
import type { SidebarGroup } from '~/composables/useDocsSidebar'

// Stand-ins for the layer's mounted-versions API, which is not on comark-docs `main` yet.
// v3 is the only version this app serves; v2 links out to the 2.x site.

export interface DocsVersion {
  id: string
  label: string
  badge?: string
  to: string
  branch?: string
  contentDir?: string
}

const versions: DocsVersion[] = [
  { id: 'v3', label: 'v3', badge: 'beta', to: '/' },
  { id: 'v2', label: 'v2', to: 'https://www.evlog.dev', branch: 'main', contentDir: 'apps/docs/content' },
]

export function useDocsVersions() {
  const current = computed(() => versions[0])
  const items = computed(() => versions.map(version => ({
    label: version.badge ? `${version.label} · ${version.badge}` : version.label,
    to: version.to,
    target: version.to.startsWith('http') ? '_blank' : undefined,
    checked: version.id === current.value?.id,
    type: 'checkbox' as const,
  })))
  return { versions, current, items }
}

/** Whether the configured sidebar groups name sections that exist in this navigation tree. */
export function navGroupsApply(groups: SidebarGroup[], nav: NavigationItem[], base: string) {
  const sections = new Set(nav.map(node => segmentOf(node.path, base)))
  return groups.some(group => group.sections.some(section => sections.has(section)))
}
