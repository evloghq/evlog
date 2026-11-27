<script setup lang="ts">
import type { TocLink } from '~/composables/useDocsPage'

const props = defineProps<{ links: TocLink[] }>()

const reading = useDocsReading()
const index = computed(() => props.links.findIndex(link => link.id === reading.value))

// The rail steps in one notch per heading level, so a subsection hangs off its section.
const NOTCH = 12
const top = computed(() => Math.min(...props.links.map(link => link.depth)))
const rows = computed(() => props.links.map((link, i) => {
  const x = Math.min(link.depth - top.value, 1) * NOTCH
  const before = i ? Math.min(props.links[i - 1]!.depth - top.value, 1) * NOTCH : x
  return { ...link, x, from: before === x ? undefined : before }
}))

function go(event: MouseEvent, id: string) {
  const target = document.getElementById(id)
  if (!target) return
  event.preventDefault()
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  history.replaceState(history.state, '', `#${id}`)
  markArrived(id)
}
</script>

<template>
  <nav aria-label="On this page" class="text-[13px]/[1.45]">
    <ul>
      <li
        v-for="(row, i) in rows"
        :key="row.id"
        class="relative"
        :class="reading === row.id ? 'text-(--ui-text-highlighted)' : 'text-(--d-line-strong)'"
      >
        <svg
          v-if="row.from !== undefined"
          aria-hidden="true"
          class="absolute top-0 left-0 h-2 overflow-visible transition-colors duration-200"
          :width="NOTCH + 1"
          height="8"
          fill="none"
        >
          <path :d="`M${row.from + 0.5} 0 L${row.x + 0.5} 8`" stroke="currentColor" />
        </svg>
        <span
          aria-hidden="true"
          class="absolute bottom-0 w-px bg-current transition-colors duration-200"
          :class="row.from === undefined ? 'top-0' : 'top-2'"
          :style="{ left: `${row.x}px` }"
        />
        <a
          :href="`#${row.id}`"
          class="block py-[5px] pr-1 transition-colors duration-150"
          :class="reading === row.id ? 'text-highlighted' : i < index ? 'text-muted hover:text-highlighted' : 'text-dimmed hover:text-highlighted'"
          :style="{ paddingLeft: `${row.x + 16}px` }"
          :aria-current="reading === row.id ? 'location' : undefined"
          @click="go($event, row.id)"
        >
          {{ row.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>
