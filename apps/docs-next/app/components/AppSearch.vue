<script setup lang="ts">
import type { NavigationItem } from 'comark-content'

const props = defineProps<{
  navigation: NavigationItem[]
}>()

const { search, status } = useSearch()

const appConfig = useAppConfig()

interface PageItem {
  label: string
  prefix?: string
  suffix?: string
  to: string
  icon: string
}

/** Leaf pages, flattened; ancestor titles become the `Section > Page` prefix the palette renders. */
function pageItems(items: NavigationItem[], ancestors: string[] = []): PageItem[] {
  return items.flatMap((item) => {
    if (item.children?.length) return pageItems(item.children, [...ancestors, item.title])
    if (!item.path || item.page === false) return []
    return [
      {
        label: item.title,
        prefix: ancestors.length ? `${ancestors.join(' > ')} >` : undefined,
        suffix: item.description,
        to: item.path,
        icon: (item.icon as string | undefined) || appConfig.ui.icons.file,
      }
    ]
  })
}

function browseOnly(query: string, items?: PageItem[]): PageItem[] {
  return query ? [] : (items ?? [])
}

// One group per top-level section, mirroring how `UContentSearch` groups navigation when it can.
const groups = computed(() => {
  if (props.navigation.some((item) => item.children?.length)) {
    return props.navigation
      .filter((section) => section.children?.length)
      .map((section) => ({
        id: section.path,
        label: section.title,
        items: pageItems(section.children ?? []),
        postFilter: browseOnly,
      }))
      .filter((group) => group.items.length > 0)
  }
  return [{ id: 'docs', items: pageItems(props.navigation), postFilter: browseOnly }]
})
</script>

<template>
  <LazyUContentSearch
    :search
    :search-status="status"
    :navigation
    :groups
    :transition="false"
    :loading="status === 'loading'"
  />
</template>
