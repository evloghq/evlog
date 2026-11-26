<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'

const props = defineProps<{
  /** Step of the page's scenario that this code brings the event to. */
  step: string
  /** Scenario name, when the page has no `event` key in its frontmatter. */
  scenario?: string
}>()

const page = useDocsEvent()
const name = computed(() => props.scenario ?? page.value)
const data = computed(() => (name.value ? eventScenarios[name.value] : undefined))
const index = computed(() => data.value?.steps.findIndex(step => step.id === props.step) ?? -1)
const current = computed(() => data.value?.steps[index.value])
const { view } = useEventView()

const status = computed(() => {
  const event = current.value?.event
  if (current.value && !event) return { label: 'dropped', tone: undefined }
  const code = event?.status
  return typeof code === 'number' ? { label: String(code), tone: code >= 400 ? 'error' : 'ok' } : undefined
})

const added = computed(() => {
  if (!data.value || index.value < 0 || !current.value?.event) return []
  return [...new Set(prettyLines(data.value.steps, index.value).filter(line => line.added).map(line => line.field))]
})

// A script emits by itself; a route's event comes from a request sent through the integration.
const source = computed(() => data.value?.via === 'evlog'
  ? `Printed by evlog ${data.value.evlog} when this code ran.`
  : `Printed by evlog ${data.value?.evlog} for a request through ${data.value?.via}.`)

// The server renders every line. Only an output still below the fold is held back, to print on arrival.
const figure = useTemplateRef<HTMLElement>('figure')
const reveal = ref<'armed' | 'run'>()
let observer: IntersectionObserver | undefined
let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  const el = figure.value
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (el.getBoundingClientRect().top < window.innerHeight) return
  reveal.value = 'armed'
  // Printing waits a beat after the first edge shows, so the reader has scrolled it into view. An
  // output that comes to rest at the fold still prints: nothing on screen stays empty.
  observer = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting) return
    observer?.disconnect()
    timer = setTimeout(() => {
      if (!running.value) reveal.value = 'run'
    }, 180)
  })
  observer.observe(el)
})

// Running it again holds the screen empty for as long as the request took, then prints.
const running = ref(false)

function replay() {
  if (running.value) return
  running.value = true
  reveal.value = 'armed'
  const took = Number(current.value?.event?.durationMs) || 240
  timer = setTimeout(() => {
    running.value = false
    reveal.value = 'run'
  }, Math.min(Math.max(took, 160), 600))
}

// Terminal and JSON differ in length; the window changes height in one movement instead of jumping.
const screen = useTemplateRef<HTMLElement>('screen')
const height = ref<number>()
useResizeObserver(screen, ([entry]) => {
  height.value = entry?.target.getBoundingClientRect().height
})

watch(view, () => {
  if (reveal.value !== 'armed') reveal.value = 'run'
})

onBeforeUnmount(() => {
  observer?.disconnect()
  clearTimeout(timer)
})
</script>

