<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'

const groups = ['Hosted', 'OpenTelemetry', 'Your own'] as const

const content = useDocsContent()
const selected = ref(drains[0]!.id)
const drain = computed(() => drains.find(d => d.id === selected.value)!)
// The first render stays still; only a choice the reader makes animates.
const chosen = ref(false)

const list = useTemplateRef<HTMLElement>('list')
const pill = reactive({ y: 0, h: 0, travels: false })

function measure() {
  const button = list.value?.querySelector<HTMLElement>(`[data-drain="${selected.value}"]`)
  if (!button) return
  pill.y = button.offsetTop
  pill.h = button.offsetHeight
}

watch(selected, () => nextTick(measure))
useResizeObserver(list, measure)
onMounted(() => {
  measure()
  requestAnimationFrame(() => {
    pill.travels = true
  })
})

function pick(id: string) {
  chosen.value = true
  selected.value = id
}

function onKey(event: KeyboardEvent) {
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const i = drains.findIndex(d => d.id === selected.value)
  const next = drains[(i + step + drains.length) % drains.length]!
  pick(next.id)
  list.value?.querySelector<HTMLElement>(`[data-drain="${next.id}"]`)?.focus()
}

const config = computed(() => [
  `import { defineEvlog } from 'evlog'`,
  `import { ${drain.value.factory} } from '${drain.value.entry}'`,
  '',
  'export default defineEvlog({',
  `  service: 'my-app',`,
  `  drain: ${drain.value.factory}(),`,
  '})',
].join('\n'))
</script>

<template>
  <figure class="not-prose my-9">
    <div class="grid overflow-hidden rounded-(--d-r-lg) border border-(--d-line) bg-(--d-raised) md:grid-cols-[12.5rem_minmax(0,1fr)]">
      <div
        ref="list"
        role="radiogroup"
        aria-label="Destination"
        class="relative flex gap-1 overflow-x-auto border-b border-(--d-line) p-2 [scrollbar-width:none] md:block md:overflow-visible md:border-r md:border-b-0"
        @keydown="onKey"
      >
        <span
          aria-hidden="true"
          class="absolute top-0 right-2 left-2 hidden rounded-[8px] bg-(--d-raised-strong) md:block"
          :class="pill.travels ? 'transition-[transform,height] duration-[260ms] ease-(--d-ease)' : ''"
          :style="{ transform: `translateY(${pill.y}px)`, height: `${pill.h}px` }"
        />
        <template v-for="group in groups" :key="group">
          <p class="hidden px-2.5 pt-2 pb-0.5 text-[12px] text-dimmed first:pt-0.5 md:block">
            {{ group }}
          </p>
          <button
            v-for="d in drains.filter(x => x.group === group)"
            :key="d.id"
            type="button"
            role="radio"
            :aria-checked="selected === d.id"
            :tabindex="selected === d.id ? 0 : -1"
            :data-drain="d.id"
            class="relative block shrink-0 rounded-[8px] px-2.5 py-[5px] text-left text-[13.5px] whitespace-nowrap transition-colors duration-150 md:w-full"
            :class="selected === d.id ? 'bg-(--d-raised-strong) text-highlighted md:bg-transparent' : 'text-muted hover:text-highlighted'"
            @click="pick(d.id)"
          >
            {{ d.name }}
          </button>
        </template>
      </div>

      <div class="flex min-w-0 flex-col">
        <div class="flex h-10 items-center border-b border-(--d-line) px-4 font-mono text-[12.5px] text-muted">
          evlog.config.ts
        </div>
        <pre class="overflow-x-auto px-4 py-4 font-mono text-[13px]/[1.75] text-default"><code><span style="color: #ff518d">import</span> { defineEvlog } <span style="color: #ff518d">from</span> <span style="color: #00ca52">'evlog'</span>
<span style="color: #ff518d">import</span> { <span :key="`f-${selected}`" :class="chosen && 'd-flash'">{{ drain.factory }}</span> } <span style="color: #ff518d">from</span> <span :key="`e-${selected}`" style="color: #00ca52" :class="chosen && 'd-flash'">'{{ drain.entry }}'</span>

<span style="color: #ff518d">export default</span> <span style="color: #c472fb">defineEvlog</span>({
  service: <span style="color: #00ca52">'my-app'</span>,
  drain: <span :key="`c-${selected}`" style="color: #c472fb" :class="chosen && 'd-flash'">{{ drain.factory }}</span>(),
})</code></pre>

        <div class="flex h-10 items-center border-y border-(--d-line) px-4 font-mono text-[12.5px] text-muted">
          .env
        </div>
        <pre class="min-h-[5.5rem] overflow-x-auto px-4 py-4 font-mono text-[13px]/[1.75]"><code v-if="drain.env.length" :key="`env-${selected}`" :class="chosen && 'd-tab-in'"><template v-for="[key, value] in drain.env" :key><span class="text-highlighted">{{ key }}</span><span class="text-dimmed">=</span><span class="text-muted">{{ value }}</span>
</template></code><code v-else :key="`none-${selected}`" class="font-sans text-[13px] text-dimmed" :class="chosen && 'd-tab-in'">Nothing to set. It works without credentials.</code></pre>

        <div class="mt-auto flex items-center justify-between gap-4 border-t border-(--d-line) px-4 py-3 text-[13px]">
          <span :key="`n-${selected}`" class="truncate text-muted" :class="chosen && 'd-tab-in'">{{ drain.note }}</span>
          <NuxtLink
            :to="prefixLink(drain.to, content.routeBase)"
            class="group/link inline-flex shrink-0 items-center gap-1 text-highlighted"
          >
            Read {{ drain.name }}
            <span aria-hidden="true" class="inline-block transition-transform duration-200 ease-(--d-ease) group-hover/link:translate-x-0.5">›</span>
          </NuxtLink>
        </div>
      </div>
    </div>
    <figcaption class="mt-3 px-1 text-[13px]/5 text-dimmed">
      Pick a destination. The config is one import and one line, and the credentials are read from the environment.
    </figcaption>
  </figure>
</template>

<style scoped>
.d-flash {
  border-radius: 3px;
  animation: d-flash 900ms var(--d-ease) both;
}

@keyframes d-flash {
  0% {
    background-color: color-mix(in srgb, var(--d-signal) 28%, transparent);
  }

  100% {
    background-color: transparent;
  }
}

.d-tab-in {
  display: block;
  animation: d-tab-in 220ms var(--d-ease) both;
}

@keyframes d-tab-in {
  from {
    opacity: 0;
    filter: blur(2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .d-flash,
  .d-tab-in {
    animation: none;
  }
}
</style>
