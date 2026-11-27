<script setup lang="ts">
import type { NavigationItem } from 'comark-content'
import type { ProductFacts } from '~/utils/pageHeader'

const props = defineProps<{
  /** The page's own path, as the reader's browser requested it. */
  path: string
  facts?: ProductFacts
}>()

const STATUS = {
  stable: { label: 'Stable', meaning: 'The API follows semver', mark: 'bg-(--ui-text-highlighted)' },
  beta: { label: 'Beta', meaning: 'The API can still change in a minor release', mark: 'bg-(--d-warn)' },
  early: { label: 'Early', meaning: 'Expect changes between releases', mark: 'ring-1 ring-inset ring-(--ui-text-dimmed)' },
} as const

const navigation = inject<Ref<NavigationItem[]>>('navigation', ref([]))
const pages = computed(() => {
  const paths = new Set<string>()
  const walk = (nodes: NavigationItem[]) => nodes.forEach((node) => {
    paths.add(node.path)
    walk(node.children ?? [])
  })
  walk(navigation.value ?? [])
  return paths
})
const segments = computed(() => pathSegments(props.path, pages.value))

const status = computed(() => props.facts?.status ? STATUS[props.facts.status] : undefined)
const fields = computed(() => {
  const { command, entry, package: pkg } = props.facts ?? {}
  return [
    command ? { key: 'run', value: command } : undefined,
    entry ? { key: 'import', value: entry } : undefined,
    pkg && pkg !== entry ? { key: 'package', value: pkg } : undefined,
  ].filter(Boolean) as { key: string, value: string }[]
})

// Read once: this header belongs to one request, and the page it leaves must not answer the next one.
const own = useRoute().path
const arrived = useDocsNavigated().value

const request = useDocsRequest()
const served = computed(() => request.value?.path === own ? request.value : undefined)
const state = computed(() => !arrived ? 'static' : served.value ? 'run' : 'wait')
</script>

<template>
  <div class="pe not-prose" :data-state="state" :style="{ '--took': `${drawTime(served?.ms ?? 0)}ms` }">
    <p class="pe-head">
      <span class="min-w-0 break-words">
        <span aria-hidden="true" class="text-dimmed">GET&nbsp;</span>
        <template v-for="(segment, i) in segments" :key="segment.name">
          <span aria-hidden="true" class="text-dimmed">/</span>
          <NuxtLink v-if="segment.to" :to="segment.to" class="text-muted transition-colors duration-150 hover:text-highlighted">{{ segment.name }}</NuxtLink>
          <span v-else :class="i === segments.length - 1 ? 'text-default' : 'text-muted'">{{ segment.name }}</span>
        </template>
      </span>
      <span class="pe-res d-xfade" :data-on="Boolean(served)" aria-hidden="true">
        <template v-if="served">
          <span :class="served.status < 400 ? 'text-(--d-out-ok)' : 'text-(--d-out-error)'">{{ served.status }}</span>
          <span class="text-dimmed"> in {{ formatTook(served.ms) }}</span>
        </template>
      </span>
      <span v-if="served" class="sr-only">This page was served with status {{ served.status }} in {{ formatTook(served.ms) }}.</span>
      <i class="pe-rule" aria-hidden="true" />
    </p>

    <ul v-if="status || fields.length" class="d-rail pe-rows" data-rows>
      <li v-if="status">
        <span class="pe-key">status</span>
        <span class="inline-flex items-center gap-2 text-default">
          <span class="size-[6px] rounded-full" :class="status.mark" />
          {{ status.label }}
        </span>
        <span class="ml-2.5 text-dimmed">{{ status.meaning }}</span>
      </li>
      <li v-for="field in fields" :key="field.key">
        <span class="pe-key">{{ field.key }}</span>
        <code class="font-mono text-[12.5px] text-highlighted">{{ field.value }}</code>
        <!-- `evlog/<drain>` is a pattern, not something to paste. -->
        <DocsCopyButton v-if="!field.value.includes('<')" class="pe-copy" :source="() => field.value" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pe {
  margin: 28px 0 36px;
  font-size: 13px;
}

.pe-head {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 16px;
  padding-bottom: 9px;
  font: 12.5px/20px var(--font-mono);
}

/* Holds its place before the answer is known, so the line never wraps when it arrives. */
.pe-res {
  min-width: 11ch;
  margin-left: auto;
  text-align: right;
  white-space: nowrap;
}

.pe-rule {
  position: absolute;
  inset: auto 0 0;
  height: 1px;
  background: var(--d-line-strong);
  transform-origin: left;
}

/* After a navigation the rule draws for as long as the request took, then the answer lands. */
.pe[data-state='wait'] .pe-rule {
  transform: scaleX(0);
}

.pe[data-state='run'] .pe-rule {
  animation: pe-rule var(--took) linear both;
}

.pe[data-state='run'] .pe-res {
  transition-delay: var(--took);
}

.pe[data-state='static'] .pe-res {
  filter: none;
  transform: none;
  transition: opacity 200ms ease;
}

@keyframes pe-rule {
  from { transform: scaleX(0); }
}

.pe-rows {
  margin: 0 0 0 7px;
}

.pe-rows > li {
  --rail-mid: 13px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  padding-block: 3px;
  line-height: 20px;
}

.pe-rows > li:first-child {
  --rail-mid: 19px;
  padding-top: 9px;
}

.pe-key {
  flex: none;
  width: 4.5rem;
  font: 12px/20px var(--font-mono);
  color: var(--ui-text-dimmed);
}

.pe-copy {
  height: 20px;
  margin-left: 6px;
  opacity: 0;
  transition-property: opacity, color, background-color, transform;
}

.pe-rows > li:hover .pe-copy,
.pe-copy:focus-visible {
  opacity: 1;
}

@media (hover: none) {
  .pe-copy {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pe[data-state] .pe-rule {
    transform: none;
    animation: none;
  }

  .pe[data-state] .pe-res {
    transition-delay: 0s;
  }
}
</style>
