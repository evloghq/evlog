<script setup lang="ts">
import type { TocLink } from '~/composables/useDocsPage'

const props = defineProps<{ links: TocLink[] }>()

const reading = useDocsReading()
const index = computed(() => props.links.findIndex(link => link.id === reading.value))

// One bright segment on the hairline, moving to the section being read.
const list = useTemplateRef<HTMLElement>('list')
const segment = reactive({ y: 0, h: 0, travels: false })

function place() {
  const row = list.value?.querySelectorAll<HTMLElement>('li')[index.value]
  if (!row) return
  segment.y = row.offsetTop + 5
  segment.h = row.offsetHeight - 10
}

watch(index, (now, before) => {
  // Appearing is not travelling: the segment fades in where the reader is.
  if (before < 0) segment.travels = false
  nextTick(() => {
    place()
    requestAnimationFrame(() => {
      segment.travels = true
    })
  })
})

onMounted(place)

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
  <nav ref="list" aria-label="On this page" class="relative border-l border-(--d-line) text-[13px]/[1.45]">
    <span
      aria-hidden="true"
      class="absolute top-0 -left-px w-px bg-(--ui-text-highlighted)"
      :class="[index < 0 ? 'opacity-0' : 'opacity-100', segment.travels ? 'transition-[transform,height,opacity] duration-[320ms] ease-(--d-ease) motion-reduce:transition-none' : 'transition-opacity duration-200']"
      :style="{ transform: `translateY(${segment.y}px)`, height: `${segment.h}px` }"
    />
    <ul>
      <li v-for="(link, i) in links" :key="link.id">
        <a
          :href="`#${link.id}`"
          class="block py-[5px] pl-4 transition-colors duration-150"
          :class="reading === link.id ? 'text-highlighted' : i < index ? 'text-muted hover:text-highlighted' : 'text-dimmed hover:text-highlighted'"
          :aria-current="reading === link.id ? 'location' : undefined"
          @click="go($event, link.id)"
        >
          {{ link.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>
