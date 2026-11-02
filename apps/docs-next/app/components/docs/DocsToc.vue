<script setup lang="ts">
const props = defineProps<{
  /** Sections to list; defaults to the current page's. */
  links?: { id: string, text: string }[]
  /** Draw the sidebar's tree (`.d-rail`) instead of the side column's single line. */
  rail?: boolean
}>()

const current = useState<{ id: string, text: string }[]>('docs-toc', () => [])
const reading = useDocsReading()

const toc = computed(() => props.links ?? current.value)
const index = computed(() => toc.value.findIndex(link => link.id === reading.value))

function go(event: MouseEvent, id: string) {
  const target = document.getElementById(id)
  if (!target) return
  event.preventDefault()
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  history.replaceState(history.state, '', `#${id}`)
}
</script>

<template>
  <ul v-if="rail" class="d-rail">
    <li
      v-for="(link, i) in toc"
      :key="link.id"
      :data-lit="reading === link.id || undefined"
      :data-path="i < index || undefined"
    >
      <a
        :href="`#${link.id}`"
        class="-ml-2 block rounded-[6px] py-1 pr-2 pl-2 text-[13px]/5 transition-colors duration-150"
        :class="reading === link.id ? 'text-highlighted' : 'text-dimmed hover:text-highlighted'"
        :aria-current="reading === link.id ? 'location' : undefined"
        @click="go($event, link.id)"
      >
        {{ link.text }}
      </a>
    </li>
  </ul>

  <ul v-else class="relative before:absolute before:inset-y-0 before:left-[3px] before:w-px before:bg-(--d-line-strong)">
    <li v-for="(link, i) in toc" :key="link.id" class="relative">
      <span
        aria-hidden="true"
        class="absolute inset-y-1 left-[3px] w-px bg-(--ui-text-highlighted) transition-opacity duration-200"
        :class="reading === link.id ? 'opacity-100' : 'opacity-0'"
      />
      <a
        :href="`#${link.id}`"
        class="block py-[5px] pl-5 text-[13px]/[1.45] transition-colors duration-200"
        :class="reading === link.id ? 'text-highlighted' : i < index ? 'text-muted hover:text-highlighted' : 'text-dimmed hover:text-highlighted'"
        :aria-current="reading === link.id ? 'location' : undefined"
        @click="go($event, link.id)"
      >
        {{ link.text }}
      </a>
    </li>
  </ul>
</template>