<template>
  <div :id="`step-${step}`" data-section="emits" :data-emits="step" class="emits scroll-mt-24">
    <div class="emits-code">
      <slot />
    </div>

    <!-- Joined to the code above it: one block, what was written and what it printed. -->
    <figure v-if="current" ref="figure" class="emits-out" :data-reveal="reveal">
      <figcaption class="flex h-9 items-center gap-2 border-b border-(--d-line) pr-1 pl-4 text-[12.5px] text-dimmed">
        <svg viewBox="0 0 12 12" class="size-3" fill="none" aria-hidden="true">
          <path d="M2.5 2v4.5a1.5 1.5 0 0 0 1.5 1.5h5.5M7.5 6 9.5 8l-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>Output</span>
        <span
          v-if="status"
          class="rounded-(--d-r-sm) px-1.5 py-px font-mono text-[11px]"
          :class="status.tone === 'error' ? 'bg-(--d-out-error)/10 text-(--d-out-error)' : status.tone === 'ok' ? 'bg-(--d-out-ok)/10 text-(--d-out-ok)' : 'bg-(--d-raised-strong) text-muted'"
        ><span class="d-stack justify-items-center">
          <span class="transition-opacity duration-150" :class="running ? 'opacity-0' : ''">{{ status.label }}</span>
          <span v-if="running" class="emits-wait" aria-hidden="true"><i /><i /><i /></span>
        </span></span>
        <DocsEventViewSwitch class="ml-auto" />
        <button
          v-if="current.event"
          type="button"
          class="group/run grid size-7 place-items-center rounded-(--d-r-md) text-dimmed transition-[color,background-color,transform] duration-150 hover:bg-(--d-raised-strong) hover:text-highlighted active:scale-[0.94]"
          aria-label="Run again"
          title="Run again"
          @click="replay"
        >
          <svg viewBox="0 0 12 12" class="size-3 transition-transform duration-500 ease-(--d-ease) group-hover/run:rotate-[-45deg]" :class="running ? 'rotate-[-360deg]' : ''" fill="none" aria-hidden="true">
            <path d="M2 6a4 4 0 1 0 1.3-2.95M2 2v2.2h2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </figcaption>

      <div class="emits-screen" :style="{ height: height ? `${height}px` : undefined }">
        <div ref="screen">
          <DocsEvent :scenario="name!" :step="index" :view />
        </div>
      </div>

      <p class="emits-note" :title="source">
        <template v-if="added.length">
          <i aria-hidden="true" />
          <span><span class="text-default">{{ added.join(', ') }}</span> added by this code</span>
        </template>
        <span class="ml-auto">evlog {{ data?.evlog }}</span>
        <span class="sr-only">{{ source }}</span>
      </p>
    </figure>
  </div>
</template>

<style scoped>
.emits {
  margin: 1.75rem 0;
}

.emits-code > :deep(*) {
  margin-block: 0;
}

.emits-code:has(+ .emits-out) > :deep(*) {
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
}

/* A figure in place of code: its frame joins the output, and its caption moves below both. */
.emits:has(> .emits-code > figure) {
  display: flex;
  flex-direction: column;
}

.emits-code:has(> figure),
.emits-code > :deep(figure) {
  display: contents;
}

.emits-code > :deep(figure > .d-figure-frame) {
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
}

.emits-code > :deep(figure > .d-figure-caption) {
  order: 1;
}

.emits-out {
  overflow: hidden;
  border: 1px solid var(--d-line);
  border-top: 0;
  border-radius: 0 0 var(--d-r-lg) var(--d-r-lg);
  transition: border-color 200ms ease;
}

@media (hover: hover) {
  .emits:hover .emits-code > :deep(*),
  .emits:hover .emits-code > :deep(figure > .d-figure-frame),
  .emits:hover .emits-out {
    border-color: var(--d-line-strong);
  }
}

.emits-wait {
  display: flex;
  align-items: center;
  gap: 2px;
}

.emits-wait > i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  animation: emits-wait 600ms ease-in-out infinite;
}

.emits-wait > i:nth-child(2) {
  animation-delay: 100ms;
}

.emits-wait > i:nth-child(3) {
  animation-delay: 200ms;
}

@keyframes emits-wait {
  0%, 100% { opacity: 0.25; }
  40% { opacity: 1; }
}

.emits-screen {
  overflow: hidden;
  transition: height 280ms var(--d-ease);
}

@media (prefers-reduced-motion: reduce) {
  .emits-screen {
    transition: none;
  }

  .emits-wait > i {
    animation: none;
  }
}

.emits-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0.6rem;
  padding: 0.55rem 1rem 0.65rem;
  border-top: 1px solid var(--d-line);
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ui-text-dimmed);
}

.emits-note > span {
  white-space: nowrap;
}

.emits-note > i {
  flex: none;
  width: 2px;
  height: 12px;
  border-radius: 1px;
  background: var(--d-signal);
}
</style>
